import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAdminSessionCookieName, verifyAdminSession } from "@/lib/admin-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { shopifyConfig } from "@/lib/shopify";
import { jsonError } from "../../_shared";

export const runtime = "nodejs";

/** Connected stores for the admin panel. Never returns an access token. */
export async function GET() {
  const cookieStore = await cookies();
  const session = await verifyAdminSession(cookieStore.get(getAdminSessionCookieName())?.value);
  if (!session) return jsonError("Admin login required.", 401);

  const configured = Boolean(shopifyConfig());
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ configured, shops: [] });

  const { data, error } = await supabase
    .from("shopify_shops")
    .select("shop_domain,scopes,installed_at,last_sync_at,last_sync_count")
    .order("installed_at", { ascending: false });

  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ configured, shops: data ?? [] });
}
