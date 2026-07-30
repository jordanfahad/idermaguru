import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedProducts, seedTenant } from "../src/data/seed-catalog";
import { resetStockCache } from "../src/services/stock";

/**
 * From a live session, straight after a dandruff routine of shampoo,
 * conditioner and a scalp oil:
 *
 *   You      I don't like oil
 *   Advisor  Happy to change it — which one? Tell me the product or the
 *            step, like 'the cleanser' or 'the serum'.
 *
 * Two failures in one line. The shopper NAMED the target — the routine
 * contains exactly one oil — and was asked to name it. And the examples are
 * face steps: there is no cleanser and no serum anywhere on their screen.
 *
 * The cause: the debate flow always rebuilt with the face-routine builder,
 * whatever builder the routine actually came from. A hair shopper's challenge
 * was matched against a face routine with no oil in it.
 */

const hairCatalogue = (() => {
  const base = seedProducts.filter((product) => product.tenantId === seedTenant.id)[0];
  const make = (id: string, name: string, category: string, actives: string[]) => ({
    ...base,
    id,
    sku: id,
    name,
    category,
    description: `${name} for dandruff and flaky scalp`,
    url: `https://example.com/products/${id}`,
    activeIngredientsJson: actives,
    concernsJson: ["dandruff"],
    skinTypesJson: [],
    sensitiveSkinSuitable: true,
  });
  return [
    make("sh-1", "Vichy Dercos Anti-Dandruff Shampoo", "shampoo", ["selenium sulfide"]),
    make("sh-2", "Ducray Squanorm Shampoo", "shampoo", ["zinc"]),
    make("cond-1", "Mielle Rosemary Conditioner", "conditioner", ["rosemary"]),
    make("oil-1", "Mielle Rosemary Mint Scalp & Hair Strengthening Oil", "scalp serum", ["rosemary"]),
    make("oil-2", "Weleda Rosemary Scalp Tonic", "scalp tonic", ["rosemary"]),
  ];
})();

vi.mock("@/services/catalog", () => ({
  getTenantBySlug: async () => seedTenant,
  listTenantProducts: async () => hairCatalogue,
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
  let last: { products?: { id: string; slot: string; name: string }[] } = {};
  for (const line of ["I have dandruff", "no", "no"]) {
    last = await ask(line, slots);
    slots = (last as { slots?: Record<string, unknown> }).slots ?? slots;
  }
  return { slots, products: last.products ?? [] };
};

describe("arguing with a hair routine", () => {
  it("reaches a routine to argue with", async () => {
    const { products } = await toHairRoutine();
    expect(products.length).toBeGreaterThanOrEqual(3);
    expect(products.map((product) => product.slot)).toContain("shampoo");
    expect(products.map((product) => product.slot)).toContain("scalp care");
  });

  it("swaps the oil when the shopper says they don't like oil", async () => {
    const { slots } = await toHairRoutine();
    const payload = await ask("I don't like oil", slots);
    // Named target, one oil on screen — no "which one?" allowed.
    expect(payload.reply).toMatch(/out goes .* in comes/i);
    expect(payload.reply).toMatch(/strengthening oil/i);
    expect((payload.slots.dislikedIds ?? []).length).toBe(1);
    const names = (payload.products ?? []).map((product: { name: string }) => product.name);
    expect(names.join(" ")).not.toMatch(/strengthening oil/i);
  });

  it("keeps the swap when the routine is later rebuilt", async () => {
    const { slots } = await toHairRoutine();
    const swapped = await ask("I don't like oil", slots);
    const again = await ask("make it stronger", swapped.slots);
    const ids = (again.products ?? []).map((product: { id: string }) => product.id);
    if (ids.length) expect(ids).not.toContain(swapped.slots.dislikedIds[0]);
  });

  it("defends the shampoo with its actual reasoning", async () => {
    const { slots } = await toHairRoutine();
    const payload = await ask("why the shampoo?", slots);
    expect(payload.reply).toMatch(/shampoo|dandruff/i);
    expect(payload.reply).not.toMatch(/which one/i);
    expect(payload.reply).not.toMatch(/outside my world/i);
  });

  it("gives examples from the routine on screen, not a face routine", async () => {
    const { slots } = await toHairRoutine();
    const payload = await ask("swap something", slots);
    expect(payload.reply).toMatch(/which one/i);
    // 'the cleanser' and 'the serum' are face steps; this screen shows a
    // shampoo, a conditioner and scalp care.
    expect(payload.reply).toMatch(/shampoo|conditioner/i);
    expect(payload.reply).not.toMatch(/cleanser|serum/i);
  });

  it("says so honestly when there is nothing to swap to", async () => {
    const { slots } = await toHairRoutine();
    const one = await ask("I don't like oil", slots);
    // Both scalp products are now gone or disliked — a second scalp dislike
    // has no replacement left.
    const two = await ask("I don't like the scalp tonic", one.slots);
    expect(two.reply).toMatch(/only product|gentler or fuller/i);
    expect(two.reply).not.toMatch(/out goes/i);
  });
});
