import { NextResponse } from "next/server";
import { z } from "zod";
import { seedTenant } from "@/data/seed-catalog";
import { getTenantBySlug } from "@/services/catalog";
import { getSessionTenantId } from "@/services/tenant-scope";
import { trackEvent } from "@/services/analytics";
import { runSafetyTriage } from "@/services/safety-triage";
import { getPrisma } from "@/server/db";
import { jsonError, parseJson, RequestValidationError } from "../_shared";

export const IntakeSchema = z.object({
  tenantSlug: z.string().default(seedTenant.slug),
  sessionId: z.string().optional(),
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
  severitySelfRated: z.number().int().min(1).max(10).optional(),
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
});

export async function POST(request: Request) {
  try {
    const input = await parseJson(request, IntakeSchema);
    const tenant = await getTenantBySlug(input.tenantSlug);
    if (!tenant) return jsonError("Tenant not found.", 404);

    const prisma = getPrisma();
    if (prisma && input.sessionId) {
      const ownerTenantId = await getSessionTenantId(input.sessionId);
      if (!ownerTenantId) return jsonError("Unknown session.", 404);
      if (ownerTenantId !== tenant.id) return jsonError("Session does not belong to this tenant.", 403);
    }

    const safety = runSafetyTriage(input);

    if (prisma && input.sessionId) {
      await prisma.intakeProfile.upsert({
        where: { sessionId: input.sessionId },
        update: {
          ageRange: input.ageRange,
          country: input.country,
          mainConcern: input.mainConcern,
          secondaryConcerns: input.secondaryConcerns,
          skinType: input.skinType,
          sensitivity: input.sensitivity,
          pregnantOrBreastfeeding: input.pregnantOrBreastfeeding,
          allergies: input.allergies,
          currentProducts: input.currentProducts,
          currentActives: input.currentActives,
          prescriptionUse: input.prescriptionUse,
          severitySelfRated: input.severitySelfRated,
          duration: input.duration,
          symptoms: input.symptoms,
          budgetMin: input.budgetMin,
          budgetMax: input.budgetMax,
          routinePreference: input.routinePreference,
          fragrancePreference: input.fragrancePreference,
          texturePreference: input.texturePreference,
          sunscreenUse: input.sunscreenUse,
          previousIrritationHistory: input.previousIrritationHistory,
        },
        create: {
          sessionId: input.sessionId,
          ageRange: input.ageRange,
          country: input.country,
          mainConcern: input.mainConcern,
          secondaryConcerns: input.secondaryConcerns,
          skinType: input.skinType,
          sensitivity: input.sensitivity,
          pregnantOrBreastfeeding: input.pregnantOrBreastfeeding,
          allergies: input.allergies,
          currentProducts: input.currentProducts,
          currentActives: input.currentActives,
          prescriptionUse: input.prescriptionUse,
          severitySelfRated: input.severitySelfRated,
          duration: input.duration,
          symptoms: input.symptoms,
          budgetMin: input.budgetMin,
          budgetMax: input.budgetMax,
          routinePreference: input.routinePreference,
          fragrancePreference: input.fragrancePreference,
          texturePreference: input.texturePreference,
          sunscreenUse: input.sunscreenUse,
          previousIrritationHistory: input.previousIrritationHistory,
        },
      });
    }

    await trackEvent({
      tenantId: tenant.id,
      sessionId: input.sessionId,
      type: safety.recommendationAllowed ? "INTAKE_COMPLETED" : "RED_FLAG_DETECTED",
      metadata: { safety },
    });

    return NextResponse.json({ intake: input, safety });
  } catch (error) {
    if (error instanceof RequestValidationError) return jsonError(error.message);
    throw error;
  }
}
