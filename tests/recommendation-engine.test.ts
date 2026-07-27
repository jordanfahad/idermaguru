import { describe, expect, it } from "vitest";
import type { ProductCatalogItem } from "../src/domain/skincare";
import { seedProducts, seedTenant } from "../src/data/seed-catalog";
import { buildRecommendations } from "../src/services/recommendation-engine";
import { runSafetyTriage } from "../src/services/safety-triage";

describe("recommendation filtering", () => {
  it("excludes salicylic acid products for salicylic acid allergy", () => {
    const profile = {
      mainConcern: "I have mild blackheads and oily skin.",
      skinType: "oily",
      allergies: ["salicylic acid"],
    };
    const safety = runSafetyTriage(profile);
    const result = buildRecommendations({
      tenantId: seedTenant.id,
      profile,
      safety,
      products: seedProducts,
      sponsoredEnabled: true,
    });
    expect(result.items.some((item) => item.product.activeIngredientsJson.includes("salicylic acid"))).toBe(false);
  });

  it("recommends suitable OTC routine for mild blackheads and oily skin", () => {
    const profile = {
      mainConcern: "I have mild blackheads and oily skin, no allergies.",
      skinType: "oily",
      routinePreference: "simple",
    };
    const safety = runSafetyTriage(profile);
    const result = buildRecommendations({
      tenantId: seedTenant.id,
      profile,
      safety,
      products: seedProducts,
      sponsoredEnabled: true,
    });
    expect(result.safety.level).toBe("LOW");
    expect(result.items.length).toBeGreaterThanOrEqual(3);
    expect(result.items.every((item) => item.product.tenantId === seedTenant.id)).toBe(true);
  });

  it("does not recommend active acne routine for referral cases", () => {
    const profile = { mainConcern: "I have painful cysts and acne scars." };
    const safety = runSafetyTriage(profile);
    const result = buildRecommendations({
      tenantId: seedTenant.id,
      profile,
      safety,
      products: seedProducts,
      sponsoredEnabled: true,
    });
    expect(result.items).toHaveLength(0);
    expect(result.safety.recommendationAllowed).toBe(false);
  });

  it("excludes retinoid products during pregnancy", () => {
    const retinol: ProductCatalogItem = {
      ...seedProducts[0],
      id: "unsafe_retinol",
      sku: "UNSAFE-RET",
      name: "Sponsored Retinol Night Serum",
      category: "serum",
      activeIngredientsJson: ["retinol"],
      concernsJson: ["texture", "dullness"],
      pregnancySafety: "AVOID",
      merchantPriority: 10,
      sponsoredBidCpc: 5,
    };
    const profile = {
      mainConcern: "I am pregnant and want retinol.",
      pregnantOrBreastfeeding: true,
    };
    const safety = runSafetyTriage(profile);
    const result = buildRecommendations({
      tenantId: seedTenant.id,
      profile,
      safety,
      products: [...seedProducts, retinol],
      sponsoredEnabled: true,
    });
    expect(result.items.some((item) => item.product.id === "unsafe_retinol")).toBe(false);
  });

  it("excludes sponsored product when unsafe despite commercial priority", () => {
    const unsafeSponsored: ProductCatalogItem = {
      ...seedProducts[0],
      id: "unsafe_acid",
      sku: "UNSAFE-ACID",
      name: "Sponsored Strong Acid Peel",
      category: "exfoliant",
      activeIngredientsJson: ["glycolic acid"],
      concernsJson: ["texture", "dullness"],
      avoidIfJson: ["very sensitive", "barrier damage"],
      sensitiveSkinSuitable: false,
      merchantPriority: 10,
      sponsoredBidCpc: 10,
    };
    const profile = {
      mainConcern: "My skin is dry and sensitive and burns after products.",
      skinType: "sensitive",
      sensitivity: "very sensitive",
      previousIrritationHistory: "burns after products",
    };
    const safety = runSafetyTriage(profile);
    const result = buildRecommendations({
      tenantId: seedTenant.id,
      profile,
      safety,
      products: [...seedProducts, unsafeSponsored],
      sponsoredEnabled: true,
    });
    expect(result.items.some((item) => item.product.id === "unsafe_acid")).toBe(false);
    expect(result.items.every((item) => item.product.sensitiveSkinSuitable || item.product.category === "sunscreen")).toBe(true);
  });
});

describe("ingredient conflicts", () => {
  const retinoid: ProductCatalogItem = {
    ...seedProducts[0],
    id: "conflict_retinoid",
    sku: "CONF-RET",
    name: "Retinol Night Serum",
    category: "face serums",
    description: "A retinol serum for lines and texture.",
    activeIngredientsJson: ["retinol"],
    concernsJson: ["wrinkles", "fine lines"],
    merchantPriority: 99,
  };
  const acid: ProductCatalogItem = {
    ...seedProducts[0],
    id: "conflict_acid",
    sku: "CONF-ACID",
    name: "Glycolic Exfoliant 10%",
    category: "exfoliants",
    description: "A weekly glycolic exfoliant.",
    activeIngredientsJson: ["glycolic acid"],
    concernsJson: ["texture", "dullness"],
    merchantPriority: 99,
  };
  const profile = { mainConcern: "wrinkles and rough texture", skinType: "normal" };
  const layering = /different nights/i;

  it("warns on both halves when a retinoid and an acid share a routine", () => {
    const result = buildRecommendations({
      tenantId: seedTenant.id,
      profile,
      safety: runSafetyTriage(profile),
      products: [...seedProducts, retinoid, acid],
      sponsoredEnabled: false,
    });

    const ret = result.items.find((item) => item.product.id === "conflict_retinoid");
    const exf = result.items.find((item) => item.product.id === "conflict_acid");
    expect(ret, "retinoid should be in the routine").toBeDefined();
    expect(exf, "exfoliant should be in the routine").toBeDefined();
    expect(ret!.cautions.some((c) => layering.test(c))).toBe(true);
    expect(exf!.cautions.some((c) => layering.test(c))).toBe(true);

    // The warning has to name the product to separate it from, or it is not
    // actionable. The routine may hold more than one acid — the seed catalogue
    // has an exfoliating toner too — so the retinoid may be paired with either.
    const acidNames = result.items
      .filter((item) => /glycolic|lactic|mandelic|salicylic|azelaic/i.test(item.product.activeIngredientsJson.join(" ")))
      .map((item) => item.product.name);
    expect(acidNames.length).toBeGreaterThan(0);
    expect(ret!.cautions.some((c) => acidNames.some((name) => c.includes(name)))).toBe(true);
    expect(exf!.cautions.some((c) => c.includes(retinoid.name))).toBe(true);
  });

  it("does not warn when only a retinoid is present", () => {
    const noAcids = seedProducts.filter(
      (product) => !/glycolic|lactic|mandelic|salicylic|azelaic/i.test(product.activeIngredientsJson.join(" ")),
    );
    const result = buildRecommendations({
      tenantId: seedTenant.id,
      profile,
      safety: runSafetyTriage(profile),
      products: [...noAcids, retinoid],
      sponsoredEnabled: false,
    });

    expect(result.items.every((item) => item.cautions.every((c) => !layering.test(c)))).toBe(true);
  });
});

describe("summary copy", () => {
  it("does not name a concern the shopper never gave", () => {
    for (const mainConcern of ["", "   ", "none of the above"]) {
      const profile = { mainConcern };
      const result = buildRecommendations({
        tenantId: seedTenant.id,
        profile,
        safety: runSafetyTriage(profile),
        products: seedProducts,
        sponsoredEnabled: false,
      });
      expect(result.summary, JSON.stringify(mainConcern)).not.toMatch(/routine for\s*\./);
      expect(result.summary).not.toMatch(/routine for none of the above/i);
    }
  });
});
