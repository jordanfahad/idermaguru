import { describe, expect, it } from "vitest";
import { mapShopifyProduct, parseIngredients, type ShopifyProduct } from "@/services/shopify-sync";

/**
 * Reading the ingredient list a merchant keeps in Shopify.
 *
 * The catalogue has carried an empty ingredients array since the sync was
 * written, because REST's products.json returns no metafields and nobody had
 * asked for them. Cicabelle is filling `custom.ingredients` across 444
 * products, so the sync has to read it.
 *
 * The chip on the product panel is the visible reason. It is not the important
 * one. Every safety derivation in the mapper — actives, pregnancy status,
 * whether a product is gentle enough for sensitive skin — is regex-matched
 * against the product's TEXT, which until now meant a marketing title and a
 * description. A retinol cream sold as "Overnight Renewal Treatment" had no
 * actives and an UNKNOWN pregnancy status, and went straight past the
 * pregnancy gate. An INCI list names what is in the bottle.
 */

function product(overrides: Partial<ShopifyProduct> = {}): ShopifyProduct {
  return {
    id: 42,
    title: "Overnight Renewal Treatment",
    body_html: "<p>A luxurious night cream for a refreshed morning.</p>",
    vendor: "Cicabelle",
    product_type: "moisturiser",
    handle: "overnight-renewal-treatment",
    tags: "",
    status: "active",
    images: [{ src: "https://example.com/a.jpg" }],
    variants: [{ id: 1, price: "120.00", sku: "ORT-50", inventory_quantity: 5 }],
    ...overrides,
  };
}

const map = (ingredients?: string | null) => mapShopifyProduct(product(), "tenant-1", "shop.myshopify.com", "AED", ingredients);

describe("parsing an ingredient list", () => {
  it("splits the commas every carton in the world uses", () => {
    expect(parseIngredients("Aqua, Glycerin, Niacinamide")).toEqual(["Aqua", "Glycerin", "Niacinamide"]);
  });

  it("splits semicolons and newlines, which is what a spreadsheet paste produces", () => {
    expect(parseIngredients("Aqua; Glycerin\nNiacinamide")).toEqual(["Aqua", "Glycerin", "Niacinamide"]);
  });

  it("strips the HTML a rich-text field brings with it", () => {
    expect(parseIngredients("<p>Aqua, <strong>Glycerin</strong></p>")).toEqual(["Aqua", "Glycerin"]);
  });

  it("collapses the whitespace of a hand-typed cell", () => {
    expect(parseIngredients("Aqua ,   Glycerin  ,\t Niacinamide")).toEqual(["Aqua", "Glycerin", "Niacinamide"]);
  });

  it("drops the fragments a trailing full stop leaves behind", () => {
    expect(parseIngredients("Aqua, Glycerin, .")).toEqual(["Aqua", "Glycerin"]);
    expect(parseIngredients("Aqua,,,Glycerin")).toEqual(["Aqua", "Glycerin"]);
  });

  it("does not repeat an ingredient listed twice", () => {
    expect(parseIngredients("Aqua, Glycerin, Aqua")).toEqual(["Aqua", "Glycerin"]);
  });

  it("treats an empty or missing metafield as no ingredients", () => {
    // Every shop that has not created the definition is in this case, and must
    // sync exactly as it does today.
    expect(parseIngredients(undefined)).toEqual([]);
    expect(parseIngredients(null)).toEqual([]);
    expect(parseIngredients("   ")).toEqual([]);
  });

  it("is bounded, because one pathological cell is read on every catalogue load", () => {
    const many = Array.from({ length: 300 }, (_, i) => `Ingredient ${i}`).join(", ");
    expect(parseIngredients(many).length).toBeLessThanOrEqual(80);
    const huge = `Aqua, ${"x".repeat(5000)}`;
    expect(parseIngredients(huge)).toEqual(["Aqua"]);
  });
});

describe("what the ingredient list changes about a product", () => {
  it("stores the list", () => {
    const mapped = map("Aqua, Glycerin, Niacinamide");
    expect(mapped?.ingredientsJson).toEqual(["Aqua", "Glycerin", "Niacinamide"]);
  });

  it("finds actives a marketing title never mentions", () => {
    // The whole point. "Overnight Renewal Treatment" says nothing about what is
    // in it; the INCI list does.
    const without = map();
    const with_ = map("Aqua, Glycerin, Retinol, Tocopherol");
    expect(without?.activeIngredientsJson).not.toContain("retinol");
    expect(with_?.activeIngredientsJson).toContain("retinol");
  });

  it("closes the pregnancy gate the title had left open", () => {
    // The one that matters. A retinol product with an UNKNOWN pregnancy status
    // passes a filter that an AVOID would have stopped.
    const without = map();
    const with_ = map("Aqua, Glycerin, Retinol, Tocopherol");
    expect(without?.pregnancySafety).toBe("UNKNOWN");
    expect(with_?.pregnancySafety).toBe("AVOID");
    expect(with_?.avoidIfJson).toContain("pregnancy");
  });

  it("changes nothing for a product with no metafield", () => {
    // Every merchant who has not filled this in must sync byte for byte as
    // before, so turning the reader on cannot quietly rewrite a catalogue.
    const before = map();
    const after = map("");
    expect(after).toEqual(before);
    expect(after?.ingredientsJson).toEqual([]);
  });

  it("never lets the list crowd out the rest of the text", () => {
    // The description and title still have to be matched against; an
    // ingredient list long enough to push them out of the window would lose
    // the concern tags that come from the marketing copy.
    const long = Array.from({ length: 80 }, (_, i) => `Filler${i}`).join(", ");
    const mapped = mapShopifyProduct(
      product({ title: "Acne Spot Treatment", body_html: "<p>For blemishes and breakouts.</p>" }),
      "tenant-1",
      "shop.myshopify.com",
      "AED",
      long,
    );
    expect(mapped?.concernsJson).toContain("acne");
  });
});
