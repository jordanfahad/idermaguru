import { NextResponse } from "next/server";
import { seedTenant } from "@/data/seed-catalog";
import { trackEvent } from "@/services/analytics";
import { getProductByIdForTenant, getTenantBySlug } from "@/services/catalog";
import { getPrisma } from "@/server/db";

export async function GET(
  request: Request,
  context: { params: Promise<{ recommendationItemId: string }> },
) {
  const { recommendationItemId } = await context.params;
  const url = new URL(request.url);
  const tenantSlug = url.searchParams.get("tenant") ?? seedTenant.slug;
  const sessionId = url.searchParams.get("sessionId");
  const prisma = getPrisma();
  let productUrl: string | null = null;
  let productId: string | null = null;
  let tenantId: string | null = null;
  let recommendationId: string | null = null;

  if (prisma) {
    const item = await prisma.recommendationItem.findUnique({
      where: { id: recommendationItemId },
      include: { product: true, recommendation: true },
    });
    if (item) {
      productUrl = item.product.url;
      productId = item.productId;
      tenantId = item.recommendation.tenantId;
      recommendationId = item.recommendationId;
    }
  }

  if (!productUrl) {
    const tenant = await getTenantBySlug(tenantSlug);
    const product = await getProductByIdForTenant(recommendationItemId, tenantSlug);
    productUrl = product?.url ?? `https://${tenant?.domain ?? seedTenant.domain}`;
    productId = product?.id ?? null;
    tenantId = tenant?.id ?? seedTenant.id;
  }

  const event = await trackEvent({
    tenantId: tenantId ?? seedTenant.id,
    sessionId,
    type: "PRODUCT_CLICK",
    productId,
    recommendationId,
    recommendationItemId,
    metadata: { referrer: request.headers.get("referer") },
  });

  const destination = new URL(productUrl);
  destination.searchParams.set("utm_source", "ai_skin_advisor");
  destination.searchParams.set("utm_medium", "recommendation_widget");
  destination.searchParams.set("utm_campaign", tenantSlug);
  destination.searchParams.set("click_id", event.id);

  return NextResponse.redirect(destination);
}
