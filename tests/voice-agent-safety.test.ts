import { describe, expect, it } from "vitest";
import { runSafetyTriage } from "../src/services/safety-triage";
import {
  extractAllergies,
  extractSkinType,
  isHairConcern,
  nextQuestion,
  readPregnancyAnswer,
  readYesNo,
  updateSlots,
} from "../src/services/voice-agent";

/**
 * Voice input is conversational, so red flags arrive in natural phrasing rather
 * than the tidy wording a form produces. These cases previously slipped through
 * as LOW risk and were answered with product recommendations.
 */
describe("red flags in natural speech", () => {
  const mustEscalate = [
    "I have a mole that changed color and is bleeding",
    "there's a mole on my back that has been growing",
    "my mole started itching and looks irregular",
    "this spot keeps bleeding when I wash my face",
    "I have a sore on my cheek that won't heal",
  ];

  for (const utterance of mustEscalate) {
    it(`blocks selling for: "${utterance}"`, () => {
      const result = runSafetyTriage({ mainConcern: utterance });
      expect(result.recommendationAllowed).toBe(false);
      expect(["REFER_CLINIC", "URGENT"]).toContain(result.level);
    });
  }

  it("still allows ordinary cosmetic concerns", () => {
    for (const utterance of [
      "I have dark spots and dull skin",
      "my skin is oily with blackheads",
      "I want a simple glow routine",
    ]) {
      const result = runSafetyTriage({ mainConcern: utterance });
      expect(result.recommendationAllowed).toBe(true);
    }
  });
});

describe("voice dialogue slot filling", () => {
  it("asks skin type, pregnancy and allergies before recommending", () => {
    let slots = updateSlots({}, "I have dark spots and dull skin", "en");
    const first = nextQuestion(slots, "en");
    expect(first?.question).toMatch(/skin/i);

    slots = updateSlots(first!.slots, "oily", "en");
    const second = nextQuestion(slots, "en");
    expect(second?.question).toMatch(/pregnant|breastfeeding/i);

    slots = updateSlots(second!.slots, "no", "en");
    const third = nextQuestion(slots, "en");
    expect(third?.question).toMatch(/allerg/i);

    slots = updateSlots(third!.slots, "no", "en");
    expect(nextQuestion(slots, "en")).toBeNull();
    expect(slots.pregnantOrBreastfeeding).toBe(false);
    expect(slots.allergies).toEqual([]);
  });

  it("records a positive pregnancy answer so the engine can exclude retinoids", () => {
    const asked = { mainConcern: "fine lines", skinType: "normal", askedPregnancy: true };
    const slots = updateSlots(asked, "yes I am", "en");
    expect(slots.pregnantOrBreastfeeding).toBe(true);
  });

  it("captures named allergies from speech", () => {
    const asked = { mainConcern: "acne", skinType: "oily", pregnantOrBreastfeeding: false, askedAllergies: true };
    const slots = updateSlots(asked, "yes I'm allergic to salicylic acid", "en");
    expect(slots.allergies?.join(" ")).toMatch(/salicylic/i);
  });

  it("reads Arabic yes/no and skin types", () => {
    expect(readYesNo("نعم")).toBe(true);
    expect(readYesNo("لا")).toBe(false);
    expect(extractSkinType("بشرتي دهنية")).toBe("oily");
    expect(extractAllergies("no")).toEqual([]);
  });

  it("does not read 'I am a man' as a yes to the pregnancy question", () => {
    // Speech-to-text renders this as "I am a mad"; the old parser matched the
    // substring "i am" and recorded a pregnancy for a male shopper.
    for (const utterance of ["I am a man", "I'm a man", "male"]) {
      expect(readPregnancyAnswer(utterance)).toBe(false);
    }
    // The garbled transcript must stay unresolved so the question is re-asked,
    // rather than being guessed either way.
    expect(readPregnancyAnswer("I am a mad")).toBeUndefined();

    const slots = updateSlots(
      { mainConcern: "acne", skinType: "oily", askedPregnancy: true },
      "I am a mad",
      "en",
    );
    expect(slots.pregnantOrBreastfeeding).toBeUndefined();
    // and the misheard words must not pollute the concern sent to the engine
    expect(slots.mainConcern).toBe("acne");
  });

  it("still records a genuine pregnancy answer", () => {
    expect(readPregnancyAnswer("yes")).toBe(true);
    expect(readPregnancyAnswer("I'm pregnant")).toBe(true);
    expect(readPregnancyAnswer("I am breastfeeding")).toBe(true);
    expect(readPregnancyAnswer("no, not pregnant")).toBe(false);
  });

  it("recognises hair and scalp concerns, which this catalogue cannot serve", () => {
    for (const utterance of ["I have dandruff", "my hair is falling out", "flaky itchy scalp", "قشرة في الشعر"]) {
      expect(isHairConcern(utterance)).toBe(true);
    }
    for (const utterance of ["dark spots and dull skin", "oily skin with blackheads"]) {
      expect(isHairConcern(utterance)).toBe(false);
    }
  });

  it("does not guess a safety answer when the reply is ambiguous", () => {
    const asked = { mainConcern: "acne", skinType: "oily", askedPregnancy: true };
    const slots = updateSlots(asked, "hmm what do you mean", "en");
    expect(slots.pregnantOrBreastfeeding).toBeUndefined();
  });
});
