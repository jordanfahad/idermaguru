import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "@/lib/hmac";
import { exchangeCodeForToken, normaliseShopDomain, shopifyConfig, verifyShopifyHmac } from "@/lib/shopify";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { seedTenant } from "@/data/seed-catalog";
import { SHOPIFY_STATE_COOKIE } from "../install/route";

export const runtime = "nodejs";

/**
 * Shopify OAuth callback.
 *
 * Everything is verified before a token is requested, in this order: the shop
 * domain is a real *.myshopify.com, the state nonce matches the cookie we set
 * at install, and Shopify's HMAC over the query string validates against the
 * app secret. Only then is the code exchanged, and the resulting access token
 * is written to a table with RLS and no policies so it is server-only.
 */
export async function GET(request: NextRequest) {
  const config = shopifyConfig();
  if (!config) return NextResponse.json({ error: "Shopify is not configured." }, { status: 503 });

  const params = request.nextUrl.searchParams;
  const shop = normaliseShopDomain(params.get("shop") ?? "");
  const code = params.get("code");
  const state = params.get("state");

  if (!shop || !code || !state) {
    return NextResponse.json({ error: "Invalid Shopify callback." }, { status: 400 });
  }

  const cookie = request.cookies.get(SHOPIFY_STATE_COOKIE)?.value ?? "";
  const [expectedState, expectedShop] = cookie.split(":");
  if (!expectedState || !timingSafeEqual(expectedState, state) || expectedShop !== shop) {
    return NextResponse.json({ error: "OAuth state mismatch. Start the install again." }, { status: 403 });
  }

  if (!(await verifyShopifyHmac(params, config.apiSecret))) {
    return NextResponse.json({ error: "Shopify signature verification failed." }, { status: 401 });
  }

  const accessToken = await exchangeCodeForToken(shop, code);
  if (!accessToken) {
    return NextResponse.json({ error: "Could not complete the Shopify handshake." }, { status: 502 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: "Storage is not configured." }, { status: 503 });

  const { error } = await supabase.from("shopify_shops").upsert(
    {
      shop_domain: shop,
      // Until merchant sign-up exists, an install maps to the default tenant.
      tenant_id: seedTenant.id,
      access_token: accessToken,
      scopes: config.scopes,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "shop_domain" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const done = NextResponse.redirect(`${config.appUrl}/admin?shopify=connected&shop=${encodeURIComponent(shop)}`);
  done.cookies.delete(SHOPIFY_STATE_COOKIE);
  return done;
}
