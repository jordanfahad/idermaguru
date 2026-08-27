import { describe, expect, it } from "vitest";
import { mapShopifyProduct, readProductTags, type ShopifyProduct } from "@/services/shopify-sync";

/**
 * Reading the tag scheme the store curated, instead of guessing at its copy.
 *
 * Cicabelle's 497 products were restructured into four tag namespaces —
 * `brand:`, `type:`, `concern:`, `ingredient:`. That is a person's answer to
 * "what is this and what does it treat", and until now the sync answered the
 * same question by running regexes over marketing prose and never looked at it.
 *
 * The prose regexes stay. Only 68% of the catalogue carries a concern tag, and
 * every other merchant this is sold to has no tag scheme at all.
 */

function product(overrides: Partial<ShopifyProduct> = {}): ShopifyProduct {
  return {
    id: 7,
    title: "Overnight Renewal Treatment",
    body_html: "<p>A luxurious night cream for a refreshed morning.</p>",
    vendor: "Cicabelle",
    product_type: "Moisturizer",
    handle: "overnight-renewal-treatment",
    tags: "",
    status: "active",
    images: [{ src: "https://cdn.example/a.jpg" }],
    variants: [{ id: 1, price: "120.00", sku: "ORT-50", inventory_quantity: 5 }],
    ...overrides,
  };
}

const map = (tags: string) => mapShopifyProduct(product({ tags }), "t", "shop.myshopify.com");

describe("reading the tag namespaces", () => {
  it("picks the four namespaces out and ignores everything else", () => {
    const read = readProductTags("brand:cosrx, type:serum-ampoule, concern:acne, ingredient:niacinamide, bestseller");
    expect(read.brand).toBe("Cosrx");
    expect(read.concerns).toEqual(["acne"]);
    expect(read.actives).toEqual(["niacinamide"]);
  });

  it("has no opinion about a store with no tag scheme", () => {
    // Every merchant except this one. They must sync exactly as before.
    expect(readProductTags("bestseller, new, sale")).toEqual({ brand: null, concerns: [], actives: [] });
    expect(readProductTags(null)).toEqual({ brand: null, concerns: [], actives: [] });
  });

  it("is bounded, because tags are free text a merchant types", () => {
    const many = Array.from({ length: 400 }, (_, i) => `concern:acne${i}, ingredient:thing-${i}`).join(", ");
    expect(readProductTags(many).actives.length).toBeLessThanOrEqual(40);
  });
});

describe("what a concern tag changes", () => {
  it("counts the four concerns the prose regexes cannot see", () => {
    // The reason the map exists. "ageing" does not match /anti-?ag/,
    // "sensitivity" does not match /sensitive/, and "sun-protection" matches
    // none of /spf|sunscreen|uv/ — so without it these three tags do nothing.
    expect(map("concern:ageing")?.concernsJson).toContain("fine lines");
    expect(map("concern:sensitivity")?.concernsJson).toContain("redness");
    expect(map("concern:sun-protection")?.concernsJson).toContain("sun protection");
    expect(map("concern:hair-loss")?.concernsJson).toContain("hair fall");
  });

  it("translates into the vocabulary the recommender speaks", () => {
    expect(map("concern:pigmentation")?.concernsJson).toContain("dark spots");
  });

  it("keeps what the description already said", () => {
    // 32% of the catalogue has no concern tag. Replacing rather than adding
    // would strip that third of everything it has.
    const mapped = mapShopifyProduct(
      product({ title: "Acne Spot Gel", body_html: "<p>For blemishes.</p>", tags: "concern:ageing" }),
      "t",
      "shop.myshopify.com",
    );
    expect(mapped?.concernsJson).toContain("acne");
    expect(mapped?.concernsJson).toContain("fine lines");
  });

  it("does not repeat a concern both sources found", () => {
    const mapped = mapShopifyProduct(
      product({ title: "Acne Spot Gel", tags: "concern:acne" }),
      "t",
      "shop.myshopify.com",
    );
    expect(mapped?.concernsJson.filter((c) => c === "acne")).toHaveLength(1);
  });

  it("ignores a concern value that is not in the vocabulary", () => {
    expect(map("concern:invented-thing")?.concernsJson).not.toContain("invented-thing");
  });
});

describe("what an ingredient tag changes", () => {
  it("closes the pregnancy gate on a product whose name hides its retinoid", () => {
    // The one that matters. "Overnight Renewal Treatment" says nothing about
    // what is in it; the store's own tag does.
    expect(map("")?.pregnancySafety).toBe("UNKNOWN");
    expect(map("ingredient:retinol")?.pregnancySafety).toBe("AVOID");
    expect(map("ingredient:retinol")?.avoidIfJson).toContain("pregnancy");
  });

  it("matches a hyphenated tag against the actives vocabulary", () => {
    // "ingredient:vitamin-c" is already in the raw tags string and misses
    // /vitamin c/ on the hyphen, which is why the de-slugged copy is there.
    expect(map("ingredient:vitamin-c")?.activeIngredientsJson).toContain("vitamin c");
    expect(map("ingredient:salicylic-acid")?.activeIngredientsJson).toContain("salicylic acid");
    expect(map("ingredient:hyaluronic-acid")?.activeIngredientsJson).toContain("hyaluronic acid");
  });

  it("puts a salicylic tag on pregnancy caution", () => {
    expect(map("ingredient:salicylic-acid")?.pregnancySafety).toBe("CAUTION");
  });

  it("does not pass an active off as the full ingredient list", () => {
    // The "What's in it?" chip answers with an INCI list. Three actives are not
    // what is in the bottle, and showing them as though they were would be a
    // lie a shopper could act on.
    expect(map("ingredient:niacinamide, ingredient:centella")?.ingredientsJson).toEqual([]);
  });
});

describe("what a brand tag changes", () => {
  it("names the brand instead of the shop", () => {
    // Every product in this store carries vendor "Cicabelle", so the advisor
    // could not tell one brand from another.
    expect(map("")?.brand).toBe("Cicabelle");
    expect(map("brand:la-roche-posay")?.brand).toBe("La Roche Posay");
  });

  it("leaves vendor alone for a store that tags no brands", () => {
    expect(mapShopifyProduct(product({ vendor: "COSRX" }), "t", "shop.myshopify.com")?.brand).toBe("COSRX");
  });
});
