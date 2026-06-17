import { PrismaClient } from "@prisma/client";
import { CUSTOMER_DISCLAIMER, SPONSORED_DISCLOSURE } from "../src/domain/skincare";
import { seedProducts, seedTenant } from "../src/data/seed-catalog";

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: seedTenant.slug },
    update: {
      name: seedTenant.name,
      domain: seedTenant.domain,
      disclosureText: CUSTOMER_DISCLAIMER,
      brandVoice: seedTenant.brandVoice,
    },
    create: {
      slug: seedTenant.slug,
      name: seedTenant.name,
      domain: seedTenant.domain,
      disclosureText: CUSTOMER_DISCLAIMER,
      brandVoice: seedTenant.brandVoice,
    },
  });

  await prisma.merchantPlan.upsert({
    where: { id: `${tenant.id}_starter_plan` },
    update: {
      planName: "Starter",
      monthlyPrice: 99,
      usageLimit: 1000,
      cpcEnabled: true,
      cpaEnabled: true,
      sponsoredEnabled: true,
    },
    create: {
      id: `${tenant.id}_starter_plan`,
      tenantId: tenant.id,
      planName: "Starter",
      monthlyPrice: 99,
      usageLimit: 1000,
      cpcEnabled: true,
      cpaEnabled: true,
      sponsoredEnabled: true,
    },
  });

  for (const product of seedProducts) {
    await prisma.product.upsert({
      where: {
        tenantId_sku: {
          tenantId: tenant.id,
          sku: product.sku,
        },
      },
      update: {
        name: product.name,
        brand: product.brand,
        category: product.category,
        description: product.description,
        url: product.url,
        imageUrl: product.imageUrl,
        price: product.price,
        currency: product.currency,
        inStock: product.inStock,
        ingredientsJson: product.ingredientsJson,
        activeIngredientsJson: product.activeIngredientsJson,
        skinTypesJson: product.skinTypesJson,
        concernsJson: product.concernsJson,
        avoidIfJson: product.avoidIfJson,
        pregnancySafety: product.pregnancySafety,
        fragranceFree: product.fragranceFree,
        nonComedogenic: product.nonComedogenic,
        sensitiveSkinSuitable: product.sensitiveSkinSuitable,
        claimsJson: product.claimsJson,
        approvedClaimsJson: product.approvedClaimsJson,
        merchantPriority: product.merchantPriority,
        sponsoredBidCpc: product.sponsoredBidCpc,
      },
      create: {
        tenantId: tenant.id,
        sku: product.sku,
        name: product.name,
        brand: product.brand,
        category: product.category,
        description: product.description,
        url: product.url,
        imageUrl: product.imageUrl,
        price: product.price,
        currency: product.currency,
        inStock: product.inStock,
        ingredientsJson: product.ingredientsJson,
        activeIngredientsJson: product.activeIngredientsJson,
        skinTypesJson: product.skinTypesJson,
        concernsJson: product.concernsJson,
        avoidIfJson: product.avoidIfJson,
        pregnancySafety: product.pregnancySafety,
        fragranceFree: product.fragranceFree,
        nonComedogenic: product.nonComedogenic,
        sensitiveSkinSuitable: product.sensitiveSkinSuitable,
        claimsJson: product.claimsJson,
        approvedClaimsJson: product.approvedClaimsJson,
        merchantPriority: product.merchantPriority,
        sponsoredBidCpc: product.sponsoredBidCpc,
      },
    });
  }

  console.log(`Seeded ${tenant.name} with ${seedProducts.length} products.`);
  console.log(SPONSORED_DISCLOSURE);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
