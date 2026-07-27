import { describe, expect, it } from "vitest";
import type { ProductCatalogItem } from "../src/domain/skincare";
import { seedProducts, seedTenant } from "../src/data/seed-catalog";
import { productKind, routineStep , productHandle, slugify } from "../src/services/product-taxonomy";
import { buildRecommendations } from "../src/services/recommendation-engine";
import { runSafetyTriage } from "../src/services/safety-triage";

/** Categories and names taken verbatim from a real merchant catalogue. */
const item = (category: string, name: string, description = "") => ({ category, name, description });

describe("product kind", () => {
  it("keeps non-skincare out of the face aisle", () => {
    expect(productKind(item("eaux de parfum", "Bleu de Chanel EDP 100ml"))).toBe("fragrance");
    expect(productKind(item("shampoo", "Anti-Dandruff Shampoo 400ml"))).toBe("hair");
    expect(productKind(item("lip balms & treatments", "Laneige Lip Sleeping Mask"))).toBe("lip");
    expect(productKind(item("body wash", "Shower Gel 500ml"))).toBe("body");
    expect(productKind(item("bar soap", "Charcoal Soap Bar"))).toBe("body");
    expect(productKind(item("foundations & concealers", "Fit Me Foundation"))).toBe("makeup");
  });

  it("reads plural merchant categories", () => {
    // Every one of these was misfiled as "other" — and so never recommended —
    // while the patterns matched only the singular noun.
    expect(productKind(item("toners", "Anua Heartleaf Toner 250ml"))).toBe("face");
    expect(productKind(item("eye creams", "Retinol Eye Cream 15ml"))).toBe("face");
    expect(productKind(item("lotions & moisturizers", "CeraVe Moisturising Lotion"))).toBe("face");
    expect(productKind(item("facial cleansers", "Foaming Cleanser 150ml"))).toBe("face");
    expect(productKind(item("face serums", "Niacinamide 10% Serum"))).toBe("face");
  });

  it("is not fooled by devices and accessories", () => {
    expect(productKind(item("ipl hair removal devices", "IPL Laser Hair Removal Handset"))).not.toBe("hair");
    expect(productKind(item("skin care tools", "LED Face Mask 3-Color Light Therapy"))).toBe("other");
    expect(productKind(item("skin care tools", "Cotton Pad For Toner (60 Sheets)"))).toBe("other");
  });

  it("prefers the merchant's label over the marketing blurb", () => {
    // "for face and body" in a blurb must not demote a face cream to body care.
    expect(productKind(item("face moisturizers", "Rich Cream", "A rich cream for face and body."))).toBe("face");
    // ...and a shampoo that promises glowing skin is still a shampoo.
    expect(productKind(item("shampoo", "Glow Shampoo", "Leaves skin and hair radiant."))).toBe("hair");
  });
});

describe("routine step", () => {
  it("treats an SPF moisturiser as sunscreen, not moisturiser", () => {
    expect(routineStep(item("face moisturizers", "Daily Moisturiser SPF 50"))).toBe("sunscreen");
  });

  it("does not turn a moisturiser into a sunscreen because its blurb mentions SPF", () => {
    // This returned the same product as both the moisturiser and the sunscreen
    // of one routine, because the description was read before the label.
    expect(
      routineStep(item("face moisturizers", "Effaclar Duo+", "Follow with SPF 50 every morning.")),
    ).toBe("moisturizer");
  });

  it("places the common steps", () => {
    expect(routineStep(item("facial cleansers", "Gentle Face Wash"))).toBe("cleanser");
    expect(routineStep(item("toners & astringents", "Clarifying Toner"))).toBe("toner");
    expect(routineStep(item("eye creams", "Brightening Eye Cream"))).toBe("eye");
    expect(routineStep(item("skin care masks & peels", "Clay Mask"))).toBe("mask");
    expect(routineStep(item("lotions & moisturizers", "Hydrating Lotion"))).toBe("moisturizer");
    expect(routineStep(item("shampoo", "Anti-Hair Fall Shampoo"))).toBe("shampoo");
    expect(routineStep(item("conditioners", "Repair Conditioner"))).toBe("conditioner");
  });
});

describe("routine integrity", () => {
  const nonSkincare: ProductCatalogItem[] = [
    {
      ...seedProducts[0],
      id: "prod_parfum",
      sku: "EDP-1",
      name: "Signature Eau de Parfum 100ml",
      category: "eaux de parfum",
      description: "A warm amber fragrance for evening wear.",
      merchantPriority: 10,
      sponsoredBidCpc: 5,
    },
    {
      ...seedProducts[0],
      id: "prod_shampoo",
      sku: "SHMP-1",
      name: "Volumising Shampoo 400ml",
      category: "shampoo",
      description: "Adds body to fine hair.",
      merchantPriority: 10,
    },
  ];

  it("never puts perfume or shampoo in a face routine", () => {
    const profile = { mainConcern: "I have dark spots and dullness.", skinType: "combination" };
    const result = buildRecommendations({
      tenantId: seedTenant.id,
      profile,
      safety: runSafetyTriage(profile),
      products: [...seedProducts, ...nonSkincare],
      sponsoredEnabled: true,
    });

    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.some((i) => i.product.id === "prod_parfum")).toBe(false);
    expect(result.items.some((i) => i.product.id === "prod_shampoo")).toBe(false);
    expect(result.items.every((i) => productKind(i.product) === "face")).toBe(true);
  });

  it("shows a duplicated catalogue product only once", () => {
    // A re-imported catalogue held the same sunscreen twice under different ids
    // and SKUs, and a shopper was shown both in one routine. The rows differ
    // enough that they can even land in different steps.
    const base: ProductCatalogItem = {
      ...seedProducts[0],
      name: "CeraVe Hydrating Mineral Sunscreen SPF 30 Face Sheer Tint 50ml",
      category: "sunscreen",
      description: "A mineral sunscreen for daily use.",
      activeIngredientsJson: ["zinc oxide", "titanium dioxide"],
      concernsJson: ["sun protection", "dark spots"],
      merchantPriority: 90,
    };
    const copyA: ProductCatalogItem = { ...base, id: "cica-csv-1779892727414-316", sku: "csv-1779892727414-316" };
    const copyB: ProductCatalogItem = {
      ...base,
      id: "cica-csv-1779897334820-316",
      sku: "csv-1779897334820-316",
      // The second row's blurb pushes it towards a different step.
      category: "lotions & moisturizers",
      merchantPriority: 89,
    };

    const profile = { mainConcern: "dark spots and sun protection", skinType: "combination" };
    const result = buildRecommendations({
      tenantId: seedTenant.id,
      profile,
      safety: runSafetyTriage(profile),
      products: [...seedProducts, copyA, copyB],
      sponsoredEnabled: false,
    });

    const names = result.items.map((item) => item.product.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it("recommends each step at most once", () => {
    const profile = { mainConcern: "My skin is dry and flaky.", skinType: "dry" };
    const result = buildRecommendations({
      tenantId: seedTenant.id,
      profile,
      safety: runSafetyTriage(profile),
      products: seedProducts,
      sponsoredEnabled: false,
    });

    const steps = result.items.map((i) => i.step);
    expect(new Set(steps).size).toBe(steps.length);
  });

  it("explains a pick without falling back to filter language", () => {
    const profile = { mainConcern: "I have blackheads and oily skin.", skinType: "oily" };
    const result = buildRecommendations({
      tenantId: seedTenant.id,
      profile,
      safety: runSafetyTriage(profile),
      products: seedProducts,
      sponsoredEnabled: false,
    });

    expect(result.items.length).toBeGreaterThan(0);
    for (const recommendation of result.items) {
      expect(recommendation.reason).not.toMatch(/passed the safety and suitability filters/);
      expect(recommendation.reason.length).toBeGreaterThan(10);
    }
  });
});

/**
 * The catalogue reached 964 rows for 461 real products because every re-import
 * minted new identities. These are the exact URL pairs that were duplicated in
 * production, kept as a guard.
 */
describe("product identity", () => {
  it("collapses the same product across the raw and custom storefront domain", () => {
    const raw = productHandle("https://a1ce04.myshopify.com/products/acretin-cream-0-05-30ml");
    const custom = productHandle("https://cicabelle.com/products/acretin-cream-0-05-30ml");
    expect(raw).toBe("acretin-cream-0-05-30ml");
    expect(custom).toBe(raw);
  });

  it("ignores query strings, fragments and casing", () => {
    const base = productHandle("https://cicabelle.com/products/cerave-acne-control-gel-40-ml");
    expect(productHandle("https://cicabelle.com/products/CeraVe-Acne-Control-Gel-40-ML?variant=42")).toBe(base);
    expect(productHandle("https://cicabelle.com/products/cerave-acne-control-gel-40-ml#reviews")).toBe(base);
  });

  it("returns nothing for a URL that is not a product page, so the caller falls back", () => {
    expect(productHandle("https://cicabelle.com/collections/sunscreen")).toBe("");
    expect(productHandle("not a url")).toBe("");
  });

  it("derives a stable key from a name when there is no product URL", () => {
    expect(slugify("CeraVe PM Facial Moisturizing Lotion 52ml")).toBe("cerave-pm-facial-moisturizing-lotion-52ml");
    // Same name, same key — that is the whole point.
    expect(slugify("ANUA - Heartleaf 77% Soothing Toner")).toBe(slugify("ANUA  Heartleaf 77%  Soothing Toner"));
  });
});
