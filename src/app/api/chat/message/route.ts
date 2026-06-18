import { NextResponse } from "next/server";
import { z } from "zod";
import { ESCALATION_MESSAGE } from "@/domain/skincare";
import { seedTenant } from "@/data/seed-catalog";
import { listTenantProducts } from "@/services/catalog";
import { getLLMProvider } from "@/services/llm/provider";
import { runSafetyTriage, validateAssistantTextForSafety } from "@/services/safety-triage";
import { jsonError, parseJson, RequestValidationError } from "../../_shared";

const MessageSchema = z.object({
  tenantSlug: z.string().default(seedTenant.slug),
  sessionId: z.string().optional(),
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant", "system"]),
      content: z.string().min(1),
    }),
  ),
});

export async function POST(request: Request) {
  try {
    const input = await parseJson(request, MessageSchema);
    const provider = getLLMProvider();
    const products = await listTenantProducts(input.tenantSlug);
    const intake = await provider.summarizeIntake(input.messages);
    const safety = runSafetyTriage({
      mainConcern: intake.mainConcern ?? input.messages.at(-1)?.content ?? "general routine building",
      ...intake,
    });
    const draft = await provider.generateAssistantMessage({
      messages: input.messages,
      approvedProducts: products,
      safety,
    });

    // Output gate (spec §3.3): scan the model's reply for diagnostic phrasing,
    // treat/cure/prevent claims, or a newly surfaced red flag. If detected, replace
    // the draft with the safe template instead of returning it to the shopper.
    const outputSafety = validateAssistantTextForSafety(draft, safety);
    const message = outputSafety.recommendationAllowed ? draft : outputSafety.referralMessage ?? ESCALATION_MESSAGE;

    return NextResponse.json({
      message,
      intake,
      safety: outputSafety,
      provider: provider.lastUsedId ?? provider.id,
    });
  } catch (error) {
    if (error instanceof RequestValidationError) return jsonError(error.message);
    throw error;
  }
}
