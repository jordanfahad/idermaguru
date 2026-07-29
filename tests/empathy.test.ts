import { describe, expect, it } from "vitest";
import {
  classifyDistress,
  distressCopy,
  readFeeling,
  readsSorrow,
  reactionTo,
  sorrowCopy,
  sorrowLead,
  usableReaction,
} from "../src/services/empathy";
import { classifyOpening, mentionsSkinOrHair } from "../src/services/voice-agent";

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

  /**
   * Every pattern above is first-person. A shopper reporting somebody else's
   * emergency matched none of them:
   *
   *   You      My friend just jumped out of the balcony
   *   Advisor  That one's outside my world, I'm afraid — skin and hair are
   *            what I know.
   */
  const bystander = [
    "My friend just jumped out of the balcony",
    "my neighbour fell off the roof",
    "someone collapsed in the shop",
    "my brother has been stabbed",
    "my brother is unconscious and won't wake up",
    "my dad had a fall",
  ];

  for (const utterance of bystander) {
    it(`treats "${utterance}" as an emergency for somebody else`, () => {
      expect(classifyDistress(utterance)).toBe("bystander");
    });
  }

  it("opens with shock and sends them to emergency services", () => {
    const reply = distressCopy("bystander", "en");
    // Shock first. A sentence that opens by explaining our scope to a
    // frightened person reads as indifference.
    expect(reply.split(/[.—]/)[0]).toMatch(/oh no/i);
    expect(reply).toMatch(/emergency services/i);
    expect(reply).not.toMatch(/skin or hair concern|outside my world/i);
  });

  it("names no country's emergency number by default", () => {
    // This is sold as a SaaS. A shopper in Berlin told to call 999 is worse
    // off than one told nothing, so digits only appear when a deployment has
    // been configured with them.
    for (const kind of ["emergency", "bystander"] as const) {
      expect(distressCopy(kind, "en")).not.toMatch(/\b(999|911|112)\b/);
      expect(distressCopy(kind, "en")).not.toMatch(/UAE|Emirates/i);
      expect(distressCopy(kind, "en")).toMatch(/emergency services/i);
    }
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

/**
 * "My dog died" was answered "That one's outside my world, I'm afraid — skin
 * and hair are what I know." Every word of that is true and all of it is
 * horrible. Grief is not a tangent to be redirected.
 */
describe("bad news that is not an emergency", () => {
  const grieving = ["My dog died", "my mother passed away last week", "I lost my father", "we had the funeral yesterday"];

  for (const utterance of grieving) {
    it(`hears grief in "${utterance}"`, () => {
      expect(readsSorrow(utterance)).toBe("grief");
      expect(classifyDistress(utterance)).toBeNull();
    });
  }

  it("hears a rough time without calling an ambulance", () => {
    expect(readsSorrow("After the accident")).toBe("misfortune");
    expect(readsSorrow("I was in hospital for a week")).toBe("misfortune");
    expect(classifyDistress("After the accident")).toBeNull();
  });

  it("says sorry, and does not end the conversation", () => {
    const reply = sorrowCopy("grief", "en");
    expect(reply).toMatch(/sorry/i);
    expect(reply).not.toMatch(/outside my world/i);
    // The door stays open — this is not a referral.
    expect(reply).toMatch(/here whenever|i'm here/i);
  });

  /**
   * Speech-to-text renders "I dyed my hair" as "I died my hair" constantly, so
   * a bare "died" can never be enough — the thing that died has to be somebody.
   */
  it("is not fooled by the words around skincare", () => {
    for (const utterance of [
      "I died my hair last week",
      "my hair fell out after dyeing it",
      "dead skin cells on my face",
      "I have dark spots and dull skin",
      "I have dandruff",
    ]) {
      expect(readsSorrow(utterance)).toBeNull();
      expect(classifyDistress(utterance)).toBeNull();
    }
  });

  it("keeps helping when the bad news came with a real concern", () => {
    // "I have scars after the accident" is bad news AND a question we can
    // answer. Diverting it would be its own kind of not listening.
    expect(readsSorrow("I have scars after the accident")).toBe("misfortune");
    expect(mentionsSkinOrHair("I have scars after the accident")).toBe(true);
    expect(mentionsSkinOrHair("My dog died")).toBe(false);
    // and the short condolence is what goes in front of the ordinary flow
    expect(sorrowLead("misfortune", "en")).toMatch(/sorry/i);
    expect(sorrowLead("misfortune", "en").length).toBeLessThan(60);
  });
});
