import { timingSafeEqual } from "@/lib/hmac";

/**
 * Shopify OAuth + Admin API.
 *
 * Lets a merchant connect their own store, which is what turns this from a
 * single-tenant demo into a SaaS install: their catalogue syncs in, and their
 * access token is stored server-side only, never exposed to the browser.
 *
 * Env:
 *   SHOPIFY_API_KEY      public app key
 *   SHOPIFY_API_SECRET   server-only; signs and verifies every OAuth exchange
 *   SHOPIFY_SCOPES       default read_products,read_inventory
 *   NEXT_PUBLIC_SITE_URL used to build the OAuth redirect URI
 */
export const SHOPIFY_DEFAULT_SCOPES = "read_products,read_inventory";

/** Shopify shop domains are strictly <name>.myshopify.com — reject anything else. */
export function isValidShopDomain(shop: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/i.test(shop.trim());
}

export function normaliseShopDomain(shop: string): string | null {
  const clean = shop.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return isValidShopDomain(clean) ? clean : null;
}

export function shopifyConfig() {
  const apiKey = process.env.SHOPIFY_API_KEY;
  const apiSecret = process.env.SHOPIFY_API_SECRET;
  if (!apiKey || !apiSecret) return null;
  return {
    apiKey,
    apiSecret,
    scopes: process.env.SHOPIFY_SCOPES ?? SHOPIFY_DEFAULT_SCOPES,
    appUrl: (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  };
}

async function hmacHex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verifies the HMAC Shopify appends to OAuth redirects: every query parameter
 * except hmac/signature, sorted by key, joined as key=value pairs.
 */
export async function verifyShopifyHmac(params: URLSearchParams, secret: string): Promise<boolean> {
  const provided = params.get("hmac");
  if (!provided) return false;

  const message = Array.from(params.entries())
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  return timingSafeEqual(await hmacHex(message, secret), provided);
}

/** Verifies the X-Shopify-Hmac-Sha256 header on an app webhook (base64). */
export async function verifyShopifyWebhook(rawBody: string, header: string, secret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  let binary = "";
  new Uint8Array(signature).forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return timingSafeEqual(btoa(binary), header);
}

export function buildAuthorizeUrl(shop: string, state: string): string | null {
  const config = shopifyConfig();
  if (!config) return null;
  const params = new URLSearchParams({
    client_id: config.apiKey,
    scope: config.scopes,
    redirect_uri: `${config.appUrl}/api/shopify/callback`,
    state,
  });
  return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken(shop: string, code: string): Promise<string | null> {
  const config = shopifyConfig();
  if (!config) return null;

  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ client_id: config.apiKey, client_secret: config.apiSecret, code }),
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as { access_token?: string };
  return payload.access_token ?? null;
}

export type ShopifyProduct = {
  id: number;
  title: string;
  body_html?: string | null;
  vendor?: string | null;
  product_type?: string | null;
  handle: string;
  tags?: string | null;
  status?: string;
  images?: { src: string }[];
  variants?: { id: number; price: string; sku?: string | null; inventory_quantity?: number }[];
};

/** Pages through the Admin REST catalogue. Capped so one sync cannot run away. */
export async function fetchShopifyProducts(
  shop: string,
  accessToken: string,
  maxProducts = 1000,
): Promise<ShopifyProduct[]> {
  const collected: ShopifyProduct[] = [];
  let url: string | null = `https://${shop}/admin/api/2024-10/products.json?limit=250`;

  while (url && collected.length < maxProducts) {
    const response: Response = await fetch(url, {
      headers: { "X-Shopify-Access-Token": accessToken, accept: "application/json" },
    });
    if (!response.ok) break;

    const payload = (await response.json()) as { products?: ShopifyProduct[] };
    collected.push(...(payload.products ?? []));

    // Shopify paginates with a Link header rel="next".
    const link = response.headers.get("link") ?? "";
    const next = /<([^>]+)>;\s*rel="next"/.exec(link)?.[1];
    url = next ?? null;
  }

  return collected.slice(0, maxProducts);
}
