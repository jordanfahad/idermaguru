import { NextResponse } from "next/server";
import { seedTenant } from "@/data/seed-catalog";
import { listTenantProducts } from "@/services/catalog";
import { productHandle } from "@/services/product-taxonomy";

/**
 * Hands a whole routine to the merchant's Shopify cart.
 *
 * Named for one merchant because it was built for one; the path is kept so
 * existing embeds keep working, but nothing inside it is Cicabelle-specific any
 * more. The store is resolved from the tenant's own catalogue.
 *
 * WHERE THE REDIRECT TARGET COMES FROM MATTERS. It is derived from product URLs
 * we have stored for that tenant — never from the query string. Building it out
 * of `items[].url` would be an open redirect: anyone could hand this endpoint a
 * link to any domain and have us send a shopper there under our own name.
 */

type CartItem = {
  id?: string;
  url?: string;
  variantId?: string;
};

type ShopifyProduct = {
  variants?: { id?: number | string; available?: boolean }[];
};

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const tenantSlug = requestUrl.searchParams.get("tenant")?.trim() || seedTenant.slug;
  const requested = parseItems(requestUrl.searchParams.get("items"));

  const catalogue = await listTenantProducts(tenantSlug);
  // Every product we are willing to redirect to, keyed by the two things the
  // client can name it by.
  const byId = new Map(catalogue.map((product) => [product.id, product]));
  const byHandle = new Map(
    catalogue
      .map((product) => [productHandle(product.url), product] as const)
      .filter(([handle]) => Boolean(handle)),
  );

  type Matched = { stored: (typeof catalogue)[number]; variantId?: string };
  const matched = requested.flatMap<Matched>((item) => {
    const stored = (item.id ? byId.get(item.id) : undefined) ?? byHandle.get(productHandle(item.url ?? ""));
    return stored ? [{ stored, variantId: item.variantId }] : [];
  });

  const storeOrigin = originOf(matched[0]?.stored.url) ?? originOf(catalogue.find((p) => p.url)?.url);
  if (!storeOrigin) return NextResponse.redirect(new URL("/", requestUrl));

  const variantIds = await resolveVariantIds(matched, storeOrigin);

  if (variantIds.length > 0) {
    const cartPath = variantIds.map((variantId) => `${variantId}:1`).join(",");
    const destination = new URL(`${storeOrigin}/cart/${cartPath}`);
    destination.searchParams.set("utm_source", "ai-derma-guru");
    destination.searchParams.set("utm_medium", "add-to-cart");
    destination.searchParams.set("utm_campaign", "live-consultation");
    return NextResponse.redirect(destination);
  }

  // Nothing resolved to a variant: the product page is better than an empty cart.
  const first = matched[0]?.stored.url;
  return NextResponse.redirect(first ?? `${storeOrigin}/cart`);
}

function originOf(url?: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

async function resolveVariantIds(
  matched: { stored: { url: string }; variantId?: string }[],
  storeOrigin: string,
) {
  const variantIds: string[] = [];

  for (const entry of matched) {
    if (entry.variantId) {
      variantIds.push(entry.variantId);
      continue;
    }
    const variantId = await resolveVariantFromProductUrl(entry.stored.url, storeOrigin);
    if (variantId) variantIds.push(variantId);
  }

  return [...new Set(variantIds)];
}

async function resolveVariantFromProductUrl(productUrl: string, storeOrigin: string) {
  const handle = productHandle(productUrl);
  if (!handle) return null;

  try {
    const response = await fetch(`${storeOrigin}/products/${handle}.js`, {
      headers: {
        accept: "application/json,text/javascript,*/*",
        "user-agent": "AI Derma Guru cart resolver",
      },
      cache: "no-store",
    });
    if (!response.ok) return null;

    const product = (await response.json()) as ShopifyProduct;
    const variant = product.variants?.find((item) => item.available !== false) ?? product.variants?.[0];
    return variant?.id ? String(variant.id) : null;
  } catch {
    return null;
  }
}

function parseItems(value: string | null): CartItem[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        id: typeof item.id === "string" ? item.id : undefined,
        url: typeof item.url === "string" ? item.url : undefined,
        variantId: typeof item.variantId === "string" ? item.variantId : undefined,
      }))
      .filter((item) => item.url || item.variantId || item.id)
      .slice(0, 12);
  } catch {
    return [];
  }
}
