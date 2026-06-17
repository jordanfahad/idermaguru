import { NextResponse } from "next/server";
import { z } from "zod";
import { seedTenant } from "@/data/seed-catalog";
import { createProductForTenant, listTenantProducts } from "@/services/catalog";
import { jsonError, parseJson, RequestValidationError } from "../../_shared";

const ProductSchema = z.object({
  tenantSlug: z.string().default(seedTenant.slug),
  sku: z.string(),
  name: z.string(),
  brand: z.string(),
  category: z.string(),
  description: z.string(),
  url: z.string().url(),
  imageUrl: z.string().optional().nullable(),
  price: z.number(),
  currency: z.string().default("AED"),
  inStock: z.boolean().default(true),
  ingredientsJson: z.array(z.string()).default([]),
  activeIngredientsJson: z.array(z.string()).default([]),
  skinTypesJson: z.array(z.string()).default([]),
  concernsJson: z.array(z.string()).default([]),
  avoidIfJson: z.array(z.string()).default([]),
  pregnancySafety: z.enum(["UNKNOWN", "AVOID", "CAUTION", "GENERALLY_ACCEPTED"]).default("UNKNOWN"),
  fragranceFree: z.boolean().default(false),
  nonComedogenic: z.boolean().default(false),
  sensitiveSkinSuitable: z.boolean().default(false),
  claimsJson: z.array(z.string()).default([]),
  approvedClaimsJson: z.array(z.string()).default([]),
  merchantPriority: z.number().int().default(0),
  sponsoredBidCpc: z.number().default(0),
});

export async function GET(request: Request) {
  const tenantSlug = new URL(request.url).searchParams.get("tenantSlug") ?? seedTenant.slug;
  const products = await listTenantProducts(tenantSlug);
  return NextResponse.json({ products });
}

export async function POST(request: Request) {
  try {
    const input = await parseJson(request, ProductSchema);
    const { tenantSlug, ...productInput } = input;
    const product = await createProductForTenant(tenantSlug, productInput);
    return NextResponse.json({ product });
  } catch (error) {
    if (error instanceof RequestValidationError) return jsonError(error.message);
    throw error;
  }
}
