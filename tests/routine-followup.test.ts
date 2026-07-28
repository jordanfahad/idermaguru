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

/**
 * "More intense" means more products, not a step or two more. Switching to the
 * balanced plan took a four-step routine to five or six, which is not what a
 * shopper is asking for when they say they want something serious.
 */
describe("an intense routine is a longer one", () => {
  const catalogue = (() => {
    const base = seedProducts.filter((product) => product.tenantId === seedTenant.id);
    const extra = (
      [
        ["Hydrating Toner", "toner", ["niacinamide"]],
        ["Retinol Night Serum", "serum", ["retinol"]],
        ["Vitamin C Brightening Serum", "serum", ["vitamin c"]],
        ["Peptide Eye Cream", "eye cream", ["peptides"]],
        ["Overnight Hydrating Mask", "mask", ["hyaluronic acid"]],
        ["AHA Weekly Exfoliant", "exfoliant", ["glycolic acid"]],
      ] as [string, string, string[]][]
    ).map(([name, category, actives], index) => ({
      ...base[0],
      id: `extra-${index}`,
      sku: `extra-${index}`,
      name,
      category,
      description: `${name} for fine lines and dullness, all skin types`,
      url: `https://example.com/products/extra-${index}`,
      activeIngredientsJson: actives,
      concernsJson: ["fine lines", "dullness"],
      skinTypesJson: ["combination"],
      sensitiveSkinSuitable: false,
    }));
    return [...base, ...extra];
  })();

  const routineFor = (routinePreference?: string) => {
    const profile = {
      mainConcern: "fine lines and dullness",
      skinType: "combination",
      routinePreference,
      pregnantOrBreastfeeding: false,
      allergies: [],
    };
    return buildRecommendations({
      tenantId: seedTenant.id,
      profile,
      safety: runSafetyTriage(profile),
      products: catalogue,
      sponsoredEnabled: false,
    }).items;
  };

  it("adds products rather than a step or two", () => {
    expect(routineFor("simple").length).toBe(4);
    expect(routineFor("full").length).toBeGreaterThan(routineFor(undefined).length);
    expect(routineFor("full").length).toBeGreaterThanOrEqual(8);
  });

  it("carries a second serum, labelled as one", () => {
    const slots = routineFor("full").map((item) => item.slot);
    expect(slots).toContain("serum");
    expect(slots).toContain("second serum");
  });

  it("can finally recommend a mask", () => {
    // The mask step existed in the taxonomy and appeared in no plan, so masks
    // were never recommended to anybody.
    expect(routineFor("full").map((item) => item.slot)).toContain("weekly mask");
    expect(routineFor("simple").map((item) => item.slot)).not.toContain("weekly mask");
  });

  it("splits the two serums across the day instead of stacking them", () => {
    const serums = routineFor("full").filter((item) => item.step === "treatment");
    expect(serums.length).toBe(2);

    const morning = serums.filter((item) => /in the morning/i.test(item.cautions[0]));
    const evening = serums.filter((item) => /in the evening/i.test(item.cautions.join(" ")));
    // Judged per card, every serum that was not obviously nocturnal called
    // itself the morning one — and the shopper was told to use both at once.
    expect(morning.length).toBe(1);
    expect(evening.length).toBe(1);
    // and the retinoid is never the morning one
    expect(morning[0].product.activeIngredientsJson.join(" ")).not.toMatch(/retino/i);
  });

  it("leaves the shorter routines exactly as they were", () => {
    expect(routineFor("simple").map((item) => item.slot)).toEqual([
      "cleanser",
      "serum",
      "moisturiser",
      "sunscreen",
    ]);
  });
});
