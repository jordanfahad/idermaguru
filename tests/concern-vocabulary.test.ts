import { describe, expect, it } from "vitest";
import { classifyOpening } from "@/services/voice-agent";

/**
 * What counts as a skin or hair concern.
 *
 * A shopper typed "Hello i have dandruf" and was told "that one's outside my
 * world, I'm afraid — skin and hair are what I know." Dandruff is a scalp
 * concern; the sentence contradicts itself in the act of being wrong.
 *
 * Probing the live route turned one typo into twenty: two thirds of a list of
 * ordinary concerns were being brushed off, including rosacea, psoriasis,
 * whiteheads and split ends — all spelled correctly. The classifier's
 * PRECISION was never the problem (nothing off-topic slips through); its skin
 * vocabulary simply had holes, and every hole reads to a shopper as the
 * advisor refusing to help.
 */

const CONCERNS = [
  // The one that was reported, and the near-misses a keyboard or a
  // transcriber produces around it.
  "Hello i have dandruf",
  "i have dandraf",
  "Hello i have dandruff",
  // Conditions the safety triage has always known by name — it lists them in
  // cautionPatterns — while the vocabulary that decides whether to listen at
  // all did not.
  "Hello i have rosacea",
  "I have psoriasis",
  "hello i have melasma",
  "I have keratosis pilaris",
  "I have seborrheic dermatitis",
  "hello i have vitiligo",
  "i have folliculitis",
  "i have alopecia",
  "I have fungal acne",
  "hello i have warts",
  "I have a cold sore",
  // Ordinary words a shopper reaches for, with no condition in them at all.
  "I have whiteheads",
  "I have sun damage",
  "i have crows feet",
  "I have sagging",
  "i have puffiness",
  "hello i have texture issues",
  "i have razor bumps",
  "I have split ends",
];

const NOT_OURS = [
  "do you sell iphones",
  "my car is broken",
  "what is the weather today",
  "i want a refund on my order",
  "where is my delivery",
  "do you have a store in dubai",
  "my phone battery is dying",
  "my dog has fleas",
  "can i speak to a human",
  "what are your opening hours",
];

describe("concerns the advisor must recognise", () => {
  for (const line of CONCERNS) {
    it(`listens to "${line}"`, () => {
      expect(classifyOpening(line), "brushed off as a tangent").toBeNull();
    });
  }
});

describe("what is genuinely not ours", () => {
  // The other half of the test. Widening a vocabulary is only safe if it does
  // not start swallowing everything — "do you sell iphones" must still not
  // become a skin concern.
  for (const line of NOT_OURS) {
    it(`does not take "${line}" as a concern`, () => {
      expect(classifyOpening(line), "accepted as a skin concern").not.toBeNull();
    });
  }
});

describe("the escape hatch that was already there", () => {
  it("still lets a bare unknown word through", () => {
    // One word is a concern, not a tangent, even if the vocabulary has never
    // heard of it. That hatch existed — and "Hello i have dandruf" is four
    // words, which is why it did not catch this.
    expect(classifyOpening("keratoconus")).toBeNull();
  });
});
