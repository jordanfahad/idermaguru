import { describe, expect, it } from "vitest";
import { selectRelevantCuratedProducts } from "../src/components/live-consultation-search";
import { liveConsultationOne } from "../src/data/live-consultations";
import type { RoutineRecommendation } from "../src/domain/skincare";

// A non-empty engine result means safety triage allowed recommendations.
const allowedRecommendation = {
  summary: "Here is a simple OTC routine.",
  disclosureText: "",
  items: [{} as never],
  safety: { level: "LOW", reasons: [], recommendationAllowed: true },
} as unknown as RoutineRecommendation;

const baseForm = {
  mainConcern: "oily skin and blackheads",
  skinType: "oily",
  sensitivity: "low",
  allergies: "",
  currentActives: "",
  pregnantOrBreastfeeding: false,
};

describe("curated display safety filtering (shopper-facing cards)", () => {
  it("excludes salicylic-acid products when the shopper reports a salicylic acid allergy", () => {
    const selected = selectRelevantCuratedProducts(
      liveConsultationOne.products,
      liveConsultationOne.vendors,
      { ...baseForm, allergies: "salicylic acid" },
      allowedRecommendation,
    );
    const hasSalicylic = selected.some((product) =>
      /salicylic|bha/i.test(`${product.name} ${product.why} ${(product.keywords ?? []).join(" ")}`),
    );
    expect(hasSalicylic).toBe(false);
  });

  it("excludes retinoid products during pregnancy", () => {
    const retinoid = {
      ...liveConsultationOne.products[0],
      id: "test-retinol",
      name: "Test Retinol Night Serum",
      why: "A retinol serum for texture and fine lines.",
      keywords: ["retinol", "retinoid", "texture", "fine lines"],
    };
    const selected = selectRelevantCuratedProducts(
      [retinoid, ...liveConsultationOne.products],
      liveConsultationOne.vendors,
      { ...baseForm, pregnantOrBreastfeeding: true, mainConcern: "texture and fine lines" },
      allowedRecommendation,
    );
    expect(selected.some((product) => product.id === "test-retinol")).toBe(false);
  });

  it("shows no products when safety triage blocked the engine (no items)", () => {
    const blocked = { ...allowedRecommendation, items: [] } as unknown as RoutineRecommendation;
    const selected = selectRelevantCuratedProducts(
      liveConsultationOne.products,
      liveConsultationOne.vendors,
      baseForm,
      blocked,
    );
    expect(selected).toHaveLength(0);
  });
});
