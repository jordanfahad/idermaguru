import noShip from "@/data/cicabelle-noship-handles.json";
import { productHandle } from "@/services/product-taxonomy";

/*
 * Cicabelle sells in three markets, and Saudi Arabia and Kuwait are separate
 * Shopify markets with their own prices, catalogue and checkout. A Saudi or
 * Kuwaiti shopper must never be shown an AED price, a UAE product page or a
 * product that cannot be shipped to them. Everything here mirrors the live
 * Cicabelle theme and iOS app; the UAE path is untouched.
 */
export type CicabelleMarket = "AE" | "SA" | "KW";

/** Explicit choice (the app's country picker) first, then the visitor's network country. */
export function resolveMarket(param?: string | null, ipCountry?: string | null): CicabelleMarket {
  const pick = (value?: string | null) => {
    const v = (value ?? "").trim().toUpperCase();
    return v === "SA" || v === "KW" || v === "AE" ? v : null;
  };
  return pick(param) ?? (pick(ipCountry) === "SA" || pick(ipCountry) === "KW" ? (pick(ipCountry) as CicabelleMarket) : "AE");
}

export const isAbroad = (market: CicabelleMarket) => market === "SA" || market === "KW";

/*
 * Products that can never go to Saudi Arabia or Kuwait: hidden from that catalogue,
 * or browsable there but not purchasable (no-ship). Copy of the theme's
 * cb-noship-handles master (cc-work/google-ads-audit/2026-10-29/noship-handles-115.json),
 * the same list the iOS app bundles. Refresh all three together.
 */
const blocked = new Set<string>(noShip as string[]);

export function blockedInMarket(market: CicabelleMarket, urlOrHandle: string): boolean {
  if (!isAbroad(market)) return false;
  const handle = urlOrHandle.includes("/") ? productHandle(urlOrHandle) : urlOrHandle.toLowerCase();
  return Boolean(handle) && blocked.has(handle);
}

/** cicabelle.com/products/x → cicabelle.com/en-sa/products/x (the page that shows SAR and the Saudi terms). */
export function marketStorePath(market: CicabelleMarket, lang: "en" | "ar"): string {
  if (isAbroad(market)) return `/${lang}-${market.toLowerCase()}`;
  return lang === "ar" ? "/ar" : "";
}

export function localProductUrl(url: string, market: CicabelleMarket, lang: "en" | "ar"): string {
  if (!isAbroad(market)) return url;
  try {
    const parsed = new URL(url);
    const handle = productHandle(url);
    if (!handle) return url;
    parsed.pathname = `${marketStorePath(market, lang)}/products/${handle}`;
    return parsed.toString();
  } catch {
    return url;
  }
}

/* ---------------- prices, formatted like the app (src/lib/format.ts + marketMoney.ts) ---------------- */

const LRI = "⁦";
const PDI = "⁩";
const KW_RATE = 0.0853;

function grouped(amount: string): string {
  const [whole, fraction] = amount.split(".");
  return whole.replace(/\B(?=(\d{3})+$)/g, ",") + (fraction === undefined ? "" : `.${fraction}`);
}

function moneyAmount(n: number, currency: string): string {
  if (!Number.isFinite(n)) return "0";
  const fixed = n.toFixed(currency === "KWD" ? 3 : 2);
  return grouped(/\.0+$/.test(fixed) ? String(Math.round(n)) : fixed);
}

/**
 * Saudi: Shopify's SAR price ("SAR 83", Arabic "83 ر.س").
 * Kuwait: priced in AED, shown in KWD to the fils exactly as the live theme's cb-kw-money does.
 */
export function formatMarketPrice(amount: number, currency: string, market: CicabelleMarket, lang: "en" | "ar"): string {
  let text: string;
  if (market === "KW" && (currency === "AED" || currency === "KWD")) {
    const fils = currency === "KWD" ? Math.round(amount * 1000) : Math.floor((Math.round(amount * 100) / 100) * KW_RATE * 1000 + 0.5);
    text = `KWD ${(fils / 1000).toFixed(3)}`;
  } else {
    const a = moneyAmount(amount, currency);
    text = lang === "ar" && currency === "SAR" ? `${a} ر.س` : `${currency} ${a}`;
  }
  return lang === "ar" ? `${LRI}${text}${PDI}` : text;
}

/* ---------------- live market prices from Cicabelle's public Storefront API ---------------- */

// The "Cicabelle Headless" channel's public token: public by design, the same one the iOS app ships.
const STOREFRONT_URL = "https://a1ce04.myshopify.com/api/2026-07/graphql.json";
const STOREFRONT_TOKEN = "4d241e0b2b99a97dc6f1d12ed35116b7";

export type MarketPrice = { amount: number; currency: string } | null;

/**
 * Price per handle in that market. null = the product is not sold there (not in the
 * market's catalogue): the caller must hide it, never fall back to the UAE price.
 */
export async function fetchMarketPrices(handles: string[], market: CicabelleMarket, lang: "en" | "ar"): Promise<Map<string, MarketPrice>> {
  const unique = [...new Set(handles.filter(Boolean))].slice(0, 20);
  const out = new Map<string, MarketPrice>();
  if (!unique.length || !isAbroad(market)) return out;
  const fields = unique
    .map((h, i) => `p${i}: product(handle: ${JSON.stringify(h)}) { handle availableForSale priceRange { minVariantPrice { amount currencyCode } } }`)
    .join("\n");
  const query = `query MarketPrices @inContext(country: ${market}, language: ${lang === "ar" ? "AR" : "EN"}) {\n${fields}\n}`;
  const res = await fetch(STOREFRONT_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Shopify-Storefront-Access-Token": STOREFRONT_TOKEN },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`storefront ${res.status}`);
  const json = (await res.json()) as {
    data?: Record<string, { availableForSale: boolean; priceRange: { minVariantPrice: { amount: string; currencyCode: string } } } | null>;
  };
  unique.forEach((h, i) => {
    const node = json.data?.[`p${i}`];
    out.set(h, node ? { amount: Number(node.priceRange.minVariantPrice.amount), currency: node.priceRange.minVariantPrice.currencyCode } : null);
  });
  return out;
}
