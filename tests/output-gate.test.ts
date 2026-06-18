import { describe, expect, it } from "vitest";
import { outputContainsProhibitedClaim, validateAssistantTextForSafety } from "../src/services/safety-triage";
import type { SafetyTriage } from "../src/domain/skincare";

const lowAllowed: SafetyTriage = { level: "LOW", reasons: [], recommendationAllowed: true };

describe("output gate — prohibited claim detection (spec §3.3)", () => {
  it("flags cure claims", () => {
    expect(outputContainsProhibitedClaim("This serum will cure your acne fast.")).toBe(true);
    expect(outputContainsProhibitedClaim("Apply nightly and it cures dark spots.")).toBe(true);
  });

  it("flags guaranteed-result claims", () => {
    expect(outputContainsProhibitedClaim("Guaranteed clear skin in two weeks.")).toBe(true);
  });

  it("flags treat/prevent-a-condition claims", () => {
    expect(outputContainsProhibitedClaim("This cream treats your rosacea.")).toBe(true);
    expect(outputContainsProhibitedClaim("It will prevent eczema flare-ups.")).toBe(true);
  });

  it("does not flag legitimate cosmetic routine copy", () => {
    expect(outputContainsProhibitedClaim("Apply the spot treatment in the evening and moisturize.")).toBe(false);
    expect(outputContainsProhibitedClaim("Use a gentle cleanser, hydrating serum, and SPF each morning.")).toBe(false);
    expect(outputContainsProhibitedClaim("This evening treatment supports a smoother, more even look.")).toBe(false);
  });
});

describe("output gate — validateAssistantTextForSafety", () => {
  it("blocks a treat/cure claim and returns safe guidance", () => {
    const result = validateAssistantTextForSafety("This routine will cure your eczema.", lowAllowed);
    expect(result.recommendationAllowed).toBe(false);
    expect(result.referralMessage).toBeTruthy();
  });

  it("blocks output that asserts a disease as a conclusion", () => {
    const result = validateAssistantTextForSafety("You clearly have melanoma on your cheek.", lowAllowed);
    expect(result.recommendationAllowed).toBe(false);
  });

  it("passes through safe cosmetic guidance unchanged", () => {
    const result = validateAssistantTextForSafety(
      "Keep it simple with a gentle cleanser, a hydrating serum, a moisturizer, and sunscreen each morning. Introduce one product at a time.",
      lowAllowed,
    );
    expect(result.recommendationAllowed).toBe(true);
    expect(result.level).toBe("LOW");
  });

  it("keeps an already-blocked triage blocked even for benign output", () => {
    const blocked: SafetyTriage = {
      level: "URGENT",
      reasons: ["red flag in intake"],
      recommendationAllowed: false,
      referralMessage: "Please seek urgent care.",
    };
    const result = validateAssistantTextForSafety("Use a gentle moisturizer.", blocked);
    expect(result.recommendationAllowed).toBe(false);
    expect(result.level).toBe("URGENT");
  });
});
