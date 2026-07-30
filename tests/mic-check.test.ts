import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { readsMicCheck } from "../src/services/voice-agent";
import { resetStockCache } from "../src/services/stock";

/**
 * From a live session, the very first exchange:
 *
 *   You      Hello can you hear me
 *   Advisor  That one's outside my world, I'm afraid — skin and hair are
 *            what I know. Tell me your main skin or hair concern.
 *
 * A person checking the microphone works got the off-topic brush-off — the
 * coldest possible reply to the warmest possible opening, and to a shopper
 * testing the thing, proof that it's a machine.
 */

beforeEach(() => {
  resetStockCache();
  vi.stubGlobal("fetch", async () => {
    throw new Error("offline");
  });
});
afterEach(() => vi.unstubAllGlobals());

const ask = async (utterance: string, slots: Record<string, unknown>) => {
  const { POST } = await import("../src/app/api/voice-agent/route");
  const response = await POST(
    new Request("http://localhost/api/voice-agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ utterance, slots }),
    }),
  );
  return response.json();
};

describe("a hearing check is answered like a person", () => {
  it("reads the check in its common forms", () => {
    expect(readsMicCheck("Hello can you hear me")).toBe(true);
    expect(readsMicCheck("can you hear me?")).toBe(true);
    expect(readsMicCheck("are you there")).toBe(true);
    expect(readsMicCheck("is this working")).toBe(true);
    expect(readsMicCheck("هل تسمعني")).toBe(true);
    // and does not fire on things that merely sound nearby
    expect(readsMicCheck("hello")).toBe(false);
    expect(readsMicCheck("I have dandruff")).toBe(false);
    expect(readsMicCheck("my ears are dry")).toBe(false);
  });

  it("confirms loud and clear at the opening, then asks", async () => {
    const payload = await ask("Hello can you hear me", {});
    expect(payload.reply).toMatch(/loud and clear/i);
    expect(payload.reply).toMatch(/skin or hair concern/i);
    expect(payload.reply).not.toMatch(/outside my world/i);
    expect(payload.phase).toBe("asking");
    // nothing was stored as a concern
    expect(payload.slots.mainConcern).toBeUndefined();
  });

  it("confirms mid-conversation and repeats the open question", async () => {
    const opening = await ask("I have dandruff", {});
    const payload = await ask("can you hear me?", opening.slots);
    expect(payload.reply).toMatch(/loud and clear/i);
    expect(payload.reply).not.toMatch(/outside my world/i);
    // the interview carries on where it was
    expect(payload.reply).toMatch(/pregnan|breast/i);
  });
});
