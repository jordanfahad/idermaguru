import { NextResponse } from "next/server";
import { seedTenant } from "@/data/seed-catalog";
import { getAnalyticsSummary } from "@/services/analytics";
import { getTenantBySlug } from "@/services/catalog";
import { requireSuperAdmin } from "@/lib/admin-guard";

export async function GET(request: Request) {
  const session = await requireSuperAdmin();
  if (session instanceof NextResponse) return session;

  const tenantSlug = new URL(request.url).searchParams.get("tenantSlug") ?? seedTenant.slug;
  const tenant = await getTenantBySlug(tenantSlug);
  const analytics = await getAnalyticsSummary(tenant?.id ?? seedTenant.id);
  return NextResponse.json({ analytics });
}
