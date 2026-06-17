import {
  dedicatedProductUrl,
  liveConsultations,
  liveConsultationOne,
  type LiveConsultationConfig,
  type LiveConsultationProduct,
} from "@/data/live-consultations";
import { getSupabaseAdmin } from "@/lib/supabase/server";

const CONFIG_CONCERN = "live_consultation_config";

export async function getLiveConsultationConfig(slug: string): Promise<LiveConsultationConfig> {
  const fallback = liveConsultations.find((item) => item.slug === slug) ?? liveConsultationOne;
  const supabase = getSupabaseAdmin();
  if (!supabase) return normalizeLiveConsultationConfig(fallback);

  const { data } = await supabase
    .from("recommendations")
    .select("routine")
    .eq("slug", `${slug}-config`)
    .eq("concern", CONFIG_CONCERN)
    .maybeSingle();

  const config = data?.routine;
  return normalizeLiveConsultationConfig(isLiveConsultationConfig(config) ? config : fallback);
}

export async function saveLiveConsultationConfig(config: LiveConsultationConfig) {
  const normalizedConfig = normalizeLiveConsultationConfig(config);
  const supabase = getSupabaseAdmin();
  if (!supabase) return normalizedConfig;

  const now = new Date().toISOString();
  const { error } = await supabase.from("recommendations").upsert(
    {
      slug: `${config.slug}-config`,
      title: normalizedConfig.title,
      concern: CONFIG_CONCERN,
      skin_type: "config",
      summary: normalizedConfig.subtitle,
      routine: normalizedConfig as never,
      avoid: [],
      seo_title: `${normalizedConfig.title} | AI Derma Guru`,
      seo_description: normalizedConfig.subtitle,
      created_at: now,
    },
    { onConflict: "slug" },
  );

  if (error) throw new Error(error.message);
  return normalizedConfig;
}

export function normalizeLiveConsultationConfig(config: LiveConsultationConfig): LiveConsultationConfig {
  const defaultProducts = liveConsultationOne.products.filter(
    (defaultProduct) => !config.products.some((product) => product.id === defaultProduct.id),
  );

  const products = [...config.products, ...defaultProducts]
    .map(normalizeProduct)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  return {
    ...config,
    vendors: config.vendors.map((vendor) => ({
      ...vendor,
      share: Number.isFinite(vendor.share) ? Math.max(0, Math.min(100, vendor.share)) : 0,
    })),
    products: dedupeProducts(products),
  };
}

function normalizeProduct(product: LiveConsultationProduct): LiveConsultationProduct {
  return {
    ...product,
    url: dedicatedProductUrl(product),
    trust: "Selected from the approved product catalog with brand-authenticity and suitability checks.",
    priority: Number.isFinite(Number(product.priority)) ? Number(product.priority) : 50,
    inventorySize: normalizeInventorySize(product.inventorySize),
    keywords: product.keywords ?? inferKeywords(product),
  };
}

function normalizeInventorySize(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dedupeProducts(products: LiveConsultationProduct[]) {
  const deduped: LiveConsultationProduct[] = [];
  const keyToIndex = new Map<string, number>();

  for (const product of products) {
    const keys = productKeys(product);
    const existingIndex = keys.map((key) => keyToIndex.get(key)).find((index) => index !== undefined);

    if (existingIndex !== undefined) {
      deduped[existingIndex] = mergeProducts(deduped[existingIndex], product);
      for (const key of productKeys(deduped[existingIndex])) keyToIndex.set(key, existingIndex);
      continue;
    }

    const nextIndex = deduped.length;
    deduped.push(product);
    for (const key of keys) keyToIndex.set(key, nextIndex);
  }

  return deduped;
}

function productKeys(product: LiveConsultationProduct) {
  const keys: string[] = [];
  const urlKey = productUrlKey(product.url);
  if (urlKey) keys.push(`url:${urlKey}`);

  const variantId = product.variantId?.trim().toLowerCase();
  const nameKey = canonicalProductName(product.name);
  if (variantId && nameKey) keys.push(`variant:${normalizeKey(product.vendor)}:${variantId}:${nameKey}`);
  if (nameKey) keys.push(`name:${normalizeKey(product.vendor)}:${nameKey}`);

  return keys.length ? keys : [`id:${product.id}`];
}

function mergeProducts(first: LiveConsultationProduct, second: LiveConsultationProduct) {
  const winner = productPreferenceScore(second) >= productPreferenceScore(first) ? second : first;
  const fallback = winner === second ? first : second;
  const inventoryValues = [first.inventorySize, second.inventorySize].filter(
    (value): value is number => value !== undefined && Number.isFinite(Number(value)),
  );

  return {
    ...fallback,
    ...winner,
    id: winner.id || fallback.id,
    priority: Math.max(Number(first.priority ?? 0), Number(second.priority ?? 0)),
    inventorySize: inventoryValues.length ? Math.max(...inventoryValues.map(Number)) : undefined,
    keywords: Array.from(new Set([...(first.keywords ?? []), ...(second.keywords ?? [])])),
  };
}

function productPreferenceScore(product: LiveConsultationProduct) {
  const inventory = product.inventorySize;
  const inventoryScore = inventory === undefined ? 0 : Number(inventory) > 0 ? 1000 + Number(inventory) : -500;
  const draftPenalty = /\bdraft\b/i.test(product.name) ? -250 : 0;
  return inventoryScore + Number(product.priority ?? 0) + draftPenalty;
}

function productUrlKey(url: string) {
  const clean = url.trim();
  if (!clean) return "";

  try {
    const parsed = new URL(clean);
    const path = parsed.pathname.replace(/\/+$/, "").toLowerCase();
    const productHandle = path.match(/\/products\/([^/]+)/)?.[1];
    return `${parsed.hostname.replace(/^www\./, "").toLowerCase()}${productHandle ? `/products/${productHandle}` : path}`;
  } catch {
    return clean.replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
  }
}

function normalizeKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function canonicalProductName(value: string) {
  return normalizeKey(
    value
      .replace(/\[draft version\]/gi, "")
      .replace(/\bdraft version\b/gi, "")
      .replace(/\bcopy\b/gi, ""),
  );
}

function inferKeywords(product: LiveConsultationProduct) {
  return `${product.name} ${product.category} ${product.routineSlot} ${product.why}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2);
}

function isLiveConsultationConfig(value: unknown): value is LiveConsultationConfig {
  if (!value || typeof value !== "object") return false;
  const config = value as Partial<LiveConsultationConfig>;
  return Boolean(
    config.slug &&
      config.title &&
      Array.isArray(config.vendors) &&
      Array.isArray(config.products),
  );
}
