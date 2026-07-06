import { NextResponse } from "next/server";
import { z } from "zod";
import { seedTenant } from "@/data/seed-catalog";
import { deleteProductForTenant, updateProductForTenant } from "@/services/catalog";
import { requireSuperAdmin } from "@/lib/admin-guard";
import { jsonError, parseJson, RequestValidationError } from "../../../_shared";

const UpdateSchema = z.object({
  tenantSlug: z.string().default(seedTenant.slug),
  name: z.string().optional(),
  brand: z.string().optional(),
  category: z.string().optional(),
  description: z.string().optional(),
  url: z.string().url().optional(),
  imageUrl: z.string().optional().nullable(),
  price: z.number().optional(),
  inStock: z.boolean().optional(),
  merchantPriority: z.number().optional(),
  sponsoredBidCpc: z.number().optional(),
});

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireSuperAdmin();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await context.params;
    const input = await parseJson(request, UpdateSchema);
    const product = await updateProductForTenant(id, input.tenantSlug, input);
    return NextResponse.json({ product });
  } catch (error) {
    if (error instanceof RequestValidationError) return jsonError(error.message);
    throw error;
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireSuperAdmin();
  if (session instanceof NextResponse) return session;

  const { id } = await context.params;
  const tenantSlug = new URL(request.url).searchParams.get("tenantSlug") ?? seedTenant.slug;
  const result = await deleteProductForTenant(id, tenantSlug);
  return NextResponse.json(result);
}
