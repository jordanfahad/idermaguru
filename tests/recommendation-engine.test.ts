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
