import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../src/app/api/voice-agent/route";
import { resetStockCache } from "../src/services/stock";
import { routineStep } from "../src/services/product-taxonomy";

/**
 * From a shopper's phone, four steps for dandruff:
 *
 *   SHAMPOO  Vichy DERCOS ANTI-DANDRUFF SHAMPOO FOR DRY HAIR 200ML
 *   SHAMPOO  Vichy DERCOS ANTI-DANDRUFF SHAMPOO FOR DRY HAIR 390ML
 *
 * The same product twice, in two sizes, as two separate steps of a routine.
 * The face builder has guarded against that for a while; the hair path was a
 * separate function that took the four best-scoring products and had no
 * concept of a step at all — so every one of them was a shampoo.
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
  let last: { reply?: string; products?: { name: string; slot: string; step: string }[] } = {};
  for (const line of lines) {
    const response = await POST(
      new Request("http://localhost/api/voice-agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ utterance: line, slots }),
      }),
    );
    last = await response.json();
    slots = (last as { slots?: Record<string, unknown> }).slots ?? slots;
  }
  return last;
}

describe("a hair routine is a routine, not a shelf of shampoo", () => {
  it("never offers two sizes of the same product as two steps", async () => {
    const result = await converse(["I have dandruff", "no", "no"]);
    const products = result.products ?? [];
    // Two sizes of one product differ only by "200ML" / "390ML".
    const families = products.map((product) => product.name.toLowerCase().replace(/\d+\s*ml/g, "").trim());
    expect(new Set(families).size).toBe(families.length);
  });

  it("never repeats a step", async () => {
    const result = await converse(["I have dandruff", "no", "no"]);
    const steps = (result.products ?? []).map((product) => product.step);
    expect(new Set(steps).size).toBe(steps.length);
  });

  it("does not tell a shopper with dandruff to wear sunscreen", async () => {
    const result = await converse(["I have dandruff", "no", "no"]);
    if ((result.products ?? []).length) {
      expect(result.reply).not.toMatch(/sunscreen/i);
      expect(result.reply).toMatch(/hair|scalp/i);
    }
  });
});

describe("hair products land on the step they belong to", () => {
  const product = (name: string, category: string) => ({
    category,
    name,
    description: `${name} for hair`,
  });

  it("separates the steps a hair routine is built from", () => {
    expect(routineStep(product("Dercos Anti-Dandruff Shampoo", "shampoo"))).toBe("shampoo");
    expect(routineStep(product("Nourishing Conditioner", "conditioner"))).toBe("conditioner");
    // A hair mask used to be filed as a conditioner, so a routine could never
    // hold both.
    expect(routineStep(product("Repair Hair Mask", "hair mask"))).toBe("mask");
    expect(routineStep(product("Argan Hair Oil", "hair oil"))).toBe("oil");
    expect(routineStep(product("Anti Hair Loss Scalp Serum", "scalp serum"))).toBe("scalp");
    expect(routineStep(product("Densifying Scalp Tonic", "scalp tonic"))).toBe("scalp");
  });
});
