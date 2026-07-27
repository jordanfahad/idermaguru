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
  classifyAside,
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
import { productKind, routineStep } from "@/services/product-taxonomy";
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
  offTopic: z.number().optional(),
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
        speech: speakable(spoken, "", copy.greeting),
        phase: "asking",
        slots: {},
        products: [],
        language: spoken,
        rtl: isRtl(spoken),
      });
    }

    const before = (input.slots ?? {}) as AgentSlots;

    // Greetings, "what are you?", thanks, or a genuine tangent: answer it, then
    // steer back to the question that's still open instead of parsing it as a
    // skin concern or failing to understand.
    // While waiting for the allergen list, whatever they say IS the answer -
    // an ingredient name must never be mistaken for a tangent.
    const awaitingAllergens = Boolean(before.askedAllergyNames) && before.allergies === undefined;
    const aside = before.mainConcern && !awaitingAllergens ? classifyAside(input.utterance) : null;
    if (aside) {
      const pendingAside = nextQuestion(before, lang);
      const offTopicRun = aside === "offtopic" ? (before.offTopic ?? 0) + 1 : 0;

      let leadIn: string;
      let question = pendingAside?.question;
      if (aside !== "offtopic") {
        leadIn = copy.aside[aside];
      } else if (offTopicRun >= 2) {
        // They meant it. Stop asking - pressing a third time is nagging.
        leadIn = copy.offTopicLetGo;
        question = undefined;
      } else {
        // Name what they actually raised before redirecting, so the bridge
        // reads as listening rather than a canned refusal.
        const topic = await withBudget(summariseTopic(input.utterance, lang), 1200, "");
        leadIn = topic ? copy.offTopicBridge(topic) : copy.aside.offtopic;
      }
      const line = question ? `${leadIn} ${question}` : leadIn;

      return NextResponse.json({
        reply: await say(line),
        speech: speakable(spoken, leadIn, question),
        phase: "asking",
        slots: { ...(pendingAside?.slots ?? before), offTopic: offTopicRun },
        products: [],
        language: spoken,
        rtl: isRtl(spoken),
      });
    }

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
        // Understanding is a bonus; the scripted question still covers it, so
        // it never gets more than a moment of the shopper's time.
        const intake = await withBudget(
          provider.summarizeIntake([{ role: "user", content: input.utterance }]),
          1200,
          null,
        );
        const guess = typeof intake?.skinType === "string" ? extractSkinType(intake.skinType) : undefined;
        if (guess) slots = { ...slots, skinType: guess };
      }
    }
    // Safety is screened on every turn, against what was just said as well as
    // the concern so far. It used to run only once the intake was complete, on
    // the assembled profile — so "I have blue patches" said in answer to the
    // skin-type question was parsed as an unusable answer, dropped, and never
    // seen by the triage that exists precisely to catch it. Anything alarming
    // stops the intake here, whichever question happened to be open.
    const turnSafety = runSafetyTriage({
      ...slotsToProfile(slots, input.sessionId),
      mainConcern: [slots.mainConcern, input.utterance].filter(Boolean).join(". "),
    });
    if (!turnSafety.recommendationAllowed) {
      return NextResponse.json({
        reply: await say(turnSafety.referralMessage ?? copy.noProducts),
        phase: "referral",
        slots,
        products: [],
        safetyLevel: turnSafety.level,
        language: spoken,
        rtl: isRtl(spoken),
      });
    }

    // Nothing new was understood from a non-empty answer -> we are about to ask
    // the same question again, so acknowledge the mishearing.
    const misheard =
      Boolean(input.utterance.trim()) && JSON.stringify(before) === JSON.stringify(slots);

    // Still gathering the required intake -> ask the next question.
    const pending = nextQuestion(slots, lang);
    if (pending) {
      slots = pending.slots;
      // If they answered a question we hadn't asked yet, say so before asking
      // again - otherwise repeating the question reads as if we ignored them.
      const learned = summariseSlots(
        {
          skinType: before.skinType ? undefined : slots.skinType,
          pregnantOrBreastfeeding:
            before.pregnantOrBreastfeeding === undefined ? slots.pregnantOrBreastfeeding : undefined,
          allergies: before.allergies === undefined ? slots.allergies : undefined,
        },
        lang,
      );
      // Acknowledge the opening concern in the agent's own words. Echoing the
      // raw transcript is what made "I am a mad" insulting, so only a concern
      // we parsed into the profile is reflected back.
      const openingConcern =
        !before.mainConcern && slots.mainConcern && slots.mainConcern.length <= 60
          ? copy.heardConcern(slots.mainConcern)
          : "";
      const prefix = misheard
        ? `${copy.repeat} `
        : learned
          ? `${copy.understood(learned)} `
          : openingConcern
            ? `${openingConcern} `
            : "";
      // Never repeat the transcript back: speech-to-text mistakes ("I'm a man"
      // -> "I am a mad") turn a friendly echo into an insult.
      return NextResponse.json({
        reply: await say(`${prefix}${pending.question}`),
        speech: speakable(spoken, prefix, pending.question),
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
      // Provider unavailable or slow: the deterministic summary above is
      // already correct, and the shopper hears it a lot sooner.
      const explanation = await withBudget(
        provider.explainRecommendations(profile, recommendation, safety),
        2500,
        "",
      );
      if (explanation.trim() && validateAssistantTextForSafety(explanation, safety).recommendationAllowed) {
        spokenReply = `${preface}${shorten(explanation, 420)}`;
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
        step: item.step,
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
 * Caps how long an optional model call may hold up a reply.
 *
 * Every LLM call in a turn is an enrichment — the deterministic backbone
 * already has an answer ready. A slow or retrying provider used to add seconds
 * of dead air before the advisor said anything, so past the budget we simply
 * take the fallback and move on.
 */
function withBudget<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    work
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

/**
 * Splits a reply into the pieces the client should synthesise separately.
 *
 * The trailing question is one of a handful of fixed lines, so on its own it
 * plays from cache the instant it is needed; only the short acknowledgement in
 * front of it has to be generated. Speaking them as one blob meant every turn
 * waited on the speech API for the whole sentence.
 *
 * Skipped when the shopper is speaking a third language, because the reply the
 * client receives is a translation and no longer matches these pieces.
 */
function speakable(spoken: LanguageCode, leadIn: string, question?: string): string[] | undefined {
  if (spoken !== "en" && spoken !== "ar") return undefined;
  if (!question) return undefined;
  const prefix = leadIn.trim();
  return prefix ? [prefix, question] : [question];
}

const HAIR_LABELS: Record<string, string> = {
  shampoo: "shampoo",
  conditioner: "conditioner",
  scalp: "scalp care",
};

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
    // Same hard gate as the face routine, in the other direction: a hair answer
    // is built from hair products, never from a face serum that happens to
    // mention shine.
    .filter((product) => productKind(product) === "hair")
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
      step: routineStep(product),
      slot: HAIR_LABELS[routineStep(product)] ?? "hair & scalp",
      reason: wants.length
        ? `Chosen for the ${wants.slice(0, 2).join(" and ")} you described.`
        : `A ${HAIR_LABELS[routineStep(product)] ?? "hair"} step for what you described.`,
      cautions: ["Patch test before first use.", "Follow the label directions."],
      sponsored: false,
    }));
}

/**
 * A two or three word label for whatever the shopper raised, used to redirect
 * by name ("It sounds like you're asking about a leg pain") rather than with a
 * blanket refusal. Falls back to nothing when no model is configured, and the
 * caller then uses the generic line.
 */
async function summariseTopic(utterance: string, lang: AgentLang): Promise<string> {
  const provider = getLLMProvider();
  if ((provider.lastUsedId ?? provider.id) === "mock") return "";
  try {
    const label = await provider.generateAssistantMessage({
      messages: [
        {
          role: "system",
          content:
            "Reply with a two-to-four word noun phrase naming the topic of the user's message, " +
            "lowercase, no punctuation, no quotes. Examples: \"a leg pain\", \"tomorrow's weather\", " +
            "\"last night's football\". Reply with the phrase only.",
        },
        { role: "user", content: utterance },
      ],
      approvedProducts: [],
      safety: { level: "LOW", reasons: [], recommendationAllowed: true },
    });
    const clean = label.trim().replace(/^["'\u201c]|["'\u201d.]$/g, "").toLowerCase();
    void lang;
    return clean.length > 2 && clean.split(/\s+/).length <= 5 ? clean : "";
  } catch {
    return "";
  }
}

function shorten(text: string, max = 90) {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}
