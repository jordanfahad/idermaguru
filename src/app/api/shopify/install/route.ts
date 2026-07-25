import { NextResponse, type NextRequest } from "next/server";
import { buildAuthorizeUrl, normaliseShopDomain, shopifyConfig } from "@/lib/shopify";
import { base64UrlEncodeBytes } from "@/lib/hmac";

export const runtime = "nodejs";

export const SHOPIFY_STATE_COOKIE = "shopify_oauth_state";

/**
 * Starts the Shopify install: GET /api/shopify/install?shop=store.myshopify.com
 *
 * Generates a one-time state nonce, stores it in an httpOnly cookie, and
 * redirects the merchant to Shopify's consent screen. The callback refuses to
 * proceed unless the returned state matches, which is what stops a third party
 * from walking someone else's store through our install.
 */
export async function GET(request: NextRequest) {
  const config = shopifyConfig();
  if (!config) {
    return NextResponse.json(
      { error: "Shopify is not configured. Set SHOPIFY_API_KEY and SHOPIFY_API_SECRET." },
      { status: 503 },
    );
  }

  const shop = normaliseShopDomain(request.nextUrl.searchParams.get("shop") ?? "");
  if (!shop) {
    return NextResponse.json(
      { error: "Provide a valid shop, e.g. ?shop=your-store.myshopify.com" },
      { status: 400 },
    );
  }

  const state = base64UrlEncodeBytes(crypto.getRandomValues(new Uint8Array(24)));
  const authorizeUrl = buildAuthorizeUrl(shop, state);
  if (!authorizeUrl) return NextResponse.json({ error: "Could not build the Shopify URL." }, { status: 500 });

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(SHOPIFY_STATE_COOKIE, `${state}:${shop}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return response;
}
