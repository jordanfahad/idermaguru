import type { Product } from "@prisma/client";
import type { ProductCatalogItem } from "@/domain/skincare";
import { seedProducts, seedTenant } from "@/data/seed-catalog";
import { getPrisma } from "@/server/db";
import { withTenant } from "@/lib/tenant-context";

// Tenant resolution: must run on the owner client — a role subject to RLS cannot
// look up a tenant by slug without already knowing its id.
export async function getTenantBySlug(slug = seedTenant.slug) {
  const prisma = getPrisma();
  if (!prisma) return seedTenant;

  try {
    return prisma.tenant.findUnique({ where: { slug } });
  } catch {
    return slug === seedTenant.slug ? seedTenant : null;
  }
}

function seedFallback(tenantId: string): ProductCatalogItem[] {
  return tenantId === seedTenant.id ? seedProducts.filter((product) => product.tenantId === seedTenant.id) : [];
}

export async function listTenantProducts(slug = seedTenant.slug): Promise<ProductCatalogItem[]> {
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
    return products.map(mapPrismaProduct);
  } catch {
    return seedFallback(tenant.id);
  }
}

export async function getProductByIdForTenant(productId: string, tenantSlug = seedTenant.slug) {
  const products = await listTenantProducts(tenantSlug);
  return products.find((product) => product.id === productId || product.sku === productId) ?? null;
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

  const product = await withTenant(tenant.id, async (tx) => {
    const existing = await tx.product.findFirst({ where: { tenantId: tenant.id, url } });
    if (!existing) {
      return tx.product.create({ data: { ...input, url, tenantId: tenant.id } });
    }
    return tx.product.update({ where: { id: existing.id }, data: { ...input, url } });
  });

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

  return { deleted: true };
}

function mapPrismaProduct(product: Product): ProductCatalogItem {
  return {
    id: product.id,
    tenantId: product.tenantId,
    sku: product.sku,
    name: product.name,
    brand: product.brand,
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
