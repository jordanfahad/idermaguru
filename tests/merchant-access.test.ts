import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminSession } from "@/lib/admin-auth";

/**
 * Two sign-in systems reach the merchant console and only one was ever read.
 *
 * Staff hold an admin cookie. Merchants hold a Supabase session, because
 * /login mails them a magic link. Gating the console on the admin cookie alone
 * meant a merchant clicked their link, was handed a valid session, was
 * redirected to /dashboard, and was bounced to a staff login they have no
 * credential for — the merchant sign-in shipped as a dead end.
 *
 * The other half matters more. `signInWithOtp` creates an account for any
 * address that can receive mail, so "has a Supabase session" says nothing
 * about owning a shop. Accepting one on its own would have handed a store's
 * commercial figures to anyone who asked for a link — reopening, by a
 * different door, the hole the console was just closed against.
 */

let adminSession: AdminSession | null = null;
let supabaseEmail: string | null = null;

vi.mock("@/lib/admin-guard", () => ({
  getAdminSession: async () => adminSession,
}));

vi.mock("@/lib/supabase/user", () => ({
  getSupabaseUserEmail: async () => supabaseEmail,
}));

const { getConsoleAccess, merchantUserEntries, tenantSlugForEmail } = await import("@/lib/merchant-access");

const original = process.env.MERCHANT_USERS;
afterEach(() => {
  adminSession = null;
  supabaseEmail = null;
  if (original === undefined) delete process.env.MERCHANT_USERS;
  else process.env.MERCHANT_USERS = original;
});

describe("reading MERCHANT_USERS", () => {
  it("binds an address to exactly one tenant", () => {
    process.env.MERCHANT_USERS = "owner@cicabelle.com=cicabelle";
    expect(tenantSlugForEmail("owner@cicabelle.com")).toBe("cicabelle");
  });

  it("ignores case and surrounding space, as a mail client will supply both", () => {
    process.env.MERCHANT_USERS = " Owner@Cicabelle.com = Cicabelle ";
    expect(tenantSlugForEmail("  owner@cicabelle.com ")).toBe("cicabelle");
  });

  it("drops an entry naming an address but no tenant", () => {
    // Otherwise a trailing "=" or a half-written entry reads as "any tenant".
    process.env.MERCHANT_USERS = "owner@cicabelle.com=,stray@example.com";
    expect(merchantUserEntries()).toHaveLength(0);
    expect(tenantSlugForEmail("owner@cicabelle.com")).toBeNull();
    expect(tenantSlugForEmail("stray@example.com")).toBeNull();
  });

  it("binds nobody when the variable is unset", () => {
    delete process.env.MERCHANT_USERS;
    expect(tenantSlugForEmail("owner@cicabelle.com")).toBeNull();
  });
});

describe("who gets into the merchant console", () => {
  it("lets a listed merchant in, bound to their own store", async () => {
    process.env.MERCHANT_USERS = "owner@cicabelle.com=cicabelle";
    supabaseEmail = "owner@cicabelle.com";

    expect(await getConsoleAccess()).toEqual({
      email: "owner@cicabelle.com",
      superAdmin: false,
      tenantSlug: "cicabelle",
    });
  });

  it("refuses a Supabase session whose address is on no list", async () => {
    // The whole point: anyone can obtain one of these by asking for a link.
    process.env.MERCHANT_USERS = "owner@cicabelle.com=cicabelle";
    supabaseEmail = "someone@gmail.com";

    expect(await getConsoleAccess()).toBeNull();
  });

  it("refuses every Supabase session when no merchants are configured", async () => {
    delete process.env.MERCHANT_USERS;
    supabaseEmail = "owner@cicabelle.com";

    expect(await getConsoleAccess()).toBeNull();
  });

  it("refuses a visitor with neither session", async () => {
    expect(await getConsoleAccess()).toBeNull();
  });

  it("still admits staff on the admin cookie, unbound so they may choose", async () => {
    adminSession = { email: "ops@idermaguru.com", role: "super_admin", exp: Date.now() };

    expect(await getConsoleAccess()).toEqual({
      email: "ops@idermaguru.com",
      superAdmin: true,
      tenantSlug: null,
    });
  });

  it("does not make a staff merchant a super-admin", async () => {
    adminSession = { email: "staff@idermaguru.com", role: "merchant", exp: Date.now() };

    const access = await getConsoleAccess();
    expect(access?.superAdmin).toBe(false);
    expect(access?.tenantSlug).toBeNull();
  });

  it("prefers the admin cookie and never asks the auth server for one it has", async () => {
    // The Supabase read is a network round trip; a staff session answers for
    // itself and must not pay for one.
    adminSession = { email: "ops@idermaguru.com", role: "super_admin", exp: Date.now() };
    supabaseEmail = "owner@cicabelle.com";
    process.env.MERCHANT_USERS = "owner@cicabelle.com=cicabelle";

    const access = await getConsoleAccess();
    expect(access?.email).toBe("ops@idermaguru.com");
  });
});
