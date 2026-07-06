import { NextResponse } from "next/server";
import { seedTenant } from "@/data/seed-catalog";
import { getTenantBySlug } from "@/services/catalog";
import { getPrisma } from "@/server/db";
import { requireSuperAdmin } from "@/lib/admin-guard";

export async function GET(request: Request) {
  const session = await requireSuperAdmin();
  if (session instanceof NextResponse) return session;

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
