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

export type ShopProfile = {
  /** ISO currency the shop trades in, or null when the call failed. */
  currency: string | null;
  /**
   * The host a shopper actually browses. Shopify calls it `domain`; it is the
   * primary domain a store has configured — cicabelle.com, not
   * a1ce04.myshopify.com — and falls back to the myshopify host for a store
   * that never attached one.
   */
  primaryDomain: string | null;
};

/**
 * The shop's own currency and storefront host, read once per sync.
 *
 * Currency was always the point of this call. The domain is the newer half and
 * matters more: product URLs were built from the myshopify host, so every link
 * the advisor showed pointed at a1ce04.myshopify.com — a domain a shopper has
 * never seen, on a store whose own catalogue rows already carry cicabelle.com
 * links. Two spellings of one product page is how a catalogue ends up with two
 * rows for one product.
 *
 * Returns nulls rather than guessing when the call fails; the caller keeps
 * whatever it was already using instead of silently relabelling a catalogue.
 */
export async function fetchShopProfile(shop: string, accessToken: string): Promise<ShopProfile> {
  try {
    const response = await fetch(`https://${shop}/admin/api/2024-10/shop.json`, {
      headers: { "X-Shopify-Access-Token": accessToken, accept: "application/json" },
    });
    if (!response.ok) return { currency: null, primaryDomain: null };
    const payload = (await response.json()) as { shop?: { currency?: string; domain?: string } };
    const currency = payload.shop?.currency?.trim().toUpperCase();
    return {
      currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null,
      primaryDomain: hostOnly(payload.shop?.domain),
    };
  } catch {
    return { currency: null, primaryDomain: null };
  }
}

/** A bare hostname, or null for anything that is not one. */
function hostOnly(value: string | null | undefined): string | null {
  const host = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[/?#].*$/, "");
  return /^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

/**
 * The ingredient list a merchant keeps against each product.
 *
 * REST's products.json returns no metafields at all, which is why the catalogue
 * has carried an empty ingredients array since the sync was written. Asking per
 * product would be one call each — 444 of them for Cicabelle, against a REST
 * limit of two a second — so this goes through GraphQL, where `nodes` answers
 * for 250 products at once and asks for exactly the one field we want.
 *
 * `custom.ingredients` is the definition merchants are told to create in
 * docs/SHOPIFY-INGREDIENTS.md. A shop that has not made one gets nulls back and
 * a catalogue that behaves exactly as it does today.
 *
 * Never throws. A sync that dropped its whole catalogue because a metafield
 * query failed would trade a missing nice-to-have for a broken advisor.
 */
export const INGREDIENTS_METAFIELD = { namespace: "custom", key: "ingredients" } as const;

export async function fetchIngredientLists(
  shop: string,
  accessToken: string,
  productIds: number[],
): Promise<Map<number, string>> {
  const found = new Map<number, string>();
  if (!productIds.length) return found;

  const query = `query Ingredients($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        metafield(namespace: "${INGREDIENTS_METAFIELD.namespace}", key: "${INGREDIENTS_METAFIELD.key}") {
          value
        }
      }
    }
  }`;

  // `nodes` takes at most 250 ids per call, which is also the REST page size —
  // so this is one metafield request per page of products, not per product.
  for (let from = 0; from < productIds.length; from += 250) {
    const batch = productIds.slice(from, from + 250);
    try {
      const response = await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          query,
          variables: { ids: batch.map((id) => `gid://shopify/Product/${id}`) },
        }),
      });
      if (!response.ok) continue;

      const payload = (await response.json()) as {
        data?: { nodes?: ({ id?: string; metafield?: { value?: string | null } | null } | null)[] };
      };
      for (const node of payload.data?.nodes ?? []) {
        const value = node?.metafield?.value?.trim();
        if (!node?.id || !value) continue;
        // "gid://shopify/Product/123" — the numeric id is what REST gave us.
        const numeric = Number(node.id.split("/").pop());
        if (Number.isFinite(numeric)) found.set(numeric, value);
      }
    } catch {
      // Leave this batch out. Products without an entry keep whatever the
      // catalogue already held for them.
    }
  }

  return found;
}

export type ShopifyCatalogue = {
  products: ShopifyProduct[];
  /**
   * Whether this is the whole store or a slice of it — false when a page
   * request failed or the cap cut the walk short.
   *
   * The caller needs to know, because "everything the store did not send this
   * time is discontinued" is only a safe conclusion about a complete list. A
   * rate limit on page two of four would otherwise read as three quarters of
   * the catalogue going out of stock.
   */
  complete: boolean;
};

/** Pages through the Admin REST catalogue. Capped so one sync cannot run away. */
export async function fetchShopifyProducts(
  shop: string,
  accessToken: string,
  maxProducts = 1000,
): Promise<ShopifyCatalogue> {
  const collected: ShopifyProduct[] = [];
  let url: string | null = `https://${shop}/admin/api/2024-10/products.json?limit=250`;
  let complete = true;

  while (url && collected.length < maxProducts) {
    const response: Response = await fetch(url, {
      headers: { "X-Shopify-Access-Token": accessToken, accept: "application/json" },
    });
    if (!response.ok) {
      complete = false;
      break;
    }

    const payload = (await response.json()) as { products?: ShopifyProduct[] };
    collected.push(...(payload.products ?? []));

    // Shopify paginates with a Link header rel="next".
    const link = response.headers.get("link") ?? "";
    const next = /<([^>]+)>;\s*rel="next"/.exec(link)?.[1];
    url = next ?? null;
  }

  // A page still waiting when the loop ended means the cap stopped us short.
  return { products: collected.slice(0, maxProducts), complete: complete && !url };
}
