import { productHandle } from "./product-taxonomy";

/**
 * Is this product actually buyable right now?
 *
 * A shopper followed a routine all the way to checkout and was met with "Out of
 * stock — La Roche-Posay Toleriane Face Wash Cleanser, 400ml — SOLD OUT". The
 * catalogue's own `inStock` flag was right when it was written and had simply
 * gone stale: nothing re-reads it between syncs, and a merchant sells out
 * between them. Recommending something and then having the shop refuse to sell
 * it is worse than not recommending it.
 *
 * So the handful of products actually about to be shown are checked against the
 * storefront itself. Shopify serves `/products/<handle>.js` publicly on the same
 * domain the shopper buys from, which is the same source of truth the cart uses.
 *
 * Every failure mode resolves to "available". A network blip, a store that is
 * not Shopify, a slow response — none of those are evidence a product is sold
 * out, and hiding a sellable product costs the merchant a sale.
 */

type CacheEntry = { available: boolean; at: number };

const CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Only ever called with the six-or-so products in a built routine. */
const PER_REQUEST_TIMEOUT_MS = 1200;

export function storefrontStockUrl(productUrl: string): string | null {
  const handle = productHandle(productUrl);
  if (!handle) return null;
  try {
    return `${new URL(productUrl).origin}/products/${handle}.js`;
  } catch {
    return null;
  }
}

/**
 * Reads availability out of a Shopify product payload.
 *
 * `available` on the product is the union across variants, which is what we
 * want: the shopper picks a variant on the product page, so a product with one
 * sellable size is still worth showing. Anything unrecognisable reads as
 * available, per the fail-open rule above.
 */
export function readAvailability(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return true;
  const product = payload as { available?: unknown; variants?: unknown };
  if (Array.isArray(product.variants) && product.variants.length) {
    const anySellable = product.variants.some(
      (variant) => !variant || typeof variant !== "object" || (variant as { available?: unknown }).available !== false,
    );
    if (!anySellable) return false;
  }
  return product.available !== false;
}

async function checkOne(url: string, now: number): Promise<boolean> {
  const cached = CACHE.get(url);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.available;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PER_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    // A 404 means the product page is gone, which is not the same as sold out —
    // but it is certainly not something to send a shopper to.
    if (response.status === 404) {
      CACHE.set(url, { available: false, at: now });
      return false;
    }
    if (!response.ok) return true;
    const available = readAvailability(await response.json());
    CACHE.set(url, { available, at: now });
    return available;
  } catch {
    return true;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The ids of products the storefront will not currently sell.
 *
 * Bounded by `budgetMs` as a whole, so a slow store delays a reply by at most
 * that and then everything unresolved is treated as available.
 */
export async function soldOutProductIds(
  products: { id: string; url: string }[],
  budgetMs = 1500,
): Promise<Set<string>> {
  const soldOut = new Set<string>();
  const checks = products
    .map((product) => ({ product, url: storefrontStockUrl(product.url) }))
    .filter((entry): entry is { product: { id: string; url: string }; url: string } => Boolean(entry.url));

  if (!checks.length) return soldOut;

  const now = Date.now();
  const work = Promise.all(
    checks.map(async (entry) => {
      if (!(await checkOne(entry.url, now))) soldOut.add(entry.product.id);
    }),
  );

  await Promise.race([work, new Promise((resolve) => setTimeout(resolve, budgetMs))]);
  return soldOut;
}

/** Test seam — the module-level cache would otherwise leak between cases. */
export function resetStockCache() {
  CACHE.clear();
}
