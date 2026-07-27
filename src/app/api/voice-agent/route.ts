import { NextResponse } from "next/server";
import { z } from "zod";
import { seedTenant } from "@/data/seed-catalog";
import type { IntakeProfileInput, ProductCatalogItem, SafetyTriage } from "@/domain/skincare";
import { getTenantBySlug, listTenantProducts } from "@/services/catalog";
import { getLLMProvider } from "@/services/llm/provider";
import { buildRecommendations, passesHardFilters } from "@/services/recommendation-engine";
import { runSafetyTriage, validateAssistantTextForSafety } from "@/services/safety-triage";
import {
  agentCopy,
  detectLang,
  extractSkinType,
  isHairConcern,
  nextQuestion,
  slotsToProfile,
  summariseSlots,
  updateSlots,
  type AgentLang,
  type AgentSlots,
} from "@/services/voice-agent";
import { detectLanguage, isRtl, localise, type LanguageCode } from "@/services/language";
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
  askedAllergyNames: z.boolean().optional(),
  misses: z.number().optional(),
});

const AgentSchema = z.object({
  tenantSlug: z.string().default(seedTenant.slug),
  sessionId: z.string().optional(),
  utterance: z.string().default(""),
  // Any BCP-47-ish code; the client echoes back whatever we last detected.
  language: z.string().max(12).optional(),
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
    // Detect from what was actually said; the shopper may switch mid-session.
    const spoken: LanguageCode = input.utterance.trim()
      ? detectLanguage(input.utterance)
      : (input.language ?? "en");
    // English and Arabic have authored copy; everything else is translated from
    // the English line, so the dialogue and its safety rules stay single-source.
    const lang: AgentLang = spoken === "ar" ? "ar" : "en";
    const copy = agentCopy(lang);
    const say = (text: string) => localise(text, spoken, getLLMProvider());

    // Opening turn: greet and ask for the concern.
    if (!input.utterance.trim() && !input.slots?.mainConcern) {
      return NextResponse.json({
        reply: await say(copy.greeting),
        phase: "asking",
        slots: {},
        products: [],
        language: spoken,
        rtl: isRtl(spoken),
      });
    }

    const before = (input.slots ?? {}) as AgentSlots;
    let slots: AgentSlots = updateSlots(before, input.utterance, lang);

    // When a real model is configured, let it read anything the deterministic
    // patterns missed - but only for non-safety slots. Pregnancy and allergies
    // stay with the explicit parser so a model can never assert them.
    //
    // Only on the opening description. Later turns are short answers ("yes",
    // "oily") that the patterns already handle, and calling the model on every
    // one of them added a round trip per turn for nothing.
    const firstDescription = !before.mainConcern && Boolean(slots.mainConcern);
    if (firstDescription && !slots.skinType) {
      const provider = getLLMProvider();
      if ((provider.lastUsedId ?? provider.id) !== "mock") {
        try {
          const intake = await provider.summarizeIntake([{ role: "user", content: input.utterance }]);
          const guess = typeof intake?.skinType === "string" ? extractSkinType(intake.skinType) : undefined;
          if (guess) slots = { ...slots, skinType: guess };
        } catch {
          // Understanding is a bonus; the scripted question still covers it.
        }
      }
    }
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
        reply: await say(misheard ? `${copy.repeat} ${pending.question}` : pending.question),
        phase: "asking",
        slots,
        products: [],
        language: spoken,
        rtl: isRtl(spoken),
      });
    }

    // We have everything -> run the real safety + recommendation pipeline.
    const tenant = await getTenantBySlug(input.tenantSlug);
    if (!tenant) return jsonError("Tenant not found.", 404);

    const profile = slotsToProfile(slots, input.sessionId);
    const safety = runSafetyTriage(profile);

    if (!safety.recommendationAllowed) {
      return NextResponse.json({
        reply: await say(safety.referralMessage ?? copy.noProducts),
        phase: "referral",
        slots,
        products: [],
        safetyLevel: safety.level,
        language: spoken,
        rtl: isRtl(spoken),
      });
    }

    const products = await listTenantProducts(input.tenantSlug);

    // Hair and scalp concerns don't fit the face-routine slot model, so match
    // them directly against the catalogue instead of building an AM/PM routine.
    // If the merchant stocks nothing suitable we say so rather than selling a
    // face routine for dandruff.
    if (isHairConcern(slots.mainConcern ?? "")) {
      const hairMatches = pickHairProducts(products, slots.mainConcern ?? "", profile, tenant.id, safety);
      return NextResponse.json({
        reply: await say(hairMatches.length ? copy.result(hairMatches.length) : copy.noHairProducts),
        phase: hairMatches.length ? "result" : "referral",
        slots,
        safetyLevel: safety.level,
        language: spoken,
        rtl: isRtl(spoken),
        products: hairMatches,
      });
    }
    const recommendation = buildRecommendations({
      tenantId: tenant.id,
      profile,
      safety,
      products,
      sponsoredEnabled: true,
    });

    if (!recommendation.items.length) {
      return NextResponse.json({
        reply: await say(copy.noProducts),
        phase: "result",
        slots,
        products: [],
        safetyLevel: safety.level,
        language: spoken,
        rtl: isRtl(spoken),
      });
    }

    // Let the model phrase the result, but re-run the safety gate over whatever
    // it produced and fall back to fixed copy if it drifts.
    const provider = getLLMProvider();
    // If the shopper volunteered everything up front we never asked a question,
    // so restate what was understood before recommending - otherwise jumping
    // straight to products reads as if it ignored them.
    const understood = summariseSlots(slots, lang);
    const skippedAhead = !before.askedSkinType && !before.askedPregnancy && !before.askedAllergies;
    const preface = skippedAhead && understood ? `${copy.understood(understood)} ` : "";
    let spokenReply = `${preface}${copy.result(recommendation.items.length)}`;
    // The mock provider emits a fixed, ungrammatical string that splices the raw
    // concern ("For I have a dandruff, ..."), so only ask a real model to phrase
    // the result. English only for now: the models are not prompted in Arabic.
    const usingRealModel = (provider.lastUsedId ?? provider.id) !== "mock";
    if (usingRealModel && lang === "en") {
      try {
        const explanation = await provider.explainRecommendations(profile, recommendation, safety);
        const postSafety = validateAssistantTextForSafety(explanation, safety);
        if (postSafety.recommendationAllowed && explanation.trim()) {
          spokenReply = `${preface}${shorten(explanation, 420)}`;
        }
      } catch {
        // Provider unavailable: the deterministic summary above is already correct.
      }
    }

    return NextResponse.json({
      reply: await say(spokenReply),
      phase: "result",
      slots,
      safetyLevel: safety.level,
      language: spoken,
        rtl: isRtl(spoken),
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

/**
 * Hair and scalp matching. Runs the same hard safety filters as the routine
 * builder, so allergy/pregnancy exclusions still apply, then ranks by how well
 * the product's own concern tags match what the shopper said.
 */
function pickHairProducts(
  products: ProductCatalogItem[],
  concern: string,
  profile: IntakeProfileInput,
  tenantId: string,
  safety: SafetyTriage,
) {
  const text = concern.toLowerCase();
  const wants = [
    { term: "dandruff", match: /dandruff|flake|flaky/ },
    { term: "hair fall", match: /fall|loss|shed|thinn|bald/ },
    { term: "dry", match: /dry|frizz|damage|split/ },
    { term: "oily", match: /oily|greasy/ },
  ]
    .filter((entry) => entry.match.test(text))
    .map((entry) => entry.term);

  return products
    .filter((product) => passesHardFilters(product, profile, tenantId, safety))
    .filter((product) => {
      const tags = product.concernsJson.map((tag) => tag.toLowerCase());
      const haystack = `${product.name} ${product.category}`.toLowerCase();
      return tags.includes("hair") || tags.includes("dandruff") || tags.includes("hair fall") ||
        /hair|scalp|shampoo|conditioner/.test(haystack);
    })
    .map((product) => {
      const tags = product.concernsJson.map((tag) => tag.toLowerCase());
      const haystack = `${product.name} ${product.category} ${product.description}`.toLowerCase();
      const specific = wants.filter((want) => tags.includes(want) || haystack.includes(want)).length;
      return { product, score: specific * 10 + product.merchantPriority / 100 };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(({ product }) => ({
      id: product.id,
      name: product.name,
      brand: product.brand,
      category: product.category,
      price: product.price,
      currency: product.currency,
      imageUrl: product.imageUrl ?? null,
      url: product.url,
      slot: "hair & scalp",
      reason: `${product.name} matches what you described and passed the safety checks.`,
      cautions: ["Patch test before first use.", "Follow the label directions."],
      sponsored: false,
    }));
}

function shorten(text: string, max = 90) {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}
