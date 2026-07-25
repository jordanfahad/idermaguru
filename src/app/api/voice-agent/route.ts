import { NextResponse } from "next/server";
import { z } from "zod";
import { seedTenant } from "@/data/seed-catalog";
import { getTenantBySlug, listTenantProducts } from "@/services/catalog";
import { getLLMProvider } from "@/services/llm/provider";
import { buildRecommendations } from "@/services/recommendation-engine";
import { runSafetyTriage, validateAssistantTextForSafety } from "@/services/safety-triage";
import {
  agentCopy,
  detectLang,
  isHairConcern,
  nextQuestion,
  slotsToProfile,
  updateSlots,
  type AgentLang,
  type AgentSlots,
} from "@/services/voice-agent";
import { jsonError, parseJson, RequestValidationError } from "../_shared";

export const runtime = "nodejs";

const SlotsSchema = z.object({
  mainConcern: z.string().optional(),
  skinType: z.string().optional(),
  pregnantOrBreastfeeding: z.boolean().optional(),
  allergies: z.array(z.string()).optional(),
  askedPregnancy: z.boolean().optional(),
  askedAllergies: z.boolean().optional(),
  askedSkinType: z.boolean().optional(),
});

const AgentSchema = z.object({
  tenantSlug: z.string().default(seedTenant.slug),
  sessionId: z.string().optional(),
  utterance: z.string().default(""),
  language: z.enum(["en", "ar"]).optional(),
  slots: SlotsSchema.optional(),
});

/**
 * One turn of the voice concierge.
 *
 * The dialogue backbone is deterministic (see services/voice-agent.ts) so the
 * safety questions are always asked and answered before any product is spoken.
 * The LLM only enriches understanding and phrasing; product selection always
 * goes through runSafetyTriage + buildRecommendations, so the agent can never
 * name a product the engine filtered out.
 */
export async function POST(request: Request) {
  try {
    const input = await parseJson(request, AgentSchema);
    const lang: AgentLang = input.language ?? detectLang(input.utterance, "en");
    const copy = agentCopy(lang);

    // Opening turn: greet and ask for the concern.
    if (!input.utterance.trim() && !input.slots?.mainConcern) {
      return NextResponse.json({
        reply: copy.greeting,
        phase: "asking",
        slots: {},
        products: [],
        language: lang,
      });
    }

    const before = (input.slots ?? {}) as AgentSlots;
    let slots: AgentSlots = updateSlots(before, input.utterance, lang);
    // Nothing new was understood from a non-empty answer -> we are about to ask
    // the same question again, so acknowledge the mishearing.
    const misheard =
      Boolean(input.utterance.trim()) && JSON.stringify(before) === JSON.stringify(slots);

    // Still gathering the required intake -> ask the next question.
    const pending = nextQuestion(slots, lang);
    if (pending) {
      slots = pending.slots;
      // Never repeat the transcript back: speech-to-text mistakes ("I'm a man"
      // -> "I am a mad") turn a friendly echo into an insult.
      return NextResponse.json({
        reply: misheard ? `${copy.repeat} ${pending.question}` : pending.question,
        phase: "asking",
        slots,
        products: [],
        language: lang,
      });
    }

    // Hair and scalp concerns: this catalogue is skincare only, so recommending
    // a face routine for dandruff would be worse than saying we can't help.
    if (isHairConcern(slots.mainConcern ?? "")) {
      return NextResponse.json({
        reply: copy.noHairProducts,
        phase: "referral",
        slots,
        products: [],
        language: lang,
      });
    }

    // We have everything -> run the real safety + recommendation pipeline.
    const tenant = await getTenantBySlug(input.tenantSlug);
    if (!tenant) return jsonError("Tenant not found.", 404);

    const profile = slotsToProfile(slots, input.sessionId);
    const safety = runSafetyTriage(profile);

    if (!safety.recommendationAllowed) {
      return NextResponse.json({
        reply: safety.referralMessage ?? copy.noProducts,
        phase: "referral",
        slots,
        products: [],
        safetyLevel: safety.level,
        language: lang,
      });
    }

    const products = await listTenantProducts(input.tenantSlug);
    const recommendation = buildRecommendations({
      tenantId: tenant.id,
      profile,
      safety,
      products,
      sponsoredEnabled: true,
    });

    if (!recommendation.items.length) {
      return NextResponse.json({
        reply: copy.noProducts,
        phase: "result",
        slots,
        products: [],
        safetyLevel: safety.level,
        language: lang,
      });
    }

    // Let the model phrase the result, but re-run the safety gate over whatever
    // it produced and fall back to fixed copy if it drifts.
    const provider = getLLMProvider();
    let spoken = copy.result(recommendation.items.length);
    // The mock provider emits a fixed, ungrammatical string that splices the raw
    // concern ("For I have a dandruff, ..."), so only ask a real model to phrase
    // the result. English only for now: the models are not prompted in Arabic.
    const usingRealModel = (provider.lastUsedId ?? provider.id) !== "mock";
    if (usingRealModel && lang === "en") {
      try {
        const explanation = await provider.explainRecommendations(profile, recommendation, safety);
        const postSafety = validateAssistantTextForSafety(explanation, safety);
        if (postSafety.recommendationAllowed && explanation.trim()) {
          spoken = shorten(explanation, 420);
        }
      } catch {
        // Provider unavailable: the deterministic summary above is already correct.
      }
    }

    return NextResponse.json({
      reply: spoken,
      phase: "result",
      slots,
      safetyLevel: safety.level,
      language: lang,
      products: recommendation.items.map((item) => ({
        id: item.product.id,
        name: item.product.name,
        brand: item.product.brand,
        category: item.product.category,
        price: item.product.price,
        currency: item.product.currency,
        imageUrl: item.product.imageUrl ?? null,
        url: item.product.url,
        slot: item.slot,
        reason: item.reason,
        cautions: item.cautions,
        sponsored: item.sponsored,
      })),
      disclosure: recommendation.disclosureText,
    });
  } catch (error) {
    if (error instanceof RequestValidationError) return jsonError(error.message);
    throw error;
  }
}

function shorten(text: string, max = 90) {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}
