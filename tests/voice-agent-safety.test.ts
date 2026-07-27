import { describe, expect, it } from "vitest";
import { runSafetyTriage } from "../src/services/safety-triage";
import {
  classifyAside,
  extractAllergies,
  extractSkinType,
  isHairConcern,
  nextQuestion,
  readPregnancyAnswer,
  readYesNo,
  scriptedLines,
  summariseSlots,
  updateSlots,
  type AgentLang,
  type AgentSlots,
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

describe("conversational slot extraction", () => {
  it("asks nothing when the shopper volunteers everything in one breath", () => {
    const slots = updateSlots({}, "I have oily skin with dark spots, I'm 29, not pregnant, no allergies", "en");
    expect(slots.skinType).toBe("oily");
    expect(slots.pregnantOrBreastfeeding).toBe(false);
    expect(slots.allergies).toEqual([]);
    // every required slot filled -> straight to the routine
    expect(nextQuestion(slots, "en")).toBeNull();
  });

  it("captures a named allergy stated up front", () => {
    const slots = updateSlots({}, "dry sensitive skin, allergic to salicylic acid", "en");
    expect(slots.skinType).toBe("sensitive");
    expect(slots.allergies?.join(" ")).toMatch(/salicylic/i);
  });

  it("still asks for what was not volunteered", () => {
    const slots = updateSlots({}, "I have dark spots and dull skin", "en");
    expect(nextQuestion(slots, "en")?.question).toMatch(/skin/i);
  });

  it("does not infer a pregnancy answer from an unrelated sentence", () => {
    const slots = updateSlots({}, "my oily skin breaks out before every holiday", "en");
    expect(slots.pregnantOrBreastfeeding).toBeUndefined();
    expect(nextQuestion(slots, "en")?.question).toMatch(/pregnant|breastfeeding/i);
  });

  it("reads a volunteered pregnancy as a caution, not a skip", () => {
    const slots = updateSlots({}, "dry skin and I'm pregnant", "en");
    expect(slots.pregnantOrBreastfeeding).toBe(true);
  });

  it("does not let an unrelated 'no' cancel a stated pregnancy", () => {
    // "no allergies" used to supply the negative that flipped this to false,
    // silently disabling the retinoid filter for a pregnant shopper.
    for (const utterance of [
      "I want retinol for wrinkles, dry skin, I am pregnant, no allergies",
      "I'm breastfeeding and have no allergies",
      "pregnant, no known allergies, oily skin",
    ]) {
      expect(updateSlots({}, utterance, "en").pregnantOrBreastfeeding).toBe(true);
    }
  });

  it("still reads an explicit negative next to the word", () => {
    for (const utterance of ["oily skin, not pregnant, no allergies", "I'm not breastfeeding"]) {
      expect(updateSlots({}, utterance, "en").pregnantOrBreastfeeding).toBe(false);
    }
    expect(updateSlots({}, "بشرة دهنية ولست حامل", "ar").pregnantOrBreastfeeding).toBe(false);
  });

  it("summarises what it understood", () => {
    const slots = updateSlots({}, "oily skin, not pregnant, no allergies", "en");
    expect(summariseSlots(slots, "en")).toMatch(/oily skin/);
    expect(summariseSlots(slots, "en")).toMatch(/no allergies/);
  });

  it("extracts inline slots in Arabic", () => {
    const slots = updateSlots({}, "بشرتي دهنية ولا يوجد حساسية", "ar");
    expect(slots.skinType).toBe("oily");
    expect(slots.allergies).toEqual([]);
  });
});

describe("transcripts arrive in spellings the patterns must tolerate", () => {
  it("understands breastfeeding however speech-to-text writes it", () => {
    // A real session looped three times on "Breast-feeding": the pattern
    // required the concatenated spelling, and the device produced a hyphen.
    for (const utterance of [
      "Breast-feeding",
      "breast feeding",
      "breastfeeding",
      "I'm breast-feeding",
      "yes, breast feeding",
    ]) {
      expect(readPregnancyAnswer(utterance)).toBe(true);
    }
  });

  it("answers the pregnancy question on the first try", () => {
    const asked = { mainConcern: "blue patching skin", skinType: "dry", askedPregnancy: true };
    const slots = updateSlots(asked, "Breast-feeding", "en");
    expect(slots.pregnantOrBreastfeeding).toBe(true);
    expect(nextQuestion(slots, "en")?.question).toMatch(/allerg/i);
  });

  it("keeps a fact volunteered while a different question was open", () => {
    // The real failure: "Breast-feeding" was said while the agent was asking
    // about skin type. The answer was consumed as a skin type, defaulted, and
    // the pregnancy fact was thrown away - then asked for again.
    const asked = { mainConcern: "blue patching skin", askedSkinType: true };
    const afterVolunteering = updateSlots(asked, "Breast-feeding", "en");
    expect(afterVolunteering.pregnantOrBreastfeeding).toBe(true);
    // and it must not invent a skin type from that sentence
    expect(afterVolunteering.skinType).toBeUndefined();

    const withSkin = updateSlots(afterVolunteering, "dry", "en");
    expect(withSkin.skinType).toBe("dry");
    // pregnancy was already answered, so it is never asked
    expect(nextQuestion(withSkin, "en")?.question).toMatch(/allerg/i);
  });

  it("tolerates hyphens and stray punctuation elsewhere too", () => {
    expect(extractSkinType("combination-skin")).toBe("combination");
    expect(isHairConcern("hair-fall and dandruff")).toBe(true);
    expect(readYesNo("No.")).toBe(false);
    expect(readYesNo("Yes!")).toBe(true);
  });
});

describe("the agent can never trap a shopper in a loop", () => {
  const asked = { mainConcern: "acne", skinType: "oily", pregnantOrBreastfeeding: false, askedAllergies: true };

  it("asks WHICH allergies when the shopper says yes without naming one", () => {
    // "Yes I do" previously parsed to nothing and re-asked the same question
    // forever, because stripping the filler words left no allergen behind.
    const slots = updateSlots(asked, "Yes I do", "en");
    expect(slots.askedAllergyNames).toBe(true);
    expect(nextQuestion(slots, "en")?.question).toMatch(/which/i);
  });

  it("takes the follow-up answer as the allergen list", () => {
    const afterYes = updateSlots(asked, "Yes I do", "en");
    const named = updateSlots(afterYes, "penicillin and fragrance", "en");
    expect(named.allergies?.join(" ")).toMatch(/penicillin/i);
    expect(nextQuestion(named, "en")).toBeNull();
  });

  it("keeps unrecognised words as the allergen rather than looping", () => {
    const afterYes = updateSlots(asked, "yes", "en");
    const named = updateSlots(afterYes, "octinoxate", "en");
    expect(named.allergies).toEqual(["octinoxate"]);
  });

  it("gives up on an unintelligible pregnancy answer the safe way", () => {
    let slots: ReturnType<typeof updateSlots> = {
      mainConcern: "acne",
      skinType: "oily",
      askedPregnancy: true,
    };
    for (let attempt = 0; attempt < 4; attempt += 1) slots = updateSlots(slots, "mmm hmm what", "en");
    // Assumes pregnant, which filters the most, instead of asking forever.
    expect(slots.pregnantOrBreastfeeding).toBe(true);
  });

  it("always terminates: no question survives repeated nonsense", () => {
    let slots: ReturnType<typeof updateSlots> = {};
    slots = updateSlots(slots, "my skin is bad", "en");
    for (let turn = 0; turn < 12; turn += 1) {
      const pending = nextQuestion(slots, "en");
      if (!pending) break;
      slots = updateSlots(pending.slots, "zzz", "en");
    }
    expect(nextQuestion(slots, "en")).toBeNull();
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

describe("discolouration and bruising are not cosmetic concerns", () => {
  it("refuses to sell a routine for blue or purple patches", () => {
    // The transcript that reached a 6-product routine in a real session. Blue
    // or purple patching can be trauma, a bleeding disorder or a medication
    // effect; none of them are answered with a serum.
    for (const utterance of [
      "Blue patching skin",
      "blue patches on my skin",
      "purple blotches on my arms",
      "I keep getting unexplained bruises",
      "black and blue marks",
      "welts on my legs",
    ]) {
      const result = runSafetyTriage({ mainConcern: utterance });
      expect(result.recommendationAllowed).toBe(false);
    }
  });

  it("treats blue lips or fingers as urgent, not a referral", () => {
    for (const utterance of ["my lips are turning blue", "my fingers look bluish"]) {
      expect(runSafetyTriage({ mainConcern: utterance }).level).toBe("URGENT");
    }
  });

  it("does not trip on cosmetic products that contain the word blue", () => {
    for (const utterance of [
      "I want the blue tansy oil for dullness",
      "does blueberry serum help with dark spots",
      "blue light protection sunscreen",
    ]) {
      expect(runSafetyTriage({ mainConcern: utterance }).recommendationAllowed).toBe(true);
    }
  });
});

describe("conversation handles asides without losing the thread", () => {
  it("answers who it is, then returns to the open question", () => {
    expect(classifyAside("what are you")).toBe("identity");
    expect(classifyAside("who are you exactly?")).toBe("identity");
  });

  it("recognises thanks and greetings", () => {
    expect(classifyAside("thank you so much")).toBe("thanks");
    expect(classifyAside("hello there")).toBe("greeting");
  });

  it("treats a genuine tangent as off topic", () => {
    expect(classifyAside("what is the weather tomorrow")).toBe("offtopic");
    expect(classifyAside("who won the football last night")).toBe("offtopic");
  });

  it("never mistakes a real answer for an aside", () => {
    for (const answer of ["no", "yes", "dry", "oily skin", "I'm pregnant", "salicylic acid", "dark spots"]) {
      expect(classifyAside(answer)).toBeNull();
    }
  });
});

describe("scripted lines", () => {
  // The client synthesises these before anyone speaks, so a question missing
  // from the list is a question the shopper waits for on every single turn.
  const states: AgentSlots[] = [
    {},
    { mainConcern: "acne" },
    { mainConcern: "acne", skinType: "oily" },
    { mainConcern: "acne", skinType: "oily", pregnantOrBreastfeeding: false },
    { mainConcern: "acne", skinType: "oily", pregnantOrBreastfeeding: false, askedAllergyNames: true },
  ];

  for (const lang of ["en", "ar"] as AgentLang[]) {
    it(`covers every question the interview can ask (${lang})`, () => {
      const warmed = scriptedLines(lang);
      for (const slots of states) {
        const pending = nextQuestion(slots, lang);
        expect(pending).not.toBeNull();
        expect(warmed).toContain(pending!.question);
      }
    });
  }

  it("has no blank or duplicated lines", () => {
    for (const lang of ["en", "ar"] as AgentLang[]) {
      const warmed = scriptedLines(lang);
      expect(warmed.every((line) => line.trim().length > 0)).toBe(true);
      expect(new Set(warmed).size).toBe(warmed.length);
    }
  });
});
