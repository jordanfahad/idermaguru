import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAdminSessionCookieName, verifyAdminSession, type AdminSession } from "@/lib/admin-auth";

/**
 * Read and verify the admin session from the request cookie. Use inside route
 * handlers and server components. Returns null when there is no valid session.
 */
export async function getAdminSession(): Promise<AdminSession | null> {
  const cookieStore = await cookies();
  return verifyAdminSession(cookieStore.get(getAdminSessionCookieName())?.value);
}

/**
 * Gate a route handler on a valid super-admin session. Returns the session, or a
 * 401 response the caller must return as-is:
 *
 *   const session = await requireSuperAdmin();
 *   if (session instanceof NextResponse) return session;
 *   // ...session is a verified super_admin from here
 *
 * super_admin is global-by-design (it administers every tenant), so the
 * `tenantSlug` selector on admin routes is only trustworthy once this gate has
 * confirmed the caller. Per-merchant sessions bound to a single tenant are a
 * follow-up (see docs/SECURITY-AUDIT.md); until then the data plane is
 * super_admin-only.
 */
export async function requireSuperAdmin(): Promise<AdminSession | NextResponse> {
  const session = await getAdminSession();
  if (!session || session.role !== "super_admin") {
    return NextResponse.json({ error: "Super-admin login required." }, { status: 401 });
  }
  return session;
}
