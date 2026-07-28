import { describe, expect, it } from "vitest";
import {
  classifyDistress,
  distressCopy,
  readFeeling,
  reactionTo,
  usableReaction,
} from "../src/services/empathy";
import { classifyOpening } from "../src/services/voice-agent";

/**
 * The transcript that prompted all of this:
 *
 *   You      I have a bullet wound
 *   Advisor  Just to be clear, I only cover skin and hair here.
 *
 * Every sentence in it is true. None of it is an acceptable thing to say to
 * someone who has just told you they have been shot.
 */
describe("someone in trouble", () => {
  const emergencies = [
    "I have a bullet wound",
    "I've been shot in the leg",
    "I was stabbed",
    "I can't breathe properly",
    "my brother is unconscious and won't wake up",
    "she's having a seizure",
    "I think I'm having a heart attack",
    "the cut won't stop bleeding",
  ];

  for (const utterance of emergencies) {
    it(`treats "${utterance}" as an emergency`, () => {
      expect(classifyDistress(utterance)).toBe("emergency");
    });
  }

  const urgent = ["I have a broken arm", "I broke my wrist", "I think my ankle is fractured", "I need stitches"];

  for (const utterance of urgent) {
    it(`sends "${utterance}" to a hospital or clinic`, () => {
      expect(classifyDistress(utterance)).toBe("urgent-care");
    });
  }

  it("opens with sympathy and names where to go", () => {
    const reply = distressCopy("urgent-care", "en");
    expect(reply).toMatch(/sorry/i);
    expect(reply).toMatch(/emergency services/i);
    expect(reply).toMatch(/hospital|clinic/i);
    // and never tries to keep selling
    expect(reply).not.toMatch(/routine|product|serum|skin type/i);
  });

  it("does not answer a shot shopper with a redirect to skincare", () => {
    // Without the distress check this classified as an ordinary tangent, which
    // is exactly how the canned "I only cover skin and hair" line was reached.
    expect(classifyOpening("I have a bullet wound")).toBe("offtopic");
    expect(classifyDistress("I have a bullet wound")).toBe("emergency");
  });

  it("answers self-harm as a person rather than as a shop", () => {
    expect(classifyDistress("I want to kill myself")).toBe("crisis");
    const reply = distressCopy("crisis", "en");
    expect(reply).toMatch(/sorry|glad you said/i);
    expect(reply).not.toMatch(/product|routine|catalogue/i);
  });
});

/**
 * The counterweight. An advisor that sends every second shopper to A&E is worse
 * than one that never does, so the ordinary skin complaints that happen to
 * share a word with an emergency have to stay ordinary.
 */
describe("not an emergency", () => {
  const ordinary = [
    "I have a rash",
    "I was bitten by a mosquito and it's itchy",
    "I've got a poison ivy rash on my arm",
    "this cream isn't fitting my skin",
    "my hair fell out after I dyed it",
    "my face burns after I use the toner",
    "I have dry patches on my elbows",
    "dark knuckles",
  ];

  for (const utterance of ordinary) {
    it(`leaves "${utterance}" to the normal flow`, () => {
      expect(classifyDistress(utterance)).toBeNull();
    });
  }
});

describe("reacting like a person", () => {
  it("hears discomfort", () => {
    expect(readFeeling("my skin stings and burns all day")).toBe("sore");
    expect(reactionTo("my skin stings and burns all day", "en")).toMatch(/sorry|uncomfortable/i);
  });

  it("hears exhaustion", () => {
    expect(readFeeling("I've tried everything and nothing works")).toBe("frustrated");
    expect(readFeeling("I've had this for years")).toBe("frustrated");
  });

  it("hears embarrassment and does not make it worse", () => {
    expect(readFeeling("this is embarrassing to ask")).toBe("self-conscious");
    expect(reactionTo("this is embarrassing to ask", "en")).toMatch(/nothing to be shy/i);
  });

  it("hears worry", () => {
    expect(readFeeling("I'm scared it's something serious")).toBe("worried");
  });

  it("plays along with a joke", () => {
    expect(readFeeling("haha just kidding")).toBe("amused");
  });

  it("commiserates with a complaint that is uncomfortable by definition", () => {
    // "I have a rashes" carries no feeling word and was answered "Got it.".
    // Nobody has ever been pleased about a rash.
    expect(readFeeling("I have a rashes")).toBe("sore");
    expect(readFeeling("my scalp is itchy")).toBe("sore");
    expect(reactionTo("I have a rashes", "en")).toMatch(/sorry/i);
  });

  it("says nothing rather than manufacturing sympathy", () => {
    // A flat statement of fact does not want commiserating with.
    expect(readFeeling("I have acne")).toBeNull();
    expect(readFeeling("I want to even out my skin tone")).toBeNull();
    // A flat statement gets the plain acknowledgement. Sympathy for "I want a
    // glow routine" reads as a machine performing feelings.
    expect(readFeeling("I want a glow routine")).toBeNull();
    expect(reactionTo("oily", "en")).toBe("");
    expect(reactionTo("no", "en")).toBe("");
  });

  it("reacts in Arabic too", () => {
    expect(reactionTo("جلدي يحرقني", "ar")).toBe("");
    expect(reactionTo("my skin is sore", "ar")).toMatch(/[؀-ۿ]/);
  });
});

/**
 * A model asked for one warm sentence will occasionally hand back a question, a
 * product, or a diagnosis. The reaction is a nicety, and a nicety is never
 * worth a compliance risk, so anything that is not plainly a reaction is
 * dropped and the deterministic line is used instead.
 */
describe("guarding a model-written reaction", () => {
  it("keeps a plain human sentence", () => {
    expect(usableReaction("Oh no, that sounds really frustrating.")).toBe("Oh no, that sounds really frustrating.");
    expect(usableReaction('  "Ah, I\'m sorry to hear that."  ')).toBe("Ah, I'm sorry to hear that.");
  });

  it("drops anything that asks, advises, sells or diagnoses", () => {
    expect(usableReaction("That sounds sore — how long has it been like that?")).toBe("");
    expect(usableReaction("I'm sorry! Try a gentle cleanser twice a day.")).toBe("");
    expect(usableReaction("That sounds like eczema.")).toBe("");
    expect(usableReaction("Sorry to hear it. I'd recommend a niacinamide serum.")).toBe("");
  });

  it("drops a speech", () => {
    expect(usableReaction("A".repeat(200))).toBe("");
    expect(usableReaction("One. Two. Three. Four.")).toBe("");
  });
});
