import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../src/app/api/voice-agent/route";
import { resetStockCache } from "../src/services/stock";
import { ESCALATION_MESSAGE, ESCALATION_MESSAGE_AR } from "../src/domain/skincare";

/**
 * Whole turns, through the real route.
 *
 * Every test above this file exercises `updateSlots` and `nextQuestion`
 * directly, and all 258 of them passed while the advisor was answering "on my
 * hands" with "That one's outside my world, I'm afraid." The route runs a chain
 * of classifiers in front of those functions — distress, triage, opening,
 * tangent — and a question is only ever as good as the guard that stops the
 * tangent classifier eating its answer. That guard existed for the allergen
 * list and was missing for the body-area question.
 *
 * So these drive the endpoint the browser drives, and assert on what the
 * shopper would actually hear.
 */

function ask(utterance: string, slots: Record<string, unknown> = {}) {
  return POST(
    new Request("http://localhost/api/voice-agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ utterance, slots }),
    }),
  ).then((response) => response.json());
}

/** Plays a whole conversation, carrying the slots the way the client does. */
async function converse(lines: string[]) {
  let slots: Record<string, unknown> = {};
  const said: { you: string; advisor: string; phase: string; products: number }[] = [];
  for (const line of lines) {
    const payload = await ask(line, slots);
    slots = payload.slots ?? slots;
    said.push({
      you: line,
      advisor: payload.reply ?? "",
      phase: payload.phase,
      products: (payload.products ?? []).length,
    });
  }
  return { said, slots };
}

beforeEach(() => {
  resetStockCache();
  // No storefront to ask in a test run, and a failed lookup must never be read
  // as "sold out" — that is the rule the service is built on, asserted here.
  vi.stubGlobal("fetch", async () => {
    throw new Error("offline");
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The clinician referral is authored in both languages now. An Arabic session
 * that trips a red flag must hear the ARABIC referral — localise() returns
 * authored languages untouched, so before this the most frightening moment of
 * an Arabic conversation was answered in English.
 */
describe("the referral speaks the shopper's language", () => {
  it("answers an Arabic-language red flag with the Arabic referral", async () => {
    // Bilingual phrasing, the way Gulf shoppers actually talk: Arabic framing
    // around the English words the triage vocabulary knows.
    const payload = await ask("\u0639\u0646\u062f\u064a \u0634\u0627\u0645\u0629 \u062a\u0646\u0632\u0641 mole changed color and is bleeding");
    expect(payload.phase).toBe("referral");
    expect(payload.language).toBe("ar");
    expect(payload.reply).toBe(ESCALATION_MESSAGE_AR);
  });

  it("keeps the English referral for an English session", async () => {
    const payload = await ask("I have a mole that changed color and is bleeding");
    expect(payload.phase).toBe("referral");
    expect(payload.reply).toBe(ESCALATION_MESSAGE);
  });
});

describe("a whole conversation", () => {
  it("asks where the rash is and then takes the answer", async () => {
    const { said, slots } = await converse(["I have a rash", "on my hands"]);

    expect(said[0].advisor).toMatch(/where/i);
    // The bug: "on my hands" contains no word the skin vocabulary knows, so it
    // was answered with the off-topic line and the question was asked again.
    expect(said[1].advisor).not.toMatch(/outside my world|only cover skin/i);
    expect(said[1].advisor).toMatch(/pregnan|breastfeeding/i);
    expect(slots.bodyArea).toBe("hands");
  });

  it("never asks a pair of hands whether they are oily", async () => {
    const { said } = await converse(["I have a rash", "on my hands", "no", "no"]);
    expect(said.map((turn) => turn.advisor).join(" ")).not.toMatch(/oily, dry, combination/i);
  });

  it("still runs the ordinary face routine end to end", async () => {
    const { said } = await converse(["I have dark spots and dull skin", "combination", "no", "no"]);
    expect(said[0].advisor).toMatch(/oily, dry, combination/i);
    expect(said[1].advisor).toMatch(/pregnan|breastfeeding/i);
    expect(said[2].advisor).toMatch(/allerg/i);
    expect(said[3].phase).toBe("result");
    expect(said[3].products).toBeGreaterThan(0);
  });

  it("reads an allergy back before recommending anything", async () => {
    const { said } = await converse([
      "I have dark spots and dull skin",
      "combination",
      "no",
      "yes salicylic acid",
    ]);
    expect(said[3].advisor).toMatch(/salicylic acid/i);
    expect(said[3].phase).toBe("result");
  });

  it("answers a serious injury with concern, not a redirect to skincare", async () => {
    const first = await ask("I have a bullet wound");
    expect(first.reply).toMatch(/sorry/i);
    expect(first.reply).toMatch(/emergency services|hospital/i);
    expect(first.reply).not.toMatch(/only cover skin and hair/i);
    expect(first.phase).toBe("referral");

    const arm = await ask("I have a broken arm");
    expect(arm.reply).toMatch(/sorry/i);
    expect(arm.reply).toMatch(/hospital|clinic/i);
  });

  it("takes an intimate-area question seriously and sells nothing", async () => {
    const payload = await ask("I have dark skin near my bikini line");
    expect(payload.phase).toBe("referral");
    expect(payload.products).toEqual([]);
    expect(payload.reply).toMatch(/doctor|pharmacist/i);
  });

  it("does not turn a body concern away as off-topic", async () => {
    const payload = await ask("dark knuckles");
    expect(payload.reply).not.toMatch(/outside my world|only cover skin/i);
  });

  it("changes the routine when asked, instead of repeating itself", async () => {
    const { said, slots } = await converse([
      "I have dark spots and dull skin",
      "combination",
      "no",
      "no",
      "I need it more intense routine",
    ]);
    const result = said[3];
    const adjusted = said[4];

    expect(slots.routineShape).toBe("full");
    expect(adjusted.advisor).not.toBe(result.advisor);
    expect(adjusted.products).toBeGreaterThanOrEqual(result.products);
  });

  it("keeps a product when the storefront cannot be reached", async () => {
    // fetch throws for every stock lookup in this file. A network fault is not
    // evidence that anything is unavailable, so the routine must survive it.
    const { said } = await converse(["I have dark spots and dull skin", "combination", "no", "no"]);
    expect(said[3].products).toBeGreaterThan(0);
  });
});
