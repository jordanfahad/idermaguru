import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../src/app/api/voice-agent/route";
import { isChild, readsAge, readsThirdParty } from "../src/services/audience";
import { slotsToProfile, updateSlots } from "../src/services/voice-agent";
import { runSafetyTriage } from "../src/services/safety-triage";
import { resetStockCache } from "../src/services/stock";

/**
 * A live session, in full:
 *
 *   You      My neighbor's daughter has dandruff
 *   Advisor  Got it. One safety check — a few ingredients aren't advised in
 *            pregnancy or breastfeeding. Does either apply to you?
 *   You      She's four years old
 *   Advisor  That one's outside my world, I'm afraid.
 *
 * It asked a shopper whether *they* were pregnant about a product for somebody
 * else's child, then classified "four years old" as a tangent and built the
 * routine anyway. The safety triage has always had an under-18 rule — nothing
 * ever populated an age from a conversation, so it could never fire.
 */

beforeEach(() => {
  resetStockCache();
  vi.stubGlobal("fetch", async () => {
    throw new Error("offline");
  });
});
afterEach(() => vi.unstubAllGlobals());

async function converse(lines: string[]) {
  let slots: Record<string, unknown> = {};
  const said: { reply: string; phase: string; products: number }[] = [];
  for (const line of lines) {
    const response = await POST(
      new Request("http://localhost/api/voice-agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ utterance: line, slots }),
      }),
    );
    const payload = await response.json();
    slots = payload.slots ?? slots;
    said.push({ reply: payload.reply ?? "", phase: payload.phase, products: (payload.products ?? []).length });
  }
  return { said, slots };
}

describe("reading an age", () => {
  const ages: [string, number][] = [
    ["She's four years old", 4],
    ["my son is 7", 7],
    ["my neighbour's daughter is 4", 4],
    ["I am 15", 15],
    ["a 3 year old", 3],
    ["aged 12", 12],
    ["he just turned 16", 16],
    ["my baby has cradle cap", 2],
    ["I'm 34", 34],
  ];

  for (const [utterance, age] of ages) {
    it(`reads ${age} from "${utterance}"`, () => {
      expect(readsAge(utterance)).toBe(age);
    });
  }

  it("does not invent an age out of any nearby number", () => {
    for (const utterance of [
      "a simple glow routine under AED 200",
      "I use it 3 times a week",
      "my routine is 4 steps",
      "I have dandruff",
      "combination",
    ]) {
      expect(readsAge(utterance)).toBeUndefined();
    }
  });

  it("knows when the advice is for somebody else", () => {
    expect(readsThirdParty("My neighbor's daughter has dandruff")).toBe(true);
    expect(readsThirdParty("my son has acne")).toBe(true);
    expect(readsThirdParty("I have dark spots")).toBe(false);
  });
});

describe("a child's age stops the sale", () => {
  it("stops for a four-year-old and never reaches a product", async () => {
    const { said, slots } = await converse(["My neighbor's daughter has dandruff", "She's four years old"]);
    expect(slots.ageYears).toBe(4);
    expect(said[1].phase).toBe("referral");
    expect(said[1].products).toBe(0);
    expect(said[1].reply).toMatch(/pharmacist|doctor/i);
    // and not the canned tangent line that was actually sent
    expect(said[1].reply).not.toMatch(/outside my world/i);
  });

  it("holds for the rest of the session", async () => {
    const { said } = await converse(["my son has acne", "he is 8", "no", "no"]);
    for (const turn of said.slice(1)) {
      expect(turn.phase).toBe("referral");
      expect(turn.products).toBe(0);
    }
    // the same answer each time, not a generic wall of clinical text
    expect(said[3].reply).toMatch(/8|pharmacist/i);
  });

  it("asks about the right person when buying for someone else", async () => {
    const { said } = await converse(["My neighbor's daughter has dandruff"]);
    expect(said[0].reply).toMatch(/the person this is for/i);
    expect(said[0].reply).not.toMatch(/apply to you\?/i);
  });

  it("feeds the age to the triage that always had the rule", () => {
    const profile = slotsToProfile({ mainConcern: "acne", ageYears: 6 });
    expect(profile.ageRange).toBe("6 years old");
    expect(runSafetyTriage(profile).recommendationAllowed).toBe(false);
  });

  /**
   * The threshold is 10, set by the owner. A teenager with acne is one of the
   * most common shoppers there is, and the old rule refused them — it matched
   * "13".."17" as bare substrings of whatever string it was handed.
   */
  it("helps a teenager rather than turning them away", async () => {
    expect(isChild(15)).toBe(false);
    expect(isChild(10)).toBe(false);
    expect(isChild(9)).toBe(true);

    const profile = slotsToProfile({ mainConcern: "acne", skinType: "oily", ageYears: 15 });
    expect(runSafetyTriage(profile).recommendationAllowed).toBe(true);

    const { said } = await converse(["I have acne", "oily", "no", "no"]);
    expect(said[3].phase).toBe("result");
  });

  it("does not read a digit out of an age band as an age", () => {
    // "18-24" used to refuse, because the old rule found no number at all and
    // matched substrings instead.
    expect(runSafetyTriage({ mainConcern: "dark spots", ageRange: "18-24" }).recommendationAllowed).toBe(true);
    expect(runSafetyTriage({ mainConcern: "dark spots", ageRange: "25-34" }).recommendationAllowed).toBe(true);
    expect(runSafetyTriage({ mainConcern: "dark spots", ageRange: "toddler" }).recommendationAllowed).toBe(false);
  });

  it("leaves an adult alone", async () => {
    const { said, slots } = await converse(["I have dark spots and dull skin", "combination", "no", "no"]);
    expect(slots.ageYears).toBeUndefined();
    expect(said[3].phase).toBe("result");
    expect(said[3].products).toBeGreaterThan(0);
    expect(isChild(undefined)).toBe(false);
  });

  it("keeps an age out of the concern text", () => {
    const slots = updateSlots({ mainConcern: "dandruff", askedPregnancy: true }, "she is 4", "en");
    expect(slots.ageYears).toBe(4);
  });
});
