import { describe, expect, it } from "vitest";
import { createSessionToken, verifySessionToken } from "@/lib/session-token";

// Guards the session export/delete and image-delete endpoints: holding a
// sessionId (a cuid) must not be enough to read or erase another shopper's PII.
describe("session token", () => {
  it("verifies a token only for the session it was issued for", async () => {
    const token = await createSessionToken("sess_A");
    expect(await verifySessionToken(token, "sess_A")).toBe(true);
    expect(await verifySessionToken(token, "sess_B")).toBe(false);
  });

  it("rejects a missing, empty, or tampered token", async () => {
    const token = await createSessionToken("sess_A");
    expect(await verifySessionToken(null, "sess_A")).toBe(false);
    expect(await verifySessionToken(undefined, "sess_A")).toBe(false);
    expect(await verifySessionToken("", "sess_A")).toBe(false);
    expect(await verifySessionToken(`${token}x`, "sess_A")).toBe(false);
  });

  it("requires a session id", async () => {
    const token = await createSessionToken("sess_A");
    expect(await verifySessionToken(token, null)).toBe(false);
    expect(await verifySessionToken(token, undefined)).toBe(false);
  });
});
