import type { Product } from "@prisma/client";
import type { ProductCatalogItem } from "@/domain/skincare";
import { seedProducts, seedTenant } from "@/data/seed-catalog";
import { getPrisma } from "@/server/db";

export async function getTenantBySlug(slug = seedTenant.slug) {
  const prisma = getPrisma();
  if (!prisma) return seedTenant;

  try {
    return prisma.tenant.findUnique({ where: { slug } });
  } catch {
    return slug === seedTenant.slug ? seedTenant : null;
  }
}

export async function listTenantProducts(slug = seedTenant.slug): Promise<ProductCatalogItem[]> {
  const prisma = getPrisma();
  if (!prisma) return seedProducts.filter((product) => product.tenantId === seedTenant.id);

  try {
    const tenant = await prisma.tenant.findUnique({
      where: { slug },
      include: { products: { orderBy: [{ merchantPriority: "desc" }, { name: "asc" }] } },
    });
    if (!tenant) return [];
    return tenant.products.map(mapPrismaProduct);
  } catch {
    return slug === seedTenant.slug ? seedProducts.filter((product) => product.tenantId === seedTenant.id) : [];
  }
}

export async function getProductByIdForTenant(productId: string, tenantSlug = seedTenant.slug) {
  const products = await listTenantProducts(tenantSlug);
  return products.find((product) => product.id === productId || product.sku === productId) ?? null;
}

export async function createProductForTenant(tenantSlug: string, input: Omit<ProductCatalogItem, "id" | "tenantId">) {
  const prisma = getPrisma();
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) throw new Error("Tenant not found.");
  if (!prisma) return { ...input, id: crypto.randomUUID(), tenantId: tenant.id };

  const product = await prisma.product.create({
    data: {
      ...input,
      tenantId: tenant.id,
      price: input.price,
      sponsoredBidCpc: input.sponsoredBidCpc,
    },
  });

  return mapPrismaProduct(product);
}

export async function updateProductForTenant(productId: string, tenantSlug: string, input: Partial<ProductCatalogItem>) {
  const prisma = getPrisma();
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) throw new Error("Tenant not found.");
  if (!prisma) return null;

  const existing = await prisma.product.findFirst({
    where: { id: productId, tenantId: tenant.id },
  });
  if (!existing) return null;

  const product = await prisma.product.update({
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
}

export async function deleteProductForTenant(productId: string, tenantSlug: string) {
  const prisma = getPrisma();
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) throw new Error("Tenant not found.");
  if (!prisma) return { deleted: true };

  const existing = await prisma.product.findFirst({
    where: { id: productId, tenantId: tenant.id },
  });
  if (existing) await prisma.product.delete({ where: { id: productId } });
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
