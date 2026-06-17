import { NextResponse } from "next/server";
import { seedTenant } from "@/data/seed-catalog";
import { getAnalyticsSummary } from "@/services/analytics";
import { getTenantBySlug } from "@/services/catalog";

export async function GET(request: Request) {
  const tenantSlug = new URL(request.url).searchParams.get("tenantSlug") ?? seedTenant.slug;
  const tenant = await getTenantBySlug(tenantSlug);
  const analytics = await getAnalyticsSummary(tenant?.id ?? seedTenant.id);
  return NextResponse.json({ analytics });
}
