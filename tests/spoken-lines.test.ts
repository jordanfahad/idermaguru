import { describe, expect, it } from "vitest";
import { agentCopy, acknowledgements, fixedLines, scriptedLines } from "../src/services/voice-agent";
import { distressCopy, feelingCopy } from "../src/services/empathy";
import { ESCALATION_MESSAGE } from "../src/domain/skincare";

/**
 * Production logs, on a real session:
 *
 *   16:41:20  POST /api/voice-agent
 *   16:41:27  POST /api/voice-agent/speech      <- seven seconds later
 *
 * Every speech call was a POST, which is the client saying "this line is not
 * one of ours, synthesise it fresh". Only the seven questions qualified as
 * ours, so every acknowledgement, every reaction and every result line was
 * generated from scratch on every turn of every session.
 *
 * A line is cacheable when it is in `fixedLines`. So anything the advisor can
 * say without a model has to be in there, and these tests are what stops the
 * next fixed line being added without it.
 */
describe("everything we wrote can be spoken from cache", () => {
  for (const lang of ["en", "ar"] as const) {
    const fixed = new Set(fixedLines(lang));
    const copy = agentCopy(lang);

    it(`${lang}: covers every question`, () => {
      for (const line of scriptedLines(lang)) expect(fixed.has(line)).toBe(true);
    });

    it(`${lang}: covers every acknowledgement and reaction`, () => {
      for (const line of acknowledgements(lang)) expect(fixed.has(line)).toBe(true);
      for (const feeling of ["sore", "frustrated", "self-conscious", "worried", "amused"] as const) {
        expect(fixed.has(feelingCopy(feeling, lang))).toBe(true);
      }
    });

    it(`${lang}: covers the lines that end a conversation`, () => {
      for (const kind of ["emergency", "urgent-care", "crisis"] as const) {
        expect(fixed.has(distressCopy(kind, lang))).toBe(true);
      }
      expect(fixed.has(copy.intimateArea)).toBe(true);
      expect(fixed.has(copy.noProducts)).toBe(true);
      expect(fixed.has(copy.noHairProducts)).toBe(true);
      expect(fixed.has(ESCALATION_MESSAGE)).toBe(true);
    });

    it(`${lang}: covers every routine length a plan can produce`, () => {
      // The longest plan is nine steps; a result line for eight must not be
      // the one line in the conversation that costs a round trip.
      for (let count = 1; count <= 9; count += 1) {
        expect(fixed.has(copy.result(count))).toBe(true);
        expect(fixed.has(copy.sameAgain(count))).toBe(true);
        expect(fixed.has(copy.adjusted.fuller(count))).toBe(true);
        expect(fixed.has(copy.adjusted.gentler(count))).toBe(true);
      }
    });

    it(`${lang}: is free of duplicates and blanks`, () => {
      const lines = fixedLines(lang);
      expect(lines.every((line) => line.trim().length > 0)).toBe(true);
      expect(new Set(lines).size).toBe(lines.length);
    });
  }

  it("keeps the two languages apart", () => {
    const en = new Set(fixedLines("en"));
    const arabicOnly = fixedLines("ar").filter((line) => !en.has(line));
    expect(arabicOnly.length).toBeGreaterThan(20);
  });
});
