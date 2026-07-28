import { describe, expect, it } from "vitest";
import {
  agentCopy,
  extractAllergies,
  nextQuestion,
  readAdjustment,
  slotsToProfile,
  updateSlots,
  type AgentSlots,
} from "../src/services/voice-agent";
import { buildRecommendations } from "../src/services/recommendation-engine";
import { runSafetyTriage } from "../src/services/safety-triage";
import { seedProducts, seedTenant } from "../src/data/seed-catalog";

/**
 * From a live session:
 *
 *   Advisor  And do you have any product or ingredient allergies?
 *   You      yes salicylic acid
 *   Advisor  Here's a simple routine with 4 products matched from the store...
 *   You      I need it more intense routine
 *   Advisor  Here's a simple routine with 4 products matched from the store...
 *
 * The allergy was recorded and filtered correctly. It was never said back, so
 * the shopper had no way of knowing. And the conversation simply ended at the
 * routine: the follow-up rebuilt the identical routine and read out the
 * identical sentence.
 */
describe("the allergy has to be said back", () => {
  it("hears the allergen in a yes-plus-name answer", () => {
    expect(extractAllergies("yes salicylic acid")).toEqual(["salicylic acid"]);
    // and reads it back whole, not as a truncated stem
    expect(agentCopy("en").avoiding(["salicylic acid"])).toMatch(/salicylic acid/);
  });

  it("actually keeps it out of the routine", () => {
    const profile = slotsToProfile({
      mainConcern: "dark spots",
      skinType: "combination",
      allergies: ["salicylic acid"],
      pregnantOrBreastfeeding: false,
    });
    const routine = buildRecommendations({
      tenantId: seedTenant.id,
      profile,
      safety: runSafetyTriage(profile),
      products: seedProducts,
      sponsoredEnabled: false,
    });
    expect(routine.items.length).toBeGreaterThan(0);
    for (const item of routine.items) {
      expect(item.product.activeIngredientsJson.join(" ")).not.toMatch(/salicylic/i);
    }
  });
});

describe("the conversation does not end at the routine", () => {
  it("reads a request for something stronger", () => {
    for (const said of ["I need it more intense routine", "make it stronger", "give me a full routine", "more steps"]) {
      expect(readAdjustment(said)).toBe("fuller");
    }
  });

  it("reads a request to pull back", () => {
    expect(readAdjustment("simpler please")).toBe("simpler");
    expect(readAdjustment("that's too many steps")).toBe("simpler");
    // "too strong" is a request for LESS, and it contains the word the
    // stronger patterns look for — so gentler is read first.
    expect(readAdjustment("it's too strong")).toBe("gentler");
    expect(readAdjustment("make it gentler, it stings")).toBe("gentler");
  });

  it("ignores an ordinary answer", () => {
    expect(readAdjustment("oily")).toBeNull();
    expect(readAdjustment("no")).toBeNull();
    expect(readAdjustment("I have dark spots")).toBeNull();
  });

  it("turns the request into a different routine, not the same one again", () => {
    const answered: AgentSlots = {
      mainConcern: "dark spots and dull skin",
      skinType: "combination",
      pregnantOrBreastfeeding: false,
      allergies: [],
      gaveRoutine: true,
    };
    expect(nextQuestion(answered, "en")).toBeNull();

    const build = (slots: AgentSlots) => {
      const profile = slotsToProfile(slots);
      return buildRecommendations({
        tenantId: seedTenant.id,
        profile,
        safety: runSafetyTriage(profile),
        products: seedProducts,
        sponsoredEnabled: false,
      }).items;
    };

    const before = build(answered);
    const stronger = updateSlots(answered, "I need it more intense routine", "en");
    expect(stronger.routineShape).toBe("full");
    expect(build(stronger).length).toBeGreaterThan(before.length);

    // and the request is not folded into the concern the ranking reads
    expect(stronger.mainConcern).toBe(answered.mainConcern);
  });

  it("takes the strong actives out when asked for gentler", () => {
    const answered: AgentSlots = {
      mainConcern: "dark spots and dull skin",
      skinType: "combination",
      pregnantOrBreastfeeding: false,
      allergies: [],
      gaveRoutine: true,
      routineShape: "full",
    };
    const gentler = updateSlots(answered, "it's too harsh", "en");
    expect(gentler.gentle).toBe(true);
    // "very high" is what the hard filter reads; "high" only re-ranks.
    expect(slotsToProfile(gentler).sensitivity).toBe("very high");

    const routine = buildRecommendations({
      tenantId: seedTenant.id,
      profile: slotsToProfile(gentler),
      safety: runSafetyTriage(slotsToProfile(gentler)),
      products: seedProducts,
      sponsoredEnabled: false,
    });
    for (const item of routine.items) {
      const actives = item.product.activeIngredientsJson.join(" ");
      if (/glycolic|salicylic|lactic|mandelic/i.test(actives)) {
        expect(item.product.sensitiveSkinSuitable).toBe(true);
      }
    }
  });

  it("says something different when it has nothing different to offer", () => {
    const copy = agentCopy("en");
    expect(copy.nothingStronger).toMatch(/pharmacist|dermatologist/i);
    expect(copy.sameAgain(4)).toMatch(/same/i);
    // neither pretends to have produced a new routine
    expect(copy.nothingStronger).not.toMatch(/here's a/i);
    expect(copy.sameAgain(4)).not.toMatch(/here's a/i);
  });

  it("does not quietly undo an irritation the shopper reported", () => {
    expect(agentCopy("en").adjusted.fullerAfterGentle(6)).toMatch(/stinging|slowly/i);
  });
});
