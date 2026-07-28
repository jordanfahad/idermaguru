import { describe, expect, it } from "vitest";
import { areaRoute, extractBodyArea, needsBodyArea } from "../src/services/body-area";
import { classifyOpening, nextQuestion, scriptedLines, updateSlots } from "../src/services/voice-agent";

/**
 * The second half of that transcript:
 *
 *   You      I have a rashes
 *   Advisor  Got it. How would you describe your skin — oily, dry, combination,
 *            or sensitive?
 *
 * A rash on a cheek, in a skin fold, on the knuckles and between the toes are
 * four different problems, and "is your skin oily?" is a question about a face.
 * The shopper always knows where it is; nobody was asking them.
 */
describe("asking where it is", () => {
  it("asks a shopper with a rash where the rash is", () => {
    const slots = updateSlots({}, "I have a rashes", "en");
    const question = nextQuestion(slots, "en")?.question ?? "";
    expect(question).toMatch(/where/i);
    expect(question).not.toMatch(/oily|combination/i);
  });

  it("takes the answer and stops asking", () => {
    let slots = updateSlots({}, "I have a rash", "en");
    const asked = nextQuestion(slots, "en")!;
    slots = updateSlots(asked.slots, "on my hands", "en");
    expect(slots.bodyArea).toBe("hands");
    expect(areaRoute(slots.bodyArea)).toBe("body");
  });

  it("never asks when they already said where", () => {
    const slots = updateSlots({}, "I have a rash on my face", "en");
    expect(slots.bodyArea).toBe("face");
    expect(nextQuestion(slots, "en")?.question).toMatch(/oily|dry|combination|sensitive/i);
  });

  it("does not ask a face a question about a face", () => {
    // Regression: adding the location question must not add a step to the
    // ordinary path. Nobody calls their knuckles combination-skinned, so a
    // stated skin type is a statement that we are talking about a face.
    for (const opening of [
      "I have dark spots and dull skin",
      "I have oily skin with dark spots",
      "my skin is dry and flaky",
      "blackheads on my nose",
    ]) {
      const slots = updateSlots({}, opening, "en");
      expect(needsBodyArea(slots.mainConcern) && !slots.bodyArea && !slots.skinType).toBe(false);
      expect(nextQuestion(slots, "en")?.question ?? "").not.toMatch(/where/i);
    }
  });

  it("skips the skin-type question once it knows it is not a face", () => {
    let slots = updateSlots({}, "I have a rash", "en");
    slots = updateSlots(nextQuestion(slots, "en")!.slots, "my feet", "en");
    // Straight to the safety questions; "is your skin oily" is meaningless here.
    expect(nextQuestion(slots, "en")?.question).toMatch(/pregnan|breastfeeding/i);
  });

  it("gives up rather than asking a third time", () => {
    let slots = updateSlots({}, "I have a rash", "en");
    slots = updateSlots(nextQuestion(slots, "en")!.slots, "no idea", "en");
    slots = updateSlots(nextQuestion(slots, "en")!.slots, "no idea", "en");
    expect(slots.bodyAreaUnknown).toBe(true);
    // and falls back to the face path rather than stalling
    expect(areaRoute(slots.bodyArea)).toBe("face");
    expect(nextQuestion(slots, "en")?.question).toMatch(/oily|dry|combination|sensitive/i);
  });

  it("does not read a skin type out of a symptom", () => {
    // "dry patches" contains "dry", and that was recorded as a dry SKIN TYPE —
    // a fabrication read back to the shopper, and one that convinced the agent
    // it was talking about a face, so it never asked where the patches were.
    const slots = updateSlots({}, "I've had dry patches for years and nothing works", "en");
    expect(slots.skinType).toBeUndefined();
    expect(nextQuestion(slots, "en")?.question).toMatch(/where/i);
  });

  it("still reads a skin type the shopper actually stated", () => {
    expect(updateSlots({}, "I have oily skin with dark spots", "en").skinType).toBe("oily");
    expect(updateSlots({}, "dry sensitive skin, allergic to salicylic acid", "en").skinType).toBe("sensitive");
    expect(updateSlots({}, "my skin is really dry", "en").skinType).toBe("dry");
    expect(updateSlots({}, "combination", "en").skinType).toBe("combination");
  });

  it("pre-synthesises the new question with the rest", () => {
    expect(scriptedLines("en").some((line) => /where/i.test(line))).toBe(true);
    expect(scriptedLines("ar").length).toBe(scriptedLines("en").length);
  });
});

/**
 * "there are customers who complain dark skin near vagina or elbows or dark
 * knuckles" — none of these contained a word the skin vocabulary knew, so all
 * three were classified as off-topic and answered with "I only cover skin and
 * hair here".
 */
describe("the concerns that were being turned away", () => {
  const skinConcerns = [
    "dark knuckles",
    "my elbows are dark",
    "my underarms are darker than the rest of me",
    "the skin near my bikini line is dark",
    "rough patches on my knees",
    "my knuckles look ashy",
  ];

  for (const utterance of skinConcerns) {
    it(`recognises "${utterance}" as a skin concern`, () => {
      expect(classifyOpening(utterance)).toBeNull();
    });
  }

  it("still turns away what is genuinely not skin", () => {
    expect(classifyOpening("my knee hurts")).toBe("elsewhere");
    expect(classifyOpening("do you sell iphones")).toBe("offtopic");
  });
});

describe("reading the area out of an answer", () => {
  const cases: [string, string][] = [
    ["on my face", "face"],
    ["my cheeks and forehead", "face"],
    ["the back of my neck", "neck"],
    ["my scalp", "scalp"],
    ["knuckles", "hands"],
    ["my hands, mostly the fingers", "hands"],
    ["under my arms", "underarms"],
    ["armpits", "underarms"],
    ["elbows and knees", "elbows-knees"],
    ["between my toes", "feet"],
    ["my heels crack", "feet"],
    ["the bikini area", "intimate"],
    ["near my vagina", "intimate"],
    ["inner thighs", "intimate"],
    ["all over my back", "body"],
    ["my legs", "body"],
  ];

  for (const [utterance, area] of cases) {
    it(`reads "${utterance}" as ${area}`, () => {
      expect(extractBodyArea(utterance)).toBe(area);
    });
  }

  it("routes each area to the pipeline that can answer it", () => {
    expect(areaRoute("face")).toBe("face");
    expect(areaRoute("neck")).toBe("face");
    expect(areaRoute("scalp")).toBe("hair");
    expect(areaRoute("intimate")).toBe("intimate");
    expect(areaRoute("hands")).toBe("body");
    expect(areaRoute(undefined)).toBe("face");
  });
});
