import { describe, expect, it } from "vitest";
import { extractAllergies } from "../src/services/voice-agent";
import { productFamily } from "../src/services/product-taxonomy";

/**
 * Reported from a live consultation: "yes I do have period of energy" was
 * accepted as an allergy answer, and the routine then offered the same
 * anti-dandruff shampoo twice, in two sizes.
 */
describe("allergy answers", () => {
  it("does not turn a nonsense answer into a list of allergens", () => {
    // Used to return ["have", "period", "energy"], which then completed the
    // profile and sent the shopper straight to a routine built around it.
    expect(extractAllergies("yes I do have period of energy")).toBeUndefined();
  });

  it("still hears a real allergen, named or bare", () => {
    expect(extractAllergies("yes peanut allergy")).toContain("peanut");
    expect(extractAllergies("I'm allergic to fragrance and nickel")).toEqual(
      expect.arrayContaining(["fragrance", "nickel"]),
    );
    expect(extractAllergies("salicylic acid makes me break out")).toContain("salicylic");
  });

  it("believes an ingredient it has never heard of when it is named explicitly", () => {
    // The vocabulary is a filter for stray words, not a gate on real answers.
    expect(extractAllergies("I am allergic to bakuchiol")).toEqual(["bakuchiol"]);
  });

  it("still reads a plain no as no allergies", () => {
    expect(extractAllergies("no")).toEqual([]);
    expect(extractAllergies("none at all")).toEqual([]);
  });
});

describe("one product per routine", () => {
  it("treats two sizes of the same product as one product", () => {
    const small = productFamily("Vichy DERCOS ANTI-DANDRUFF SHAMPOO FOR DRY HAIR 200ML");
    const large = productFamily("Vichy DERCOS ANTI-DANDRUFF SHAMPOO FOR DRY HAIR 390ML");
    expect(small).toBe(large);
  });

  it("keeps genuinely different products apart", () => {
    expect(productFamily("CeraVe Foaming Cleanser 236ml")).not.toBe(
      productFamily("CeraVe Hydrating Cleanser 236ml"),
    );
    // Different formulation, same family name — must stay separate.
    expect(productFamily("Effaclar Duo+ 40ml")).not.toBe(
      productFamily("Effaclar Duo+ SPF30 with Niacinamide 40ml"),
    );
  });

  it("handles the size formats a merchant catalogue actually uses", () => {
    const base = productFamily("Some Serum");
    for (const size of ["50 ml", "50ml", "1.7 fl oz", "100 G", "30gm"]) {
      expect(productFamily(`Some Serum ${size}`)).toBe(base);
    }
  });
});

describe("reading back what it heard", () => {
  it("keeps only the most specific allergen", () => {
    // "peanut" contains "nut", which read back as "allergic to nut, peanut".
    expect(extractAllergies("yes peanut allergy")).toEqual(["peanut"]);
  });
});
