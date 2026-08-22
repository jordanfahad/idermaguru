import type { Product } from "@prisma/client";
import type { ProductCatalogItem } from "@/domain/skincare";
import { seedProducts, seedTenant } from "@/data/seed-catalog";
import { BRAND_BY_HANDLE } from "@/data/brand-registry";
import { getPrisma } from "@/server/db";
import { withTenant } from "@/lib/tenant-context";
import { productHandle } from "@/services/product-taxonomy";

// Tenant resolution: must run on the owner client — a role subject to RLS cannot
// look up a tenant by slug without already knowing its id.
export async function getTenantBySlug(slug = seedTenant.slug) {
  const prisma = getPrisma();
  // Without a database the only tenant that exists is the built-in demo one,
  // and it answers to its own slug ONLY. Returning it for every slug meant a
  // deployment with DATABASE_URL unset resolved "cicabelle" to the demo tenant
  // and then served the twelve seed products — a real shop's advisor
  // confidently recommending generic demo stock it does not sell, with nothing
  // logged and nothing on screen to say so. An unknown slug resolves to no
  // tenant and no catalogue, which the advisor can at least be honest about.
  // The catch below has always drawn this line; this branch did not.
  if (!prisma) return slug === seedTenant.slug ? seedTenant : null;

  try {
    return prisma.tenant.findUnique({ where: { slug } });
  } catch {
    return slug === seedTenant.slug ? seedTenant : null;
  }
}

function seedFallback(tenantId: string): ProductCatalogItem[] {
  return tenantId === seedTenant.id ? seedProducts.filter((product) => product.tenantId === seedTenant.id) : [];
}

/**
 * The catalogue, kept in memory for a moment.
 *
 * Every turn that produces a routine reads the whole catalogue — 461 rows for
 * the live merchant — and pays a round trip to another region for it. The
 * catalogue changes when a merchant syncs or edits a product, which is not
 * something that happens between two turns of one conversation, so a short TTL
 * costs nothing and takes a visible pause out of every result.
 */
const catalogueCache = new Map<string, { at: number; products: ProductCatalogItem[] }>();
const CATALOGUE_TTL_MS = 45_000;

/** Called after a sync or an edit, so the next read is fresh. */
export function invalidateCatalogue(slug?: string) {
  if (slug) catalogueCache.delete(slug);
  else catalogueCache.clear();
}

export async function listTenantProducts(slug = seedTenant.slug): Promise<ProductCatalogItem[]> {
  const cached = catalogueCache.get(slug);
  if (cached && Date.now() - cached.at < CATALOGUE_TTL_MS) return cached.products;

  const tenant = await getTenantBySlug(slug);
  if (!tenant) return slug === seedTenant.slug ? seedFallback(seedTenant.id) : [];

  try {
    // Tenant-scoped read: the GUC set by withTenant lets RLS filter to this tenant.
    const products = await withTenant(tenant.id, (tx) =>
      tx.product.findMany({
        where: { tenantId: tenant.id },
        orderBy: [{ merchantPriority: "desc" }, { name: "asc" }],
      }),
    );
    if (!products) return seedFallback(tenant.id);
    const mapped = products.map(mapPrismaProduct);
    catalogueCache.set(slug, { at: Date.now(), products: mapped });
    return mapped;
  } catch {
    return seedFallback(tenant.id);
  }
}

export async function getProductByIdForTenant(productId: string, tenantSlug = seedTenant.slug) {
  const products = await listTenantProducts(tenantSlug);
  return products.find((product) => product.id === productId || product.sku === productId) ?? null;
}

/**
 * The last meaningful segment of a product URL — Shopify's handle.
 *
 * "https://cicabelle.com/products/snail-92-cream?variant=42#reviews" is the
 * same product as "snail-92-cream", and a storefront may hand us either. The
 * query string in particular is not optional to strip: a variant picker puts
 * one on every link, so matching the raw string would fail on exactly the
 * pages a shopper reaches by choosing a size.
 */
function handleOf(value: string): string {
  const withoutFragment = value.split("#")[0].split("?")[0];
  const segments = withoutFragment.split("/").filter(Boolean);
  return (segments[segments.length - 1] ?? "").toLowerCase();
}

/**
 * The product a storefront says the shopper is looking at.
 *
 * Deliberately forgiving about what it is given. This value is written into a
 * theme by hand — `{{ product.handle }}` is the obvious thing to reach for,
 * but so is `{{ product.url }}`, and someone syncing from our own dashboard
 * would reasonably pass an id or an SKU. All four resolve, because the failure
 * is silent in the worst way: the advisor opens without knowing the product
 * and simply behaves as though it were never told, on a page whose whole point
 * was that it knows.
 *
 * Returns null rather than guessing. An advisor that opens saying "you're
 * looking at X" when the shopper is looking at Y is worse than one that opens
 * with its ordinary greeting.
 */
export async function productForReference(reference: string, tenantSlug = seedTenant.slug) {
  const ref = reference.trim();
  if (!ref) return null;

  const products = await listTenantProducts(tenantSlug);
  const exact = products.find((product) => product.id === ref || product.sku === ref);
  if (exact) return exact;

  const handle = handleOf(ref);
  if (!handle) return null;
  return products.find((product) => product.url && handleOf(product.url) === handle) ?? null;
}

export async function createProductForTenant(tenantSlug: string, input: Omit<ProductCatalogItem, "id" | "tenantId">) {
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) throw new Error("Tenant not found.");

  const product = await withTenant(tenant.id, (tx) =>
    tx.product.create({
      data: {
        ...input,
        tenantId: tenant.id,
        price: input.price,
        sponsoredBidCpc: input.sponsoredBidCpc,
      },
    }),
  );

  invalidateCatalogue(tenantSlug);
  if (!product) return { ...input, id: crypto.randomUUID(), tenantId: tenant.id };
  return mapPrismaProduct(product);
}

/**
 * Import a product by its page URL rather than inserting a new row every time.
 *
 * A CSV import used to call `createProductForTenant` per row unconditionally,
 * so re-importing a catalogue duplicated all of it — one live catalogue reached
 * 964 rows for 509 real products, and shoppers were shown the same sunscreen
 * twice in one routine. The SKU cannot be the key: the exports carried
 * `csv-<timestamp>-<row>` SKUs, so the same product had a different SKU in
 * every export. The product URL is stable and was populated on every row.
 */
export async function importProductForTenant(
  tenantSlug: string,
  input: Omit<ProductCatalogItem, "id" | "tenantId">,
) {
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) throw new Error("Tenant not found.");

  const url = input.url?.trim();
  if (!url) return createProductForTenant(tenantSlug, input);

  // Match on the product handle, not the whole URL. The same store is reachable
  // on both its raw myshopify domain and its custom one, and the two exports
  // wrote different URLs for the same product — so matching the full string
  // still left a pair of rows for every product carried on both.
  const handle = productHandle(url);

  const product = await withTenant(tenant.id, async (tx) => {
    const existing = handle
      ? await tx.product.findFirst({
          where: { tenantId: tenant.id, url: { endsWith: `/products/${handle}`, mode: "insensitive" } },
        })
      : await tx.product.findFirst({ where: { tenantId: tenant.id, url } });
    if (!existing) {
      return tx.product.create({ data: { ...input, url, tenantId: tenant.id } });
    }
    return tx.product.update({ where: { id: existing.id }, data: { ...input, url } });
  });

  invalidateCatalogue(tenantSlug);
  if (!product) return { ...input, id: crypto.randomUUID(), tenantId: tenant.id };
  return mapPrismaProduct(product);
}

/**
 * Mark everything the merchant did not send this time as out of stock.
 *
 * Nothing else ever cleared the flag, so a product that vanished from the store
 * stayed sellable in the advisor for good. Rows are kept rather than deleted:
 * recommendations already made still point at them.
 */
export async function markMissingOutOfStock(tenantSlug: string, seenUrls: string[]) {
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) throw new Error("Tenant not found.");

  const result = await withTenant(tenant.id, (tx) =>
    tx.product.updateMany({
      where: { tenantId: tenant.id, inStock: true, url: { notIn: seenUrls } },
      data: { inStock: false },
    }),
  );
  invalidateCatalogue(tenantSlug);
  return result?.count ?? 0;
}

export async function updateProductForTenant(productId: string, tenantSlug: string, input: Partial<ProductCatalogItem>) {
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) throw new Error("Tenant not found.");

  return withTenant(tenant.id, async (tx) => {
    const existing = await tx.product.findFirst({
      where: { id: productId, tenantId: tenant.id },
    });
    if (!existing) return null;

    const product = await tx.product.update({
      where: { id: productId },
      data: {
        name: input.name,
        brand: input.brand,
        category: input.category,
        description: input.description,
        url: input.url,
        imageUrl: input.imageUrl,
        inStock: input.inStock,
        ingredientsJson: input.ingredientsJson,
        activeIngredientsJson: input.activeIngredientsJson,
        skinTypesJson: input.skinTypesJson,
        concernsJson: input.concernsJson,
        avoidIfJson: input.avoidIfJson,
        pregnancySafety: input.pregnancySafety,
        fragranceFree: input.fragranceFree,
        nonComedogenic: input.nonComedogenic,
        sensitiveSkinSuitable: input.sensitiveSkinSuitable,
        claimsJson: input.claimsJson,
        approvedClaimsJson: input.approvedClaimsJson,
        merchantPriority: input.merchantPriority,
        price: input.price,
        sponsoredBidCpc: input.sponsoredBidCpc,
      },
    });

    invalidateCatalogue(tenantSlug);
    return mapPrismaProduct(product);
  });
}

export async function deleteProductForTenant(productId: string, tenantSlug: string) {
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) throw new Error("Tenant not found.");

  await withTenant(tenant.id, async (tx) => {
    const existing = await tx.product.findFirst({
      where: { id: productId, tenantId: tenant.id },
    });
    if (existing) await tx.product.delete({ where: { id: productId } });
    return true;
  });

  invalidateCatalogue(tenantSlug);
  return { deleted: true };
}

function mapPrismaProduct(product: Product): ProductCatalogItem {
  // The importer writes the STORE's name into brand; the registry carries the
  // real brand and its origin, keyed by the product's stable handle.
  const registered = BRAND_BY_HANDLE[productHandle(product.url ?? "")];
  return {
    ...(registered ? { originBucket: registered.origin } : {}),
    id: product.id,
    tenantId: product.tenantId,
    sku: product.sku,
    name: product.name,
    brand: registered?.brand || product.brand,
    category: product.category,
    description: product.description,
    url: product.url,
    imageUrl: product.imageUrl,
    price: Number(product.price),
    currency: product.currency,
    inStock: product.inStock,
    ingredientsJson: asStringArray(product.ingredientsJson),
    activeIngredientsJson: asStringArray(product.activeIngredientsJson),
    skinTypesJson: asStringArray(product.skinTypesJson),
    concernsJson: asStringArray(product.concernsJson),
    avoidIfJson: asStringArray(product.avoidIfJson),
    pregnancySafety: product.pregnancySafety,
    fragranceFree: product.fragranceFree,
    nonComedogenic: product.nonComedogenic,
    sensitiveSkinSuitable: product.sensitiveSkinSuitable,
    claimsJson: asStringArray(product.claimsJson),
    approvedClaimsJson: asStringArray(product.approvedClaimsJson),
    merchantPriority: product.merchantPriority,
    sponsoredBidCpc: Number(product.sponsoredBidCpc),
  };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
