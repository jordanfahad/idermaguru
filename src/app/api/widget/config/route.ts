import { NextResponse } from "next/server";
import { seedTenant } from "@/data/seed-catalog";
import { buildWidgetConfig } from "@/lib/widget-config";
import { getTenantBySlug } from "@/services/catalog";

// Public config for the embeddable widget. CORS is applied in proxy.ts so the
// widget can fetch this cross-origin from any merchant store.
export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("tenant")?.trim() || seedTenant.slug;
  const tenant = await getTenantBySlug(slug);

  const config = buildWidgetConfig({
    slug,
    name: tenant?.name,
    disclosureText: tenant?.disclosureText,
    found: Boolean(tenant),
  });

  return NextResponse.json(config);
}
