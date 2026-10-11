import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAdminSessionCookieName, verifyAdminSession } from "@/lib/admin-auth";
import { normaliseShopDomain } from "@/lib/shopify";
import { syncConnectedShop } from "@/services/catalogue-sync";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getPrisma } from "@/server/db";
import { jsonError } from "../../_shared";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Pulls a connected store's catalogue into the recommendation engine, now.
 *
 * Admin-only: syncing writes the catalogue every shopper is then recommended
 * from, so it must not be triggerable by an anonymous request. The work itself
 * lives in syncConnectedShop, shared with the scheduled run — see
 * /api/cron/shopify-sync.
 * POST /api/shopify/sync { shop }
 */
export async function POST(request: Request) {
  try {
    return await sync(request);
  } catch (error) {
    // Anything uncaught here would reach the browser as the platform's HTML
    // error page, and the panel's response.json() would fail on it — which is
    // how a timeout surfaced as "Unexpected token 'A'".
    console.error("Shopify sync failed", error);
    return jsonError(error instanceof Error ? error.message : "Sync failed.", 500);
  }
}

async function sync(request: Request) {
  const cookieStore = await cookies();
  const session = await verifyAdminSession(cookieStore.get(getAdminSessionCookieName())?.value);
  if (!session) return jsonError("Admin login required.", 401);

  let shopInput = "";
  try {
    shopInput = ((await request.json()) as { shop?: string }).shop ?? "";
  } catch {
    return jsonError("Provide a shop domain.", 400);
  }

  const shop = normaliseShopDomain(shopInput);
  if (!shop) return jsonError("Provide a valid *.myshopify.com domain.", 400);

  const supabase = getSupabaseAdmin();
  if (!supabase) return jsonError("Storage is not configured.", 503);

  const { data: connection, error } = await supabase
    .from("shopify_shops")
    .select("shop_domain,tenant_id,access_token")
    .eq("shop_domain", shop)
    .maybeSingle();

  if (error) return jsonError(error.message, 500);
  if (!connection) return jsonError("That store is not connected. Run the install first.", 404);

  const prisma = getPrisma();
  if (!prisma) return jsonError("Database is not configured.", 503);

  const outcome = await syncConnectedShop(connection, prisma);

  await supabase
    .from("shopify_shops")
    .update({
      last_sync_at: new Date().toISOString(),
      last_sync_count: outcome.imported,
      updated_at: new Date().toISOString(),
    })
    .eq("shop_domain", shop);

  return NextResponse.json(outcome);
}
