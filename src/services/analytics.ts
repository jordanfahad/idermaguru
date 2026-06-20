import type { EventType } from "@/domain/skincare";
import { asPrismaJson } from "@/server/json";
import { withTenant } from "@/lib/tenant-context";

export type TrackEventInput = {
  tenantId: string;
  sessionId?: string | null;
  type: EventType;
  productId?: string | null;
  recommendationId?: string | null;
  recommendationItemId?: string | null;
  metadata?: Record<string, unknown>;
};

export async function trackEvent(input: TrackEventInput) {
  const event = await withTenant(input.tenantId, (tx) =>
    tx.event.create({
      data: {
        tenantId: input.tenantId,
        sessionId: input.sessionId ?? undefined,
        type: input.type,
        productId: input.productId ?? undefined,
        recommendationId: input.recommendationId ?? undefined,
        recommendationItemId: input.recommendationItemId ?? undefined,
        metadataJson: asPrismaJson(input.metadata ?? {}),
      },
    }),
  );

  if (event) return event;

  return {
    id: crypto.randomUUID(),
    ...input,
    createdAt: new Date().toISOString(),
  };
}

export async function getAnalyticsSummary(tenantId: string) {
  const summary = await withTenant(tenantId, async (tx) => {
    const [
      sessions,
      completedConsultations,
      redFlagReferrals,
      recommendations,
      productImpressions,
      productClicks,
      addToCartEvents,
      purchases,
      revenue,
    ] = await Promise.all([
      tx.userSession.count({ where: { tenantId } }),
      tx.event.count({ where: { tenantId, type: "INTAKE_COMPLETED" } }),
      tx.event.count({ where: { tenantId, type: "RED_FLAG_DETECTED" } }),
      tx.recommendation.count({ where: { tenantId } }),
      tx.event.count({ where: { tenantId, type: "PRODUCT_IMPRESSION" } }),
      tx.event.count({ where: { tenantId, type: "PRODUCT_CLICK" } }),
      tx.event.count({ where: { tenantId, type: "ADD_TO_CART" } }),
      tx.conversion.count({ where: { tenantId } }),
      tx.conversion.aggregate({ where: { tenantId }, _sum: { revenue: true } }),
    ]);

    const attributedRevenue = Number(revenue._sum.revenue ?? 0);

    return {
      sessions,
      completedConsultations,
      redFlagReferrals,
      recommendations,
      productImpressions,
      productClicks,
      ctr: productImpressions ? productClicks / productImpressions : 0,
      addToCartEvents,
      purchases,
      attributedRevenue,
      revenuePerConsultation: completedConsultations ? attributedRevenue / completedConsultations : 0,
      topRecommendedProducts: [] as string[],
      topClickedProducts: [] as string[],
      conversionFunnel: [
        { label: "Sessions", value: sessions },
        { label: "Completed intake", value: completedConsultations },
        { label: "Recommendations", value: recommendations },
        { label: "Clicks", value: productClicks },
        { label: "Purchases", value: purchases },
      ],
    };
  });

  if (summary) return summary;

  return {
    sessions: 0,
    completedConsultations: 0,
    redFlagReferrals: 0,
    recommendations: 0,
    productImpressions: 0,
    productClicks: 0,
    ctr: 0,
    addToCartEvents: 0,
    purchases: 0,
    attributedRevenue: 0,
    revenuePerConsultation: 0,
    topRecommendedProducts: [] as string[],
    topClickedProducts: [] as string[],
    conversionFunnel: [] as { label: string; value: number }[],
  };
}
