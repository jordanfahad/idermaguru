import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * The email of the Supabase user who owns this request's cookies, or null.
 *
 * Deliberately not in server.ts: that file hands out the SERVICE-ROLE client,
 * which bypasses row-level security and answers to nobody. This one answers to
 * whoever is signed in, and the two should not be one import away from each
 * other.
 *
 * `getUser()` rather than `getSession()`: getSession decodes the cookie and
 * believes it, which is fine for deciding what to draw and useless for deciding
 * what to serve. getUser has the auth server verify the token, so a
 * hand-written cookie does not become a merchant console.
 *
 * Writing cookies is a no-op on purpose. A Server Component cannot set them,
 * and the one place a refreshed token needs persisting is /auth/callback, which
 * builds its own client. The cost is that a token expiring mid-render reads as
 * signed out — the safe direction.
 */
export async function getSupabaseUserEmail(): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;

  const cookieStore = await cookies();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        // See above: nothing to persist from a read.
      },
    },
  });

  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user?.email) return null;
    return data.user.email.trim().toLowerCase();
  } catch {
    // Auth being unreachable is not authorisation.
    return null;
  }
}
