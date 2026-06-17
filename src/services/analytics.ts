import type { EventType } from "@/domain/skincare";
import { asPrismaJson } from "@/server/json";
import { getPrisma } from "@/server/db";

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
  const prisma = getPrisma();
  if (!prisma) {
    return {
      id: crypto.randomUUID(),
      ...input,
      createdAt: new Date().toISOString(),
    };
  }

  return prisma.event.create({
    data: {
      tenantId: input.tenantId,
      sessionId: input.sessionId ?? undefined,
      type: input.type,
      productId: input.productId ?? undefined,
      recommendationId: input.recommendationId ?? undefined,
      recommendationItemId: input.recommendationItemId ?? undefined,
      metadataJson: asPrismaJson(input.metadata ?? {}),
    },
  });
}

export async function getAnalyticsSummary(tenantId: string) {
  const prisma = getPrisma();

  if (!prisma) {
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
      topRecommendedProducts: [],
      topClickedProducts: [],
      conversionFunnel: [],
    };
  }

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
    prisma.userSession.count({ where: { tenantId } }),
    prisma.event.count({ where: { tenantId, type: "INTAKE_COMPLETED" } }),
    prisma.event.count({ where: { tenantId, type: "RED_FLAG_DETECTED" } }),
    prisma.recommendation.count({ where: { tenantId } }),
    prisma.event.count({ where: { tenantId, type: "PRODUCT_IMPRESSION" } }),
    prisma.event.count({ where: { tenantId, type: "PRODUCT_CLICK" } }),
    prisma.event.count({ where: { tenantId, type: "ADD_TO_CART" } }),
    prisma.conversion.count({ where: { tenantId } }),
    prisma.conversion.aggregate({ where: { tenantId }, _sum: { revenue: true } }),
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
    topRecommendedProducts: [],
    topClickedProducts: [],
    conversionFunnel: [
      { label: "Sessions", value: sessions },
      { label: "Completed intake", value: completedConsultations },
      { label: "Recommendations", value: recommendations },
      { label: "Clicks", value: productClicks },
      { label: "Purchases", value: purchases },
    ],
  };
}
