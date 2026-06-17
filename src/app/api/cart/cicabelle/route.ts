import { NextResponse } from "next/server";

type CartItem = {
  id?: string;
  name?: string;
  url?: string;
  variantId?: string;
};

type ShopifyProduct = {
  variants?: {
    id?: number | string;
    available?: boolean;
  }[];
};

const CART_BASE = "https://cicabelle.com/cart";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const items = parseItems(requestUrl.searchParams.get("items"));
  const variantIds = await resolveVariantIds(items);

  if (variantIds.length > 0) {
    const cartPath = variantIds.map((variantId) => `${variantId}:1`).join(",");
    const destination = new URL(`${CART_BASE}/${cartPath}`);
    destination.searchParams.set("utm_source", "ai-derma-guru");
    destination.searchParams.set("utm_medium", "add-to-cart");
    destination.searchParams.set("utm_campaign", "live-consultation");
    return NextResponse.redirect(destination);
  }

  const firstProduct = items.find((item) => item.url?.includes("cicabelle.com"));
  if (firstProduct?.url) return NextResponse.redirect(firstProduct.url);
  return NextResponse.redirect(CART_BASE);
}

async function resolveVariantIds(items: CartItem[]) {
  const variantIds: string[] = [];

  for (const item of items) {
    if (item.variantId) {
      variantIds.push(item.variantId);
      continue;
    }

    const variantId = await resolveVariantFromProductUrl(item.url);
    if (variantId) variantIds.push(variantId);
  }

  return [...new Set(variantIds)];
}

async function resolveVariantFromProductUrl(productUrl?: string) {
  if (!productUrl) return null;

  try {
    const url = new URL(productUrl);
    if (!url.hostname.includes("cicabelle.com")) return null;

    const match = url.pathname.match(/\/products\/([^/?#]+)/);
    const handle = match?.[1];
    if (!handle) return null;

    const productJsonUrl = `https://cicabelle.com/products/${handle}.js`;
    const response = await fetch(productJsonUrl, {
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
        name: typeof item.name === "string" ? item.name : undefined,
        url: typeof item.url === "string" ? item.url : undefined,
        variantId: typeof item.variantId === "string" ? item.variantId : undefined,
      }))
      .filter((item) => item.url || item.variantId)
      .slice(0, 12);
  } catch {
    return [];
  }
}
