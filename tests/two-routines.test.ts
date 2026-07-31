import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedProducts, seedTenant } from "../src/data/seed-catalog";
import hairRows from "./fixtures/cicabelle-hair.json";
import { resetStockCache } from "../src/services/stock";

/**
 * From a live session: dandruff routine, then "I have a little bit acne as
 * well" — and the acne routine REPLACED the hair routine on screen. "What
 * about my dandruff? Did you remove it?" brought the hair back and hid the
 * acne. "Add to Cart has one option only, I mean both" got the off-topic
 * brush-off. Two finished routines must both stay, and one cart carries both.
 */

const base = seedProducts.filter((product) => product.tenantId === seedTenant.id)[0];
const face = (id: string, name: string, category: string) => ({
  ...base,
  id,
  sku: id,
  name,
  category,
  description: `${name} for acne and oily skin`,
  url: `https://example.com/products/${id}`,
  activeIngredientsJson: ["niacinamide"],
  ingredientsJson: [],
  concernsJson: ["acne", "oily skin"],
  skinTypesJson: ["oily"],
  sensitiveSkinSuitable: true,
  merchantPriority: 80,
});
const catalogue = [
  ...(hairRows as Record<string, unknown>[]).map((row) => ({ ...base, ...row })),
  face("f-clean", "COSRX Salicylic Acid Daily Gentle Cleanser 150ml", "cleansers"),
  face("f-serum", "Anua Niacinamide 10% + TXA 4% Serum 30ml", "serums"),
  face("f-moist", "Dr. Althea 345 Relief Cream 50ml", "moisturizers"),
  face("f-spf", "Celimax Pore Dark Spot Brightening Care Sunscreen 50ml", "sunscreens"),
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

describe("two concerns, two routines, one screen", () => {
  it("keeps the dandruff routine when the acne routine arrives", async () => {
    let slots: Record<string, unknown> = {};
    for (const line of ["I have a dandruff.", "No, not at all.", "No, not at all."]) {
      const payload = await ask(line, slots);
      slots = payload.slots ?? slots;
    }
    let payload = await ask("It's okay, I have a little bit acne as well.", slots);
    slots = payload.slots ?? slots;
    expect(payload.reply).toMatch(/happy to help with that too/i);
    payload = await ask("Super oily.", slots);
    slots = payload.slots ?? slots;

    const steps = (payload.products ?? []).map((product: { step: string }) => product.step);
    // The hair routine is still there...
    expect(steps).toContain("shampoo");
    // ...and the face routine arrived beside it.
    expect(steps).toContain("cleanser");
    expect(steps).toContain("sunscreen");

    // "What about my dandruff? Did you remove it?" — both stay, no brush-off.
    const check = await ask("What about my dandruff? Where are those products? I don't see it. Did you remove it?", slots);
    expect(check.reply).not.toMatch(/outside my world/i);
    const checkSteps = (check.products ?? []).map((product: { step: string }) => product.step);
    if (checkSteps.length) {
      expect(checkSteps).toContain("shampoo");
      expect(checkSteps).toContain("cleanser");
    }
  });
});
