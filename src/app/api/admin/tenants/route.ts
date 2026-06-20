import { NextResponse } from "next/server";
import { z } from "zod";
import { seedTenant } from "@/data/seed-catalog";
import { getPrisma } from "@/server/db";
import { requireSuperAdmin } from "@/lib/admin-guard";
import { jsonError, parseJson, RequestValidationError } from "../../_shared";

const TenantSchema = z.object({
  slug: z.string(),
  name: z.string(),
  domain: z.string(),
  disclosureText: z.string(),
  brandVoice: z.string().optional(),
});

export async function GET() {
  const session = await requireSuperAdmin();
  if (session instanceof NextResponse) return session;

  const prisma = getPrisma();
  const tenants = prisma ? await prisma.tenant.findMany({ orderBy: { createdAt: "desc" } }) : [seedTenant];
  return NextResponse.json({ tenants });
}

export async function POST(request: Request) {
  const session = await requireSuperAdmin();
  if (session instanceof NextResponse) return session;

  try {
    const input = await parseJson(request, TenantSchema);
    const prisma = getPrisma();
    if (!prisma) return NextResponse.json({ tenant: { id: crypto.randomUUID(), ...input } });
    const tenant = await prisma.tenant.create({ data: input });
    return NextResponse.json({ tenant });
  } catch (error) {
    if (error instanceof RequestValidationError) return jsonError(error.message);
    throw error;
  }
}
