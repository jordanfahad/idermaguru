import { describe, expect, it } from "vitest";
import { createAdminSession, verifyAdminSession } from "@/lib/admin-auth";

// The admin data plane is gated entirely on this signed cookie, so forging one
// must be impossible without the server secret.
describe("admin session", () => {
  it("round-trips a signed session", async () => {
    const cookie = await createAdminSession("admin@example.com", "super_admin");
    const session = await verifyAdminSession(cookie);
    expect(session?.email).toBe("admin@example.com");
    expect(session?.role).toBe("super_admin");
  });

  it("rejects an unsigned, wrongly-signed, or empty cookie", async () => {
    const cookie = await createAdminSession("admin@example.com", "super_admin");
    const [payload] = cookie.split(".");
    expect(await verifyAdminSession(payload)).toBeNull();
    expect(await verifyAdminSession(`${payload}.not-the-real-signature`)).toBeNull();
    expect(await verifyAdminSession("")).toBeNull();
    expect(await verifyAdminSession(undefined)).toBeNull();
  });

  it("rejects an expired session", async () => {
    const cookie = await createAdminSession("admin@example.com", "super_admin");
    const session = await verifyAdminSession(cookie);
    expect(session).not.toBeNull();
    // Re-verifying with a clock far in the future should fail the exp check.
    const realNow = Date.now;
    Date.now = () => realNow() + 1000 * 60 * 60 * 48;
    try {
      expect(await verifyAdminSession(cookie)).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });
});
