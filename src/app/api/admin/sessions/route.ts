import { NextResponse } from "next/server";
import { seedTenant } from "@/data/seed-catalog";
import { getTenantBySlug } from "@/services/catalog";
import { getPrisma } from "@/server/db";

export async function GET(request: Request) {
  const tenantSlug = new URL(request.url).searchParams.get("tenantSlug") ?? seedTenant.slug;
  const tenant = await getTenantBySlug(tenantSlug);
  const prisma = getPrisma();
  const sessions =
    prisma && tenant
      ? await prisma.userSession.findMany({
          where: { tenantId: tenant.id },
          orderBy: { startedAt: "desc" },
          take: 50,
        })
      : [];
  return NextResponse.json({ sessions });
}
