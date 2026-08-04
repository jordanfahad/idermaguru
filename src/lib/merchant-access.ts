import { getAdminSession } from "@/lib/admin-guard";
import { getSupabaseUserEmail } from "@/lib/supabase/user";

/**
 * Who may open the merchant console, and whose figures they are shown.
 *
 * Two sign-in systems reach this page and only one of them used to be read.
 * Staff hold an admin cookie (src/lib/admin-auth.ts). Merchants hold a Supabase
 * session, because /login mails them a magic link. The console was gated on the
 * admin cookie alone, so a merchant who clicked their link landed on
 * /auth/callback, was handed a valid Supabase session, was redirected to
 * /dashboard, and was bounced straight to a staff login they have no
 * credential for. The merchant sign-in shipped as a dead end.
 *
 * Authenticated is not authorised. `signInWithOtp` creates an account for any
 * address that can receive mail — the login page says so — so "has a Supabase
 * session" is a fact about owning an inbox, not about owning a shop. Accepting
 * it on its own would have handed a store's commercial figures to anyone who
 * asked for a link, which is the hole the console was just closed against.
 *
 * So a merchant is a Supabase user whose address appears in `MERCHANT_USERS`,
 * bound there to exactly one tenant:
 *
 *   MERCHANT_USERS="owner@cicabelle.com=cicabelle,ops@cicabelle.com=cicabelle"
 *
 * An address that is not listed is signed in and refused. This is a stopgap
 * with the grain of the audit's follow-up, not a replacement for it: the
 * intended shape is a `MerchantUser` row bound to a tenant (docs/SECURITY-AUDIT
 * .md, "Residual / follow-ups"), which is a migration and a place to manage
 * them. An env list needs neither, fails closed, and can be read at a glance
 * during a launch — which is what it is for.
 */

export type MerchantUserEntry = { email: string; tenantSlug: string };

export type ConsoleAccess = {
  email: string;
  /** Administers every store, so it may name the one it wants to look at. */
  superAdmin: boolean;
  /**
   * The one merchant this person may read, or null when they are not bound to
   * one — staff, who get the default tenant unless they name another.
   */
  tenantSlug: string | null;
};

/** Read at call time: the deployment sets this after the module graph is built. */
export function merchantUserEntries(): MerchantUserEntry[] {
  return (process.env.MERCHANT_USERS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf("=");
      if (separator === -1) return null;
      const email = entry.slice(0, separator).trim().toLowerCase();
      const tenantSlug = entry.slice(separator + 1).trim().toLowerCase();
      // An entry naming an address but no tenant would otherwise read as
      // "any tenant". Both halves or neither.
      return email && tenantSlug ? { email, tenantSlug } : null;
    })
    .filter((entry): entry is MerchantUserEntry => entry !== null);
}

/** The single tenant this address may read, or null if it may read none. */
export function tenantSlugForEmail(email: string | null | undefined): string | null {
  const address = email?.trim().toLowerCase();
  if (!address) return null;
  return merchantUserEntries().find((entry) => entry.email === address)?.tenantSlug ?? null;
}

/**
 * The caller's access to the merchant console, or null if they have none.
 *
 * The admin cookie is checked first and costs nothing; the Supabase read is a
 * round trip to the auth server and only happens for a request that has no
 * staff session to answer for it.
 */
export async function getConsoleAccess(): Promise<ConsoleAccess | null> {
  const admin = await getAdminSession();
  if (admin) {
    return { email: admin.email, superAdmin: admin.role === "super_admin", tenantSlug: null };
  }

  const email = await getSupabaseUserEmail();
  if (!email) return null;

  const tenantSlug = tenantSlugForEmail(email);
  // Signed in, not on the list: refused rather than shown the default store.
  if (!tenantSlug) return null;

  return { email, superAdmin: false, tenantSlug };
}
