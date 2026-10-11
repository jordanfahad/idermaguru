import { NextResponse } from "next/server";
import { timingSafeEqual } from "@/lib/hmac";
import { syncConnectedShop, type SyncConnection } from "@/services/catalogue-sync";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getPrisma } from "@/server/db";
import { jsonError } from "../../_shared";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Every connected store's catalogue, on a schedule.
 *
 * The sync was a button in the dashboard, so the catalogue was only ever as
 * fresh as the last time somebody remembered to press it — five weeks, in the
 * case that prompted this. A catalogue that old recommends products that have
 * sold out, at prices that have moved, and nothing about it looks broken from
 * the outside.
 *
 * Runs over every connected shop rather than one named store: a cron has
 * nobody to ask which, and a merchant who connected a shop should not have to
 * know this exists.
 */

/**
 * Who is allowed to start this.
 *
 * There is no session here — a scheduled request carries no cookies — so the
 * authorisation is a shared secret that Vercel sends as a bearer token. Two
 * things follow, and both are deliberate:
 *
 * It FAILS CLOSED. With no CRON_SECRET configured this route refuses rather
 * than running, because the alternative is an unauthenticated endpoint that
 * rewrites the catalogue every shopper is recommended from, reachable by
 * anyone who guesses the path.
 *
 * And the comparison is constant-time. The window is small and a timing attack
 * on it is unlikely, but the fix costs one function call that already exists.
 */
function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  return timingSafeEqual(header.slice(prefix.length), secret);
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    console.error("Scheduled sync refused: CRON_SECRET is not set.");
    return jsonError("Scheduled sync is not configured.", 503);
  }
  if (!authorised(request)) return jsonError("Unauthorized.", 401);

  const supabase = getSupabaseAdmin();
  if (!supabase) return jsonError("Storage is not configured.", 503);

  const prisma = getPrisma();
  if (!prisma) return jsonError("Database is not configured.", 503);

  const { data: connections, error } = await supabase
    .from("shopify_shops")
    .select("shop_domain,tenant_id,access_token");

  if (error) return jsonError(error.message, 500);

  const results: Record<string, unknown>[] = [];
  for (const connection of (connections ?? []) as SyncConnection[]) {
    try {
      const outcome = await syncConnectedShop(connection, prisma);
      await supabase
        .from("shopify_shops")
        .update({
          last_sync_at: new Date().toISOString(),
          last_sync_count: outcome.imported,
          updated_at: new Date().toISOString(),
        })
        .eq("shop_domain", connection.shop_domain);

      // Logged, because nobody is watching the dashboard line when this runs.
      // These are the two numbers worth seeing in a log weeks later: what came
      // in, and what was taken off the shelf.
      console.log(
        `[cron-sync] ${outcome.shop} imported=${outcome.imported}/${outcome.fetched} retired=${outcome.retired} truncated=${outcome.truncated}`,
      );
      results.push(outcome);
    } catch (caught) {
      // One store's bad day must not stop the others. A shop whose token has
      // been revoked would otherwise take every other merchant's catalogue
      // down with it, silently, on a schedule.
      const reason = caught instanceof Error ? caught.message : "sync failed";
      console.error(`[cron-sync] ${connection.shop_domain} failed: ${reason}`);
      results.push({ shop: connection.shop_domain, error: reason });
    }
  }

  return NextResponse.json({ ran: results.length, results });
}
