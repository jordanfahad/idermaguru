import { describe, expect, it } from "vitest";
import { runSafetyTriage } from "../src/services/safety-triage";

describe("safety triage", () => {
  it("marks breathing and lip swelling as urgent", () => {
    const result = runSafetyTriage({ mainConcern: "My lips are swelling and I cannot breathe." });
    expect(result.level).toBe("URGENT");
    expect(result.recommendationAllowed).toBe(false);
  });

  it("refers changed bleeding mole", () => {
    const result = runSafetyTriage({ mainConcern: "My mole changed color and is bleeding." });
    expect(["REFER_CLINIC", "URGENT"]).toContain(result.level);
    expect(result.recommendationAllowed).toBe(false);
  });

  it("refers painful cysts and acne scars", () => {
    const result = runSafetyTriage({ mainConcern: "I have painful cysts and acne scars." });
    expect(result.level).toBe("REFER_CLINIC");
    expect(result.recommendationAllowed).toBe(false);
  });

  it("cautions pregnancy and retinol request", () => {
    const result = runSafetyTriage({
      mainConcern: "I am pregnant and want retinol.",
      pregnantOrBreastfeeding: true,
    });
    expect(["CAUTION", "REFER_CLINIC"]).toContain(result.level);
  });

  it("allows mild blackheads and oily skin", () => {
    const result = runSafetyTriage({
      mainConcern: "I have mild blackheads and oily skin, no allergies.",
      skinType: "oily",
    });
    expect(result.level).toBe("LOW");
    expect(result.recommendationAllowed).toBe(true);
  });

  it("cautions dry sensitive burning skin", () => {
    const result = runSafetyTriage({
      mainConcern: "My skin is dry and sensitive and burns after products.",
      skinType: "sensitive",
      previousIrritationHistory: "burns after products",
    });
    expect(result.level).toBe("CAUTION");
    expect(result.recommendationAllowed).toBe(true);
  });

  it("refers prescription medication requests", () => {
    const result = runSafetyTriage({ mainConcern: "Can I get isotretinoin or antibiotics?" });
    expect(result.level).toBe("REFER_CLINIC");
    expect(result.recommendationAllowed).toBe(false);
  });

  it("allows dull skin simple routine", () => {
    const result = runSafetyTriage({ mainConcern: "I have dull skin and want a simple routine." });
    expect(result.level).toBe("LOW");
    expect(result.recommendationAllowed).toBe(true);
  });

  it("allows melasma and pigmentation as OTC search intent", () => {
    const result = runSafetyTriage({ mainConcern: "How to remove melasma naturally and dark spots" });
    expect(result.level).toBe("LOW");
    expect(result.recommendationAllowed).toBe(true);
  });

  it("allows accepted eczema itching search intent with caution", () => {
    const result = runSafetyTriage({ mainConcern: "Cream for eczema itching" });
    expect(result.level).toBe("CAUTION");
    expect(result.recommendationAllowed).toBe(true);
  });

  it("allows acne scars as OTC search intent unless severe cysts are present", () => {
    const result = runSafetyTriage({ mainConcern: "How to treat acne scars" });
    expect(result.level).toBe("LOW");
    expect(result.recommendationAllowed).toBe(true);
  });
});
