import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedProducts, seedTenant } from "../src/data/seed-catalog";
import { agentCopy, beginConcern, readNewConcern, readsDone, readsMore } from "../src/services/voice-agent";
import { resetStockCache } from "../src/services/stock";

/**
 * From a live session: the shopper got a three-product dandruff routine, then
 * said they wanted something for their acne — and the advisor "kept asking me
 * to buy the three oils". The sentence contained "add more", so the adjustment
 * reader claimed it, rebuilt the same hair routine, and the acne went unheard.
 *
 * And the conversation had no way to end: nothing ever asked "anything else?",
 * and "no, I'm done" had nowhere to go but the tangent classifier.
 */

const catalogue = (() => {
  const face = seedProducts.filter((product) => product.tenantId === seedTenant.id);
  const base = face[0];
  const hair = (
    [
      ["sh-1", "Vichy Dercos Anti-Dandruff Shampoo", "shampoo"],
      ["cond-1", "Mielle Rosemary Conditioner", "conditioner"],
      ["oil-1", "Mielle Rosemary Mint Scalp & Hair Strengthening Oil", "scalp serum"],
    ] as [string, string, string][]
  ).map(([id, name, category]) => ({
    ...base,
    id,
    sku: id,
    name,
    category,
    description: `${name} for dandruff and flaky scalp`,
    url: `https://example.com/products/${id}`,
    activeIngredientsJson: ["zinc"],
    concernsJson: ["dandruff"],
    skinTypesJson: [],
    sensitiveSkinSuitable: true,
  }));
  return [...face, ...hair];
})();

vi.mock("@/services/catalog", () => ({
  getTenantBySlug: async () => seedTenant,
  listTenantProducts: async () => catalogue,
}));

beforeEach(() => {
  resetStockCache();
  vi.stubGlobal("fetch", async () => {
    throw new Error("offline");
  });
});
afterEach(() => vi.unstubAllGlobals());

const ask = async (utterance: string, slots: Record<string, unknown>) => {
  const { POST } = await import("../src/app/api/voice-agent/route");
  const response = await POST(
    new Request("http://localhost/api/voice-agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ utterance, slots }),
    }),
  );
  return response.json();
};

const toHairRoutine = async () => {
  let slots: Record<string, unknown> = {};
  let last: { reply?: string; products?: { slot: string }[] } = {};
  for (const line of ["I have dandruff", "no", "no"]) {
    last = await ask(line, slots);
    slots = (last as { slots?: Record<string, unknown> }).slots ?? slots;
  }
  return { slots, last };
};

describe("a second concern starts a second conversation", () => {
  it("reads the acne, not the words 'add more'", () => {
    expect(readNewConcern("I want to add more for my acne", "I have dandruff")).toBeTruthy();
    // the same concern again is the same conversation
    expect(readNewConcern("what about my dandruff", "I have dandruff")).toBeNull();
    // and a swap of a routine product is not a topic switch
    expect(readNewConcern("I don't like the oil", "I have dandruff")).toBeNull();
  });

  it("switches to the acne instead of replaying the hair routine", async () => {
    const { slots } = await toHairRoutine();
    const payload = await ask("I want to add more for my acne", slots);
    expect(payload.reply).not.toMatch(/hair and scalp routine/i);
    expect(payload.reply).not.toMatch(/same 3/i);
    expect(payload.reply).toMatch(/happy to help with that too/i);
    // it moves the interview on rather than ending it
    expect(payload.phase).toBe("asking");
  });

  it("does not re-ask pregnancy or allergies on the way to the acne routine", async () => {
    const { slots } = await toHairRoutine();
    let payload = await ask("I want to add more for my acne", slots);
    let current = payload.slots ?? slots;
    // Answer whatever the interview still needs, at most twice.
    for (const answer of ["on my face", "oily"]) {
      if (payload.phase !== "asking") break;
      expect(payload.reply).not.toMatch(/pregnan|breast/i);
      expect(payload.reply).not.toMatch(/allerg/i);
      payload = await ask(answer, current);
      current = payload.slots ?? current;
    }
    expect(payload.phase).toBe("result");
    expect((payload.products ?? []).length).toBeGreaterThan(0);
    const slotsUsed = (payload.products ?? []).map((product: { slot: string }) => product.slot);
    expect(slotsUsed).toContain("cleanser");
    // The dandruff routine deliberately STAYS beside the acne one now —
    // two concerns, two sections, one cart.
    expect(slotsUsed).toContain("shampoo");
  });
});

describe("the routine ends with the door held open", () => {
  it("asks whether anything else is needed after a routine", async () => {
    const { last } = await toHairRoutine();
    expect(last.reply).toMatch(/anything else/i);
  });

  it("speaks the closer as its own cached part", async () => {
    const { last } = await toHairRoutine();
    const speech = (last as { speech?: string[] }).speech ?? [];
    expect(speech.length).toBe(2);
    expect(speech[1]).toBe(agentCopy("en").anythingElse);
  });

  it("wraps up warmly on 'no thanks' and stops there", async () => {
    const { slots } = await toHairRoutine();
    const payload = await ask("no thanks", slots);
    expect(payload.reply).toMatch(/whenever you're ready/i);
    expect(payload.phase).toBe("farewell");
  });

  it("invites the next concern on a bare 'yes'", async () => {
    const { slots } = await toHairRoutine();
    const payload = await ask("yes", slots);
    expect(payload.reply).toMatch(/what else/i);
    // and whatever comes next IS the concern, whatever words it uses
    const next = await ask("my skin gets really shiny by lunchtime", payload.slots);
    expect(next.reply).not.toMatch(/outside my world/i);
    expect(next.phase).toBe("asking");
  });

  it("still reads a mid-interview 'no' as the answer to the open question", () => {
    // The done/more readers are whole-utterance and only consulted once the
    // routine is settled — reaching the routine through two 'no' answers in
    // every other test in this file is the live proof.
    expect(readsDone("no")).toBe(true);
    expect(readsMore("yes")).toBe(true);
    expect(readsDone("no salicylic acid")).toBe(false);
  });

  it("keeps the person when the topic changes", () => {
    const switched = beginConcern(
      {
        mainConcern: "dandruff",
        bodyArea: "scalp",
        pregnantOrBreastfeeding: false,
        allergies: ["peanut"],
        gaveRoutine: true,
        lastRoutine: ["a", "b"],
        dislikedIds: ["a"],
      },
      "acne on my face",
    );
    expect(switched.mainConcern).toBe("acne on my face");
    expect(switched.bodyArea).toBe("face");
    expect(switched.gaveRoutine).toBeUndefined();
    expect(switched.lastRoutine).toBeUndefined();
    // the person carries over
    expect(switched.pregnantOrBreastfeeding).toBe(false);
    expect(switched.allergies).toEqual(["peanut"]);
    expect(switched.dislikedIds).toEqual(["a"]);
  });
});
