import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedProducts, seedTenant } from "../src/data/seed-catalog";
import { findProductByQuery, readProductQuery } from "../src/services/voice-agent";
import { resetStockCache } from "../src/services/stock";

/**
 * From a live session, straight after a dandruff routine:
 *
 *   You      What about hair serum do you have any hair serum
 *   Advisor  Here's a 3-step hair and scalp routine from the store. ...
 *   You      What about multiply hair serum            [STT: "Multi-Peptide"]
 *   Advisor  Here's a 3-step hair and scalp routine from the store. ...
 *   You      I'm asking about the ordinary multi peptide hair salon do you have it
 *   Advisor  Here's a 3-step hair and scalp routine from the store. ...
 *
 * The store stocks The Ordinary Multi-Peptide Serum for Hair Density. A direct
 * question about a product, asked three ways, was answered each time by
 * re-reading the identical routine.
 *
 * The catalogue below is the real shape of the merchant's rows (names,
 * categories, priorities), so the reproduction is faithful.
 */

const row = (id: string, name: string, category: string, concerns: string[], priority: number) => ({
  ...seedProducts.filter((product) => product.tenantId === seedTenant.id)[0],
  id,
  sku: id,
  name,
  category,
  description: `${name}. Available with delivery.`,
  url: `https://example.com/products/${id}`,
  activeIngredientsJson: [],
  ingredientsJson: [],
  concernsJson: concerns,
  skinTypesJson: [],
  sensitiveSkinSuitable: false,
  merchantPriority: priority,
});

const catalogue = [
  row("vichy-200", "Vichy DERCOS ANTI-DANDRUFF SHAMPOO FOR DRY HAIR 200ML", "conditioners", ["dandruff", "hair"], 85),
  row("mielle-cond", "MIELLE ROSEMARY CONDITIONER 355G", "conditioners", ["dandruff", "hair"], 80),
  row("mielle-oil", "Mielle Rosemary Mint Scalp & Hair Strengthening Oil", "hair loss treatments", ["dandruff", "hair fall", "hair"], 84),
  row("multi-peptide", "Ordinary Multi-Peptide Serum for Hair Density, 60ML", "hair loss treatments", ["hair fall", "hair"], 86),
  row("nmf-scalp", "The Ordinary Natural Moisturizing Factors + Hyaluronic Acid Scalp Serum 60ml", "hair loss treatments", ["dandruff", "hair fall", "hair"], 82),
  row("castor-oil", "Kate Blanc Cosmetics Castor Oil (2oz) | Eyelash & Hair Growth", "hair care", ["hair"], 45),
];

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

const toRoutine = async () => {
  let slots: Record<string, unknown> = {};
  for (const line of ["I have dandruff", "no", "no"]) {
    const payload = await ask(line, slots);
    slots = payload.slots ?? slots;
  }
  return slots;
};

describe("reading a question about a product", () => {
  it("reads the ask in the shapes it was actually asked", () => {
    expect(readProductQuery("What about hair serum do you have any hair serum")).toBeTruthy();
    expect(readProductQuery("What about multiply hair serum")).toBeTruthy();
    expect(readProductQuery("I'm asking about the ordinary multi peptide hair salon do you have it")).toBeTruthy();
    // a question about the concern or the domain is not a product question
    expect(readProductQuery("what about my dandruff")).toBeNull();
    // and an ordinary answer has no query shape at all
    expect(readProductQuery("oily")).toBeNull();
  });

  it("finds the product through the speech-to-text noise", () => {
    expect(findProductByQuery(catalogue, readProductQuery("do you have any hair serum")!)?.id).toBe("multi-peptide");
    expect(findProductByQuery(catalogue, readProductQuery("what about multiply hair serum")!)?.id).toBe("multi-peptide");
    expect(
      findProductByQuery(catalogue, readProductQuery("I'm asking about the ordinary multi peptide hair salon do you have it")!)?.id,
    ).toBe("multi-peptide");
    expect(findProductByQuery(catalogue, ["snail", "mucin", "essence"])).toBeNull();
  });
});

describe("a question about a product gets an answer about that product", () => {
  it("swaps the named serum in, instead of re-reading the routine", async () => {
    const slots = await toRoutine();
    const payload = await ask("What about hair serum do you have any hair serum", slots);
    expect(payload.reply).not.toMatch(/here's a \d-step hair and scalp routine/i);
    expect(payload.reply).toMatch(/multi-peptide/i);
    const ids = (payload.products ?? []).map((product: { id: string }) => product.id);
    expect(ids).toContain("multi-peptide");
    expect(payload.slots.pinnedIds).toEqual(["multi-peptide"]);
  });

  it("keeps the asked-for product through a later rebuild", async () => {
    const slots = await toRoutine();
    const swappedIn = await ask("do you have any hair serum", slots);
    const again = await ask("make it stronger", swappedIn.slots);
    const ids = (again.products ?? []).map((product: { id: string }) => product.id);
    expect(ids).toContain("multi-peptide");
  });

  it("says out of stock when the shelf is empty, and leaves the routine alone", async () => {
    vi.stubGlobal("fetch", async (input: unknown) => {
      if (String(input).includes("multi-peptide")) {
        return new Response(JSON.stringify({ available: false }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error("offline");
    });
    const slots = await toRoutine();
    const payload = await ask("do you have any hair serum", slots);
    expect(payload.reply).toMatch(/out of stock/i);
    expect(payload.slots.pinnedIds).toBeUndefined();
    expect((payload.products ?? []).length).toBe(0);
  });

  it("answers honestly when the store does not stock it", async () => {
    const slots = await toRoutine();
    const payload = await ask("do you have snail mucin essence", slots);
    expect(payload.reply).toMatch(/doesn'?t stock/i);
    expect(payload.reply).not.toMatch(/here's a \d-step/i);
  });
});

describe("the hair routine never re-reads itself", () => {
  it("says same-again instead of replaying the identical routine", async () => {
    const slots = await toRoutine();
    // "make it stronger" rebuilds the same four hair products.
    const payload = await ask("make it stronger", slots);
    expect(payload.reply).not.toMatch(/here's a \d-step hair and scalp routine/i);
    expect(payload.reply).toMatch(/same/i);
  });

  it("even for an unparsed ramble that falls through to the result flow", async () => {
    const slots = await toRoutine();
    const payload = await ask("what about my dandruff", slots);
    expect(payload.reply).not.toMatch(/here's a \d-step hair and scalp routine/i);
  });
});
