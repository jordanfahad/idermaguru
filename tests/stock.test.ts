import { afterEach, describe, expect, it, vi } from "vitest";
import { readAvailability, resetStockCache, soldOutProductIds, storefrontStockUrl } from "../src/services/stock";
import { buildRecommendations } from "../src/services/recommendation-engine";
import { seedProducts, seedTenant } from "../src/data/seed-catalog";
import { runSafetyTriage } from "../src/services/safety-triage";

afterEach(() => {
  resetStockCache();
  vi.unstubAllGlobals();
});

/**
 * A shopper followed a recommended routine to checkout and Shopify pulled the
 * cleanser back out of their cart: "La Roche-Posay Toleriane Face Wash Cleanser,
 * 400ml — SOLD OUT". The catalogue flag was not wrong so much as old; it is
 * written at sync time and merchants sell out in between.
 */
describe("reading the storefront", () => {
  it("builds the public availability URL from the product page", () => {
    expect(storefrontStockUrl("https://cicabelle.com/products/toleriane-face-wash-400ml")).toBe(
      "https://cicabelle.com/products/toleriane-face-wash-400ml.js",
    );
  });

  it("has nothing to ask when the URL is not a product page", () => {
    expect(storefrontStockUrl("https://cicabelle.com/collections/all")).toBeNull();
    expect(storefrontStockUrl("not a url")).toBeNull();
  });

  it("treats a product with no sellable variant as sold out", () => {
    expect(readAvailability({ available: false, variants: [{ available: false }] })).toBe(false);
    expect(readAvailability({ available: true, variants: [{ available: false }, { available: true }] })).toBe(true);
  });

  it("assumes available whenever the answer is unreadable", () => {
    // Hiding a sellable product costs the merchant a sale, and a network blip
    // is not evidence of anything.
    expect(readAvailability(null)).toBe(true);
    expect(readAvailability("<!doctype html>")).toBe(true);
    expect(readAvailability({})).toBe(true);
  });

  it("names the sold-out products and nothing else", async () => {
    vi.stubGlobal("fetch", async (url: string) =>
      new Response(JSON.stringify({ available: !url.includes("toleriane") }), { status: 200 }),
    );

    const soldOut = await soldOutProductIds([
      { id: "a", url: "https://cicabelle.com/products/toleriane-face-wash-400ml" },
      { id: "b", url: "https://cicabelle.com/products/effaclar-serum" },
    ]);

    expect([...soldOut]).toEqual(["a"]);
  });

  it("keeps everything when the storefront cannot be reached", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("ECONNRESET");
    });

    const soldOut = await soldOutProductIds([{ id: "a", url: "https://cicabelle.com/products/anything" }]);
    expect(soldOut.size).toBe(0);
  });

  it("only asks the storefront once per product", async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ available: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const one = [{ id: "a", url: "https://cicabelle.com/products/thing" }];
    await soldOutProductIds(one);
    await soldOutProductIds(one);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

/**
 * The routine is REBUILT without the sold-out product rather than trimmed, so
 * the shopper gets the next-best cleanser instead of a routine with no cleanser
 * in it.
 */
describe("rebuilding around what is gone", () => {
  const base = {
    tenantId: seedTenant.id,
    profile: { mainConcern: "dark spots and dullness", skinType: "combination" },
    safety: runSafetyTriage({ mainConcern: "dark spots and dullness" }),
    products: seedProducts,
    sponsoredEnabled: false,
  };

  it("replaces an excluded step instead of dropping it", () => {
    const first = buildRecommendations(base);
    expect(first.items.length).toBeGreaterThan(0);

    const dropped = first.items[0];
    const rebuilt = buildRecommendations({
      ...base,
      excludeProductIds: new Set([dropped.product.id]),
    });

    expect(rebuilt.items.some((item) => item.product.id === dropped.product.id)).toBe(false);
    // the step itself survives — this is the whole point of rebuilding
    expect(rebuilt.items.some((item) => item.step === dropped.step)).toBe(true);
  });
});
