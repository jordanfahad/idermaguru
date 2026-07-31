import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedProducts, seedTenant } from "../src/data/seed-catalog";
import { nameMatchesBrandToken, readsStillThere } from "../src/services/voice-agent";
import { resetStockCache } from "../src/services/stock";

/**
 * From a live session, straight after a face routine:
 *
 *   You      I don't like laroche only korean brands please
 *   Advisor  Fair enough — out goes La Roche-Posay Toleriane Face Wash
 *            Cleanser, in comes La Roche-Posay Mela B3 Gel Cleanser. ...
 *   You      Its still there
 *   Advisor  That one's outside my world, I'm afraid ...
 *   You      Wtf? I'm saying that laroche is still there in the recommendation
 *   Advisor  Fair enough — I'll leave that one alone. ...
 *
 * A brand-level dislike swapped ONE product — for the same brand — and the
 * complaint about it was treated as small talk, twice.
 */

const row = (id: string, name: string, category: string, concerns: string[]) => ({
  ...seedProducts.filter((product) => product.tenantId === seedTenant.id)[0],
  id,
  sku: id,
  name,
  category,
  description: `${name} for dark spots and dull skin`,
  url: `https://example.com/products/${id}`,
  activeIngredientsJson: ["niacinamide"],
  ingredientsJson: [],
  concernsJson: concerns,
  skinTypesJson: ["combination"],
  sensitiveSkinSuitable: true,
  merchantPriority: 80,
});

const catalogue = [
  row("lrp-wash", "La Roche-Posay Toleriane Face Wash Cleanser, 400ml", "cleansers", ["dark spots"]),
  row("lrp-gel", "La Roche-Posay Mela B3 Gel Cleanser, 200 ml", "cleansers", ["dark spots"]),
  row("krx-clean", "COSRX Low pH Good Morning Gel Cleanser 150ml", "cleansers", ["dark spots"]),
  row("lrp-moist", "La Roche-Posay Effaclar Duo+M Gel Moisturiser 40ml", "moisturizers", ["dark spots"]),
  row("krx-moist", "Beauty of Joseon Dynasty Cream Moisturiser 50ml", "moisturizers", ["dark spots"]),
  row("krx-serum", "KSECRET Seoul 1988 Glow Serum Niacinamide 30ml", "serums", ["dark spots", "dullness"]),
  row("krx-spf", "Celimax Pore + Dark Spot Brightening Care Sunscreen SPF50 50ml", "sunscreens", ["dark spots"]),
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
  for (const line of ["I have dark spots and dull skin", "combination", "no", "no"]) {
    const payload = await ask(line, slots);
    slots = payload.slots ?? slots;
  }
  return slots;
};

describe("a rejected brand leaves whole", () => {
  it("matches the brand through speech-to-text spelling", () => {
    expect(nameMatchesBrandToken("La Roche-Posay Toleriane Face Wash Cleanser, 400ml", "laroche")).toBe(true);
    expect(nameMatchesBrandToken("La Roche-Posay Mela B3 Gel Cleanser", "roche")).toBe(true);
    expect(nameMatchesBrandToken("COSRX Low pH Good Morning Gel Cleanser", "laroche")).toBe(false);
    expect(nameMatchesBrandToken("KSECRET Seoul 1988 Glow Serum", "roche")).toBe(false);
  });

  it("evicts every product of the brand, never swapping within it", async () => {
    const slots = await toRoutine();
    const payload = await ask("I don't like laroche only korean brands please", slots);
    expect(payload.reply).toMatch(/out, for good/i);
    expect(payload.slots.dislikedBrands).toEqual(["laroche"]);
    const names = (payload.products ?? []).map((product: { name: string }) => product.name).join(" | ");
    expect(names).not.toMatch(/roche/i);
    expect((payload.products ?? []).length).toBeGreaterThan(0);
  });

  it("keeps the brand out of every later rebuild", async () => {
    const slots = await toRoutine();
    const dropped = await ask("I don't like laroche only korean brands please", slots);
    const stronger = await ask("make it stronger", dropped.slots);
    const names = (stronger.products ?? []).map((product: { name: string }) => product.name).join(" | ");
    expect(names).not.toMatch(/roche/i);
  });

  it("still swaps a single product when only a step is named", async () => {
    const slots = await toRoutine();
    const payload = await ask("I don't like the cleanser", slots);
    expect(payload.reply).toMatch(/out goes .* in comes/i);
    expect(payload.slots.dislikedBrands).toBeUndefined();
  });
});

describe("'it's still there' is a complaint, not a tangent", () => {
  it("reads the complaint in its natural shapes", () => {
    expect(readsStillThere("Its still there")).toBe(true);
    expect(readsStillThere("Wtf? I'm saying that laroche is still there in the recommendation")).toBe(true);
    expect(readsStillThere("you didn't change it")).toBe(true);
    expect(readsStillThere("I have dark spots")).toBe(false);
    expect(readsStillThere("no")).toBe(false);
  });

  it("answers with the fix when the shopper is right", async () => {
    const slots = await toRoutine();
    // Simulate the old failure: brand recorded as one disliked product only,
    // so the routine still carries the other La Roche items.
    const payload = await ask("Wtf? I'm saying that laroche is still there in the recommendation", slots);
    expect(payload.reply).not.toMatch(/outside my world/i);
    expect(payload.reply).toMatch(/you're right|gone now/i);
    const names = (payload.products ?? []).map((product: { name: string }) => product.name).join(" | ");
    expect(names).not.toMatch(/roche/i);
  });

  it("proves the screen is clean when it is", async () => {
    const slots = await toRoutine();
    const dropped = await ask("I don't like laroche only korean brands please", slots);
    const payload = await ask("its still there", dropped.slots);
    expect(payload.reply).not.toMatch(/outside my world/i);
    expect(payload.reply).toMatch(/double-checked|isn't in it/i);
  });
});
