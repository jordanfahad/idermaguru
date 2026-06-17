import { describe, expect, it } from "vitest";
import { selectRelevantCuratedProducts } from "../src/components/live-consultation-search";
import type { LiveConsultationProduct } from "../src/data/live-consultations";
import type { RoutineRecommendation } from "../src/domain/skincare";

const recommendation = {
  summary: "Suggested OTC skincare routine with cleanser, moisturizer, sunscreen, and a serum if suitable.",
  disclosureText: "",
  items: [{}],
  safety: { level: "LOW", reasons: [], recommendationAllowed: true },
} as unknown as RoutineRecommendation;

function product(overrides: Partial<LiveConsultationProduct>): LiveConsultationProduct {
  return {
    id: overrides.id ?? "product",
    vendor: "Cicabelle",
    name: "Product",
    category: "Curated product",
    imageUrl: "",
    price: "AED 99",
    url: "https://cicabelle.com/products/product",
    routineSlot: "Recommended product",
    why: "",
    safety: "",
    trust: "",
    priority: 50,
    inventorySize: 10,
    ...overrides,
  };
}

describe("live consultation product relevance", () => {
  it("keeps acne-safe moisturizer searches on moisturizer products only", () => {
    const selected = selectRelevantCuratedProducts(
      [
        product({
          id: "k18",
          name: "K18 Leave-in Molecular Repair Hair Mask 50ml",
          category: "Hair Care",
          routineSlot: "Hair repair",
          priority: 100,
          keywords: ["hair", "mask", "repair"],
        }),
        product({
          id: "mela-b3",
          name: "La Roche Posay Mela B3 Intense Anti Dark Spot Serum 30ML",
          category: "Serum",
          routineSlot: "Tone support",
          priority: 100,
          keywords: ["serum", "dark spots"],
        }),
        product({
          id: "effaclar-mat",
          name: "La Roche Posay Effaclar Mat Mattifying Moisturizer for Oily Skin 40ml",
          category: "Moisturizer",
          routineSlot: "Oil-control moisture",
          priority: 35,
          keywords: ["oily", "acne", "matte", "lightweight", "moisturizer"],
        }),
        product({
          id: "relief-cream",
          name: "Dr. Althea 345 Relief Cream Daily Face Moisturizer",
          category: "Moisturizer",
          routineSlot: "Barrier moisture",
          priority: 45,
          keywords: ["blemish", "soothing", "barrier", "moisturizer"],
        }),
      ],
      [],
      {
        mainConcern: "acne safe moisturiser",
        skinType: "oily",
        sensitivity: "low",
        allergies: "",
        currentActives: "",
        pregnantOrBreastfeeding: false,
      },
      recommendation,
    );

    expect(selected.map((item) => item.id)).toEqual(["effaclar-mat", "relief-cream"]);
  });
});
