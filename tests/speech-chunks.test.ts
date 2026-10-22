import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { speechChunks } from "@/services/voice-agent";

/**
 * Starting to speak sooner.
 *
 * Synthesis time grows with the text and the player waits for a whole piece
 * before making a sound, so a four-sentence answer was four sentences of
 * silence and then all of it. Cut into sentences and requested together, the
 * first can play while the others are still being made.
 */

const LONG =
  "Great news, this essence suits oily and breakout-prone skin well. It is built around snail secretion filtrate, which calms redness and helps fade the marks left by old spots. It has no fragrance and no alcohol, so it is gentle enough for every day. Use it after cleansing and before moisturiser, morning and evening.";

describe("speechChunks", () => {
  it("leaves a short line whole", () => {
    expect(speechChunks("Does your skin feel tight or oily by midday?")).toEqual([
      "Does your skin feel tight or oily by midday?",
    ]);
    expect(speechChunks("   ")).toEqual([]);
  });

  it("starts with a short first piece, which is the whole point", () => {
    const pieces = speechChunks(LONG);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces[0]).toBe("Great news, this essence suits oily and breakout-prone skin well.");
    expect(pieces[0].length).toBeLessThan(LONG.length / 3);
  });

  it("loses and reorders nothing", () => {
    expect(speechChunks(LONG).join(" ")).toBe(LONG);
  });

  it("does not split inside a number or a price", () => {
    const text =
      "This one is AED 89.50 and holds 2.5% niacinamide, which is a gentle level for daily use. Apply it twice a day after cleansing, and give it three weeks before judging the result.";
    const pieces = speechChunks(text);
    expect(pieces.join(" ")).toBe(text);
    for (const piece of pieces) {
      expect(piece).not.toMatch(/AED 89\.$/);
      expect(piece).not.toMatch(/\b2\.$/);
    }
  });

  it("splits Arabic on the Arabic question mark and full stop", () => {
    const text =
      "هذا السيروم يناسب البشرة الدهنية والمعرضة للحبوب بشكل ممتاز. يحتوي على مخاط الحلزون الذي يهدئ الاحمرار؟ ولا يحتوي على عطر أو كحول، لذا فهو لطيف للاستخدام اليومي.";
    const pieces = speechChunks(text);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.join(" ")).toBe(text);
  });

  it("folds a tiny sentence into the next rather than speaking it alone", () => {
    const text = "Yes. It works well for oily skin, and most people see calmer skin within a few weeks of daily use.";
    const pieces = speechChunks(text);
    expect(pieces[0].length).toBeGreaterThanOrEqual(40);
    expect(pieces.join(" ")).toBe(text);
  });

  it("caps the number of requests and keeps the tail together", () => {
    const text = Array.from({ length: 12 }, (_, i) => `This is sentence number ${i + 1} of a very long answer.`).join(" ");
    const pieces = speechChunks(text);
    expect(pieces.length).toBeLessThanOrEqual(4);
    expect(pieces.join(" ")).toBe(text);
  });

  it("copes with a long run that has no punctuation at all", () => {
    const text = "a ".repeat(80).trim();
    expect(speechChunks(text)).toEqual([text]);
  });

  it("is written without a lookbehind, which older iPhones cannot parse", () => {
    // A regex that fails to parse is a SyntaxError at load: the whole bundle,
    // and with it the advisor, would not start on those phones.
    const source = readFileSync(new URL("../src/services/voice-agent.ts", import.meta.url), "utf8");
    const fn = source.slice(source.indexOf("export function speechChunks"));
    expect(fn).not.toMatch(/\(\?<[=!]/);
  });
});

describe("the client uses it", () => {
  const advisor = readFileSync(new URL("../src/components/voice-agent.tsx", import.meta.url), "utf8");

  it("cuts anything written for the shopper, and leaves fixed lines whole", () => {
    expect(advisor).toMatch(/flatMap\(\(part\) => \(isScriptedLine\(part\) \? \[part\] : speechChunks\(part\)\)\)/);
  });

  it("holds the greeting's audio for the tap instead of warming a door that refuses it", () => {
    // The GET endpoint only serves fixed lines; this one names the product.
    expect(advisor).toMatch(/openingAudioRef\.current = \{ line, url: URL\.createObjectURL\(blob\) \}/);
    expect(advisor).toMatch(/held && held\.line === greeting \? held\.url : undefined/);
  });
});
