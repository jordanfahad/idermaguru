import { describe, expect, it } from "vitest";
import { parseAnswerReading, UNREADABLE_ANSWER } from "../src/services/llm/provider";

/**
 * The model is allowed to say an answer is nonsense, off topic, or something a
 * shop should not be answering. Everything it returns is read defensively: a
 * malformed reply must never invent a reason to stop the conversation, and must
 * never clear a concern the deterministic patterns already raised.
 */
describe("reading a model verdict", () => {
  it("reads a well-formed verdict", () => {
    const reading = parseAnswerReading(
      '{"makesSense":false,"onTopic":false,"needsClinician":false,"skinType":null,"concern":null}',
    );
    expect(reading).toEqual({
      makesSense: false,
      onTopic: false,
      needsClinician: false,
      skinType: undefined,
      concern: undefined,
    });
  });

  it("finds the JSON when the model wraps it in prose or a code fence", () => {
    const reading = parseAnswerReading('Sure! ```json\n{"makesSense":true,"onTopic":true,"needsClinician":true}\n```');
    expect(reading.needsClinician).toBe(true);
  });

  for (const junk of ["", "I'm sorry, I can't help with that.", "{not json", "null", "[]"]) {
    it(`falls back to "nothing to add" for: ${JSON.stringify(junk)}`, () => {
      expect(parseAnswerReading(junk)).toEqual(UNREADABLE_ANSWER);
    });
  }

  it("never escalates on a missing field", () => {
    // Absent needsClinician must not become true, or a truncated reply would
    // end the consultation for no reason.
    expect(parseAnswerReading('{"makesSense":true}').needsClinician).toBe(false);
  });

  it("never treats a missing field as nonsense", () => {
    // Absent makesSense must not become false, or a truncated reply would
    // accuse the shopper of talking gibberish.
    const reading = parseAnswerReading('{"needsClinician":false}');
    expect(reading.makesSense).toBe(true);
    expect(reading.onTopic).toBe(true);
  });

  it("only accepts a skin type the engine understands", () => {
    expect(parseAnswerReading('{"skinType":"OILY"}').skinType).toBe("oily");
    expect(parseAnswerReading('{"skinType":"leathery"}').skinType).toBeUndefined();
    expect(parseAnswerReading('{"skinType":42}').skinType).toBeUndefined();
  });

  it("ignores a blank concern and caps a long one", () => {
    expect(parseAnswerReading('{"concern":"   "}').concern).toBeUndefined();
    expect(parseAnswerReading(`{"concern":"${"x".repeat(400)}"}`).concern?.length).toBe(120);
  });

  it("does not carry pregnancy or allergies, whatever the model says", () => {
    const reading = parseAnswerReading(
      '{"makesSense":true,"onTopic":true,"needsClinician":false,"pregnantOrBreastfeeding":true,"allergies":["nuts"]}',
    );
    expect(reading).not.toHaveProperty("pregnantOrBreastfeeding");
    expect(reading).not.toHaveProperty("allergies");
  });
});
