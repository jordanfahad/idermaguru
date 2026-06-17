import { NextResponse } from "next/server";
import { z } from "zod";
import { seedTenant } from "@/data/seed-catalog";
import { type IntakeProfileInput } from "@/domain/skincare";
import { trackEvent } from "@/services/analytics";
import { getTenantBySlug, listTenantProducts } from "@/services/catalog";
import { getLLMProvider } from "@/services/llm/provider";
import { buildRecommendations } from "@/services/recommendation-engine";
import { runSafetyTriage, validateAssistantTextForSafety } from "@/services/safety-triage";
import { getPrisma } from "@/server/db";
import { asPrismaJson } from "@/server/json";
import { jsonError, parseJson, RequestValidationError } from "../_shared";

const RecommendationSchema = z.object({
  tenantSlug: z.string().default(seedTenant.slug),
  sessionId: z.string().optional(),
  intake: z
    .object({
      ageRange: z.string().optional(),
      country: z.string().optional(),
      mainConcern: z.string().min(2),
      secondaryConcerns: z.array(z.string()).optional().default([]),
      skinType: z.string().optional(),
      sensitivity: z.string().optional(),
      pregnantOrBreastfeeding: z.boolean().optional().default(false),
      allergies: z.array(z.string()).optional().default([]),
      currentProducts: z.array(z.string()).optional().default([]),
      currentActives: z.array(z.string()).optional().default([]),
      prescriptionUse: z.boolean().optional().default(false),
      severitySelfRated: z.number().optional(),
      duration: z.string().optional(),
      symptoms: z.array(z.string()).optional().default([]),
      budgetMin: z.number().optional(),
      budgetMax: z.number().optional(),
      routinePreference: z.string().optional(),
      fragrancePreference: z.string().optional(),
      texturePreference: z.string().optional(),
      sunscreenUse: z.string().optional(),
      previousIrritationHistory: z.string().optional(),
      freeText: z.string().optional(),
    })
    .optional(),
  concern: z.string().optional(),
  skinType: z.string().optional(),
  goals: z.array(z.string()).optional().default([]),
});

export async function POST(request: Request) {
  try {
    const input = await parseJson(request, RecommendationSchema);
    const tenant = await getTenantBySlug(input.tenantSlug);
    if (!tenant) return jsonError("Tenant not found.", 404);

    const profile: IntakeProfileInput = input.intake ?? {
      sessionId: input.sessionId,
      mainConcern: input.concern ?? "general routine building",
      secondaryConcerns: input.goals,
      skinType: input.skinType,
      routinePreference: "simple",
    };
    profile.sessionId = input.sessionId;

    const products = await listTenantProducts(input.tenantSlug);
    const safety = runSafetyTriage(profile);
    const recommendation = buildRecommendations({
      tenantId: tenant.id,
      profile,
      safety,
      products,
      sponsoredEnabled: true,
    });

    const explanation = await getLLMProvider().explainRecommendations(profile, recommendation, safety);
    const postSafety = validateAssistantTextForSafety(explanation, safety);
    if (!postSafety.recommendationAllowed) {
      recommendation.summary = postSafety.referralMessage ?? recommendation.summary;
      recommendation.items = [];
      recommendation.safety = postSafety;
    }

    const saved = await saveRecommendation({
      tenantId: tenant.id,
      sessionId: input.sessionId,
      recommendation,
      explanation,
    });

    await trackEvent({
      tenantId: tenant.id,
      sessionId: input.sessionId,
      type: recommendation.items.length ? "RECOMMENDATION_VIEWED" : "RED_FLAG_DETECTED",
      recommendationId: saved?.id,
      metadata: { safety: recommendation.safety.level },
    });

    return NextResponse.json({
      recommendation,
      explanation,
      id: saved?.id,
      items: saved?.items ?? recommendation.items,
      products: recommendation.items.map((item) => item.product),
      pageUrl: saved?.id ? `/recommendations/${saved.id}` : undefined,
      source: process.env.LLM_PROVIDER === "openai-compatible" ? "ai" : "mock",
    });
  } catch (error) {
    if (error instanceof RequestValidationError) return jsonError(error.message);
    throw error;
  }
}

async function saveRecommendation(input: {
  tenantId: string;
  sessionId?: string;
  recommendation: ReturnType<typeof buildRecommendations>;
  explanation: string;
}) {
  const prisma = getPrisma();
  if (!prisma || !input.sessionId) return null;

  const safety = await prisma.safetyTriageResult.create({
    data: {
      sessionId: input.sessionId,
      level: input.recommendation.safety.level,
      reasonsJson: asPrismaJson(input.recommendation.safety.reasons),
      recommendationAllowed: input.recommendation.safety.recommendationAllowed,
      referralMessage: input.recommendation.safety.referralMessage,
    },
  });

  return prisma.recommendation.create({
    data: {
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      safetyTriageResultId: safety.id,
      summary: `${input.recommendation.summary}\n\n${input.explanation}`,
      routineJson: asPrismaJson({
        items: input.recommendation.items.map((item) => ({
          productId: item.product.id,
          slot: item.slot,
          usageGuidance: item.usageGuidance,
        })),
      }),
      disclosureText: input.recommendation.disclosureText,
      items: {
        create: input.recommendation.items.map((item, index) => ({
          productId: item.product.id,
          slot: item.slot,
          score: item.score.finalScore,
          reason: item.reason,
          cautionsJson: asPrismaJson(item.cautions),
          sponsored: item.sponsored,
          rank: index + 1,
        })),
      },
    },
    include: {
      items: true,
    },
  });
}
