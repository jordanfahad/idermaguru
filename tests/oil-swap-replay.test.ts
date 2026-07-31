import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedProducts, seedTenant } from "../src/data/seed-catalog";
import rows from "./fixtures/cicabelle-hair.json";
import { resetStockCache } from "../src/services/stock";

/**
 * Faithful replay of a live session against the merchant's REAL hair rows
 * (names, categories, priorities, concern tags — verbatim from the database):
 *
 *   You      I don't like oil. Replace oil with something else.
 *   Advisor  I did look — that's genuinely the only product in this store
 *            that fits that step ...            [said twice]
 *   You      Remove myli hair oil.
 *   Advisor  I've had another look and I'd still put you on the same 3 steps
 *
 * The catalogue has SIX products that can hold the scalp step. "The only
 * product that fits" was false, and "remove" wasn't a swap verb at all.
 */

const base = seedProducts.filter((product) => product.tenantId === seedTenant.id)[0];
const catalogue = (rows as Record<string, unknown>[]).map((row) => ({ ...base, ...row }));

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
  for (const line of ["I'm having dandruff", "No", "No, not at all."]) {
    const payload = await ask(line, slots);
    slots = payload.slots ?? slots;
  }
  return slots;
};

describe("the oil swap against the real catalogue", () => {
  it("swaps the oil for a real scalp alternative", async () => {
    const slots = await toRoutine();
    const payload = await ask("I don't like oil. Replace oil with something else.", slots);
    expect(payload.reply).not.toMatch(/only product in this store/i);
    // "oil" matches two products on screen, so both leave at once.
    expect(payload.reply).toMatch(/out, for good|out goes .* in comes/i);
    const names = (payload.products ?? []).map((product: { name: string }) => product.name).join(" | ");
    expect(names).not.toMatch(/strengthening oil|castor oil/i);
    expect((payload.products ?? []).length).toBeGreaterThan(0);
  });

  it("understands 'Remove myli hair oil' as the same request", async () => {
    const slots = await toRoutine();
    const payload = await ask("Remove myli hair oil.", slots);
    expect(payload.reply).not.toMatch(/same 3 steps/i);
    expect(payload.reply).toMatch(/out goes .* in comes|out, for good/i);
  });

  it("treats 'on the website I can still see X' as the product request it is", async () => {
    const slots = await toRoutine();
    const refused = await ask("I don't like oil. Replace oil with something else.", slots);
    const payload = await ask(
      "Now, what I'm saying is that on the website, I can still see Ordinary Multipeptide Hair Serum.",
      refused.slots ?? slots,
    );
    expect(payload.reply).not.toMatch(/outside my world|same 3 steps/i);
    const ids = (payload.products ?? []).map((product: { id: string }) => product.id);
    expect(ids).toContain("cica-csv-1779892727414-397");
  });
});
