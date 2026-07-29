import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../src/app/api/voice-agent/route";
import { resetStockCache } from "../src/services/stock";
import { extractInlineSlots, nextQuestion, readsPregnant, updateSlots } from "../src/services/voice-agent";
import { mentionsAllergen, passesHardFilters } from "../src/services/recommendation-engine";
import { runSafetyTriage } from "../src/services/safety-triage";
import { seedProducts, seedTenant } from "../src/data/seed-catalog";

/**
 * A live session on a phone, in full:
 *
 *   You      Super dry dandruff
 *   Advisor  Got it — dry skin. One safety check...
 *   You      I am breast-feeding man
 *   Advisor  Got it — I'll skip the ingredients that aren't advised...
 *   You      I do have peanut allergy
 *   Advisor  Here's a 3-step hair and scalp routine from the store...
 *
 * Three separate faults in six lines: a skin type invented from a description
 * of dandruff, a self-contradicting answer resolved silently, and a named
 * allergy never acknowledged because the read-back only existed on the face
 * path.
 */

beforeEach(() => {
  resetStockCache();
  vi.stubGlobal("fetch", async () => {
    throw new Error("offline");
  });
});
afterEach(() => vi.unstubAllGlobals());

async function converse(lines: string[]) {
  let slots: Record<string, unknown> = {};
  const said: string[] = [];
  for (const line of lines) {
    const response = await POST(
      new Request("http://localhost/api/voice-agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ utterance: line, slots }),
      }),
    );
    const payload = await response.json();
    slots = payload.slots ?? slots;
    said.push(payload.reply ?? "");
  }
  return { said, slots };
}

describe("not inventing a skin type", () => {
  it("does not read 'super dry dandruff' as dry skin", () => {
    expect(extractInlineSlots("super dry dandruff").skinType).toBeUndefined();
    const slots = updateSlots({}, "Super dry dandruff", "en");
    expect(slots.skinType).toBeUndefined();
  });

  it("never asks a scalp whether it is oily", () => {
    const slots = updateSlots({}, "Super dry dandruff", "en");
    expect(nextQuestion(slots, "en")?.question).not.toMatch(/oily, dry, combination/i);
    expect(nextQuestion(slots, "en")?.question).toMatch(/pregnan|breastfeeding/i);
  });

  it("still takes the answer when it is the answer", () => {
    for (const answer of ["combination", "very dry", "I'm oily", "sensitive skin", "my skin is really dry"]) {
      expect(updateSlots({ mainConcern: "dark spots", askedSkinType: true }, answer, "en").skinType).toBeDefined();
    }
  });
});

describe("an answer that contradicts itself is not an answer", () => {
  it("asks again rather than picking one half", () => {
    expect(readsPregnant("I am breast-feeding man")).toBeUndefined();
    expect(readsPregnant("I'm a pregnant man")).toBeUndefined();
  });

  it("still reads the ordinary answers", () => {
    expect(readsPregnant("I am breastfeeding")).toBe(true);
    expect(readsPregnant("I'm a man")).toBe(false);
    expect(readsPregnant("no, not pregnant")).toBe(false);
    expect(readsPregnant("my wife is breastfeeding")).toBe(true);
  });

  it("falls back to the assumption that filters the most", () => {
    // Asked twice and still unclear: assume it applies, which excludes the
    // restricted ingredients rather than waving them through.
    let slots = updateSlots({ mainConcern: "dandruff", askedPregnancy: true }, "I am breast-feeding man", "en");
    expect(slots.pregnantOrBreastfeeding).toBeUndefined();
    slots = updateSlots({ ...slots, askedPregnancy: true }, "I am breast-feeding man", "en");
    expect(slots.pregnantOrBreastfeeding).toBe(true);
  });
});

describe("a named allergy is said back, whatever routine follows", () => {
  it("acknowledges it on a face routine", async () => {
    const { said } = await converse(["I have dark spots", "combination", "no", "yes salicylic acid"]);
    expect(said[3]).toMatch(/salicylic acid/i);
  });

  it("hears the allergen out of a natural sentence", () => {
    // "I do have peanut allergy" — the phrasing that produced no acknowledgement
    // at all. "nut" also matches, and only the more specific one should survive.
    const slots = updateSlots(
      { mainConcern: "dandruff", pregnantOrBreastfeeding: false, askedAllergies: true },
      "I do have peanut allergy",
      "en",
    );
    expect(slots.allergies).toEqual(["peanut"]);
  });

  it("routes dandruff to the scalp without asking where it is", () => {
    const slots = updateSlots({}, "Super dry dandruff", "en");
    expect(slots.bodyArea).toBe("scalp");
    // The built-in fallback catalogue holds no hair products, so this store
    // says so rather than selling a face routine for dandruff.
    expect(nextQuestion(slots, "en")?.question).toMatch(/pregnan|breastfeeding/i);
  });
});

/**
 * The promise behind that acknowledgement. Synced products carry no ingredient
 * list — the Shopify importer has nothing structured to read — so "I'll keep
 * peanut out of everything I suggest" was excluding nothing at all: peanut is
 * not an active ingredient, and actives were the only place we looked.
 */
describe("keeping the promise", () => {
  const profile = { mainConcern: "dry hair", allergies: ["peanut"] };
  const safety = runSafetyTriage(profile);
  const base = seedProducts.find((product) => product.tenantId === seedTenant.id)!;

  it("excludes a product whose own copy names the allergen", () => {
    const nutty = { ...base, id: "nutty", description: "Rich balm with peanut oil and shea butter." };
    expect(passesHardFilters(nutty, profile, seedTenant.id, safety)).toBe(false);
  });

  it("does not exclude the product that says it is free of it", () => {
    // The trap: the safest products name allergens the most. Excluding a
    // "fragrance-free" cream for a fragrance allergy removes the one thing
    // that shopper actually wants.
    expect(mentionsAllergen("gentle fragrance-free moisturiser", "fragrance")).toBe(false);
    expect(mentionsAllergen("formulated without peanut oil", "peanut")).toBe(false);
    expect(mentionsAllergen("free from nut oils", "nut")).toBe(false);
    expect(mentionsAllergen("rich in shea butter", "shea")).toBe(true);
  });

  it("leaves an unrelated product alone", () => {
    expect(passesHardFilters(base, profile, seedTenant.id, safety)).toBe(true);
  });
});
