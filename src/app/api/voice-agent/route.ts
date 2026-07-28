import { NextResponse } from "next/server";
import { z } from "zod";
import { seedTenant } from "@/data/seed-catalog";
import { ESCALATION_MESSAGE, type IntakeProfileInput, type ProductCatalogItem, type SafetyTriage } from "@/domain/skincare";
import { getTenantBySlug, listTenantProducts } from "@/services/catalog";
import { getLLMProvider, UNREADABLE_ANSWER } from "@/services/llm/provider";
import { buildRecommendations, passesHardFilters } from "@/services/recommendation-engine";
import { runSafetyTriage, validateAssistantTextForSafety } from "@/services/safety-triage";
import { areaLabel, areaRoute, type BodyArea } from "@/services/body-area";
import { classifyDistress, distressCopy, reactionTo, REACTION_PROMPT, usableReaction } from "@/services/empathy";
import { soldOutProductIds } from "@/services/stock";
import {
  agentCopy,
  classifyAside,
  classifyOpening,
  detectLang,
  extractSkinType,
  isHairConcern,
  nextQuestion,
  readAdjustment,
  slotsToProfile,
  summariseSlots,
  updateSlots,
  type AgentLang,
  type AgentSlots,
} from "@/services/voice-agent";
import { derivedConcerns, productKind, routineStep } from "@/services/product-taxonomy";
import { detectLanguage, isRtl, localise, type LanguageCode } from "@/services/language";
import { jsonError, parseJson, RequestValidationError } from "../_shared";

export const runtime = "nodejs";

const SlotsSchema = z.object({
  mainConcern: z.string().optional(),
  skinType: z.string().optional(),
  pregnantOrBreastfeeding: z.boolean().optional(),
  allergies: z.array(z.string()).optional(),
  bodyArea: z
    .enum(["face", "neck", "scalp", "hands", "underarms", "elbows-knees", "feet", "intimate", "body"])
    .optional(),
  askedPregnancy: z.boolean().optional(),
  askedAllergies: z.boolean().optional(),
  askedSkinType: z.boolean().optional(),
  askedBodyArea: z.boolean().optional(),
  askedAllergyNames: z.boolean().optional(),
  // Must be listed, or zod strips it from the round trip and the agent forgets
  // it gave up on the skin type — then asks for it again after the next answer.
  skinTypeUnknown: z.boolean().optional(),
  bodyAreaUnknown: z.boolean().optional(),
  misses: z.number().optional(),
  offTopic: z.number().optional(),
  // Without these the conversation resets at the routine: the shopper asks for
  // something stronger, the slots come back without the request, and the same
  // routine is read out again.
  gaveRoutine: z.boolean().optional(),
  lastRoutine: z.array(z.string()).optional(),
  routineShape: z.enum(["simple", "full"]).optional(),
  gentle: z.boolean().optional(),
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

    // SOMEONE IN TROUBLE GETS A HUMAN ANSWER BEFORE ANY OTHER RULE APPLIES.
    //
    // "I have a bullet wound" was answered with "Just to be clear, I only cover
    // skin and hair here" — true, and a horrible thing to say to someone. The
    // clinical triage below never saw it (no pattern in it mentions being shot)
    // and the tangent classifier did exactly what it was built to do. This runs
    // ahead of both: the reply is the same referral either way, but it opens by
    // acknowledging what was actually said.
    const distress = classifyDistress(input.utterance);
    if (distress) {
      return NextResponse.json({
        reply: await say(distressCopy(distress, lang)),
        phase: "referral",
        slots: before,
        products: [],
        safetyLevel: distress === "urgent-care" ? "REFER_CLINIC" : "URGENT",
        language: spoken,
        rtl: isRtl(spoken),
      });
    }

    // SAFETY RUNS FIRST, ON EVERY TURN, BEFORE ANYTHING CAN SHORT-CIRCUIT IT.
    //
    // It used to run last, on the assembled profile. Two ways that failed: an
    // answer fitting no slot was discarded before triage saw it ("I have blue
    // patches"), and the tangent classifier below returned first, so "I feel
    // nauseous" was answered with "I only cover skin and hair here" instead of
    // being escalated. A shopper who says something alarming gets the referral
    // no matter which question happens to be open.
    const turnSafety = runSafetyTriage({
      ...slotsToProfile(before, input.sessionId),
      mainConcern: [before.mainConcern, input.utterance].filter(Boolean).join(". "),
    });
    if (!turnSafety.recommendationAllowed) {
      return NextResponse.json({
        reply: await say(turnSafety.referralMessage ?? copy.noProducts),
        phase: "referral",
        slots: before,
        products: [],
        safetyLevel: turnSafety.level,
        language: spoken,
        rtl: isRtl(spoken),
      });
    }

    // The opening line was never checked against anything: whatever the shopper
    // said first became the main concern, so "I have a leg pain" was answered
    // with "understood — how would you describe your skin?" and "do you sell
    // iphones" became a skin concern. Nothing off-topic is stored.
    if (!before.mainConcern) {
      const opening = classifyOpening(input.utterance);
      if (opening) {
        const leadIn = opening === "elsewhere" ? copy.aside.elsewhere : copy.aside.offtopic;
        return NextResponse.json({
          reply: await say(`${leadIn} ${copy.askConcern}`),
          speech: speakable(spoken, leadIn, copy.askConcern),
          phase: "asking",
          slots: before,
          products: [],
          language: spoken,
          rtl: isRtl(spoken),
        });
      }
    }

    // Greetings, "what are you?", thanks, or a genuine tangent: answer it, then
    // steer back to the question that's still open instead of parsing it as a
    // skin concern or failing to understand.
    // While waiting for the allergen list, whatever they say IS the answer -
    // an ingredient name must never be mistaken for a tangent.
    const awaitingAllergens = Boolean(before.askedAllergyNames) && before.allergies === undefined;
    // "make it stronger" mentions nothing this advisor's vocabulary knows, so
    // once a routine is on screen it read as a tangent and got the off-topic
    // bridge. It is an instruction about the routine, and it is handled below.
    const adjusting = Boolean(before.gaveRoutine) && readAdjustment(input.utterance) !== null;
    const aside = before.mainConcern && !awaitingAllergens && !adjusting ? classifyAside(input.utterance) : null;
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
    // Nothing new was understood from a non-empty answer -> we are about to ask
    // the same question again, so acknowledge the mishearing.
    let misheard =
      Boolean(input.utterance.trim()) && JSON.stringify(before) === JSON.stringify(slots);

    // The patterns could not place this answer. THIS is where the model earns
    // its round trip — and only here, so "oily" or "no" still costs nothing.
    //
    // Regexes will never cover every way a person can say something senseless:
    // "I have horns" was absorbed as a failed skin-type answer and "I am
    // breastfeeding goat" set a safety slot, because both contain words the
    // patterns recognise. A reader that understands the sentence catches what a
    // vocabulary cannot.
    if (misheard) {
      const provider = getLLMProvider();
      const asked = nextQuestion(before, lang)?.question ?? copy.askConcern;
      const reading = await withBudget(
        provider.readAnswer(asked, input.utterance),
        900,
        UNREADABLE_ANSWER,
      );

      // Escalation only ever tightens: the model can raise a concern the
      // patterns missed, never wave one through.
      if (reading.needsClinician) {
        return NextResponse.json({
          reply: await say(ESCALATION_MESSAGE),
          phase: "referral",
          slots: before,
          products: [],
          safetyLevel: "REFER_CLINIC",
          language: spoken,
          rtl: isRtl(spoken),
        });
      }

      // A skin type it read plainly is worth keeping; it only sharpens ranking.
      if (reading.skinType && !slots.skinType) {
        slots = { ...slots, skinType: reading.skinType, misses: 0 };
        misheard = false;
      } else if (!reading.makesSense || !reading.onTopic) {
        const leadIn = reading.onTopic ? copy.didNotFollow : copy.aside.offtopic;
        const question = nextQuestion(slots, lang);
        return NextResponse.json({
          reply: await say(question ? `${leadIn} ${question.question}` : leadIn),
          speech: speakable(spoken, leadIn, question?.question),
          phase: "asking",
          slots: question?.slots ?? slots,
          products: [],
          language: spoken,
          rtl: isRtl(spoken),
        });
      }
    }

    // Intimate skin never reaches the product engine. Asked about often and
    // answered badly everywhere, so the reply says so plainly, without
    // embarrassment, and sends them to someone who can actually look.
    if (slots.bodyArea === "intimate") {
      return NextResponse.json({
        reply: await say(copy.intimateArea),
        phase: "referral",
        slots,
        products: [],
        safetyLevel: "REFER_CLINIC",
        language: spoken,
        rtl: isRtl(spoken),
      });
    }

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
      // React to what was said before asking the next thing. "I have a rash"
      // used to be met with a flat "Got it." and a question about whether the
      // shopper's skin is oily; a person would have said they were sorry first.
      const reaction = misheard ? "" : await empathise(input.utterance, lang, !before.mainConcern);
      const acknowledgement = learned ? copy.understood(learned) : openingConcern;
      const leadIn = misheard
        ? copy.repeat
        : [reaction, reaction && !learned ? "" : acknowledgement].filter(Boolean).join(" ");
      const prefix = leadIn ? `${leadIn} ` : "";
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
    const where = areaRoute(slots.bodyArea);

    // Hair and scalp concerns don't fit the face-routine slot model, so match
    // them directly against the catalogue instead of building an AM/PM routine.
    // If the merchant stocks nothing suitable we say so rather than selling a
    // face routine for dandruff.
    if (where === "hair" || isHairConcern(slots.mainConcern ?? "")) {
      const hairMatches = await inStockOnly(
        pickHairProducts(products, slots.mainConcern ?? "", profile, tenant.id, safety),
      );
      return NextResponse.json({
        reply: await say(hairMatches.length ? copy.result(hairMatches.length) : copy.noHairProducts),
        phase: hairMatches.length ? "result" : "referral",
        slots: { ...slots, gaveRoutine: true, lastRoutine: hairMatches.map((match) => match.id) },
        safetyLevel: safety.level,
        language: spoken,
        rtl: isRtl(spoken),
        products: hairMatches,
      });
    }

    // Knuckles, elbows, underarms, feet. A face routine is the wrong answer
    // here and saying so is better than selling one: the products are formulated
    // for facial skin, and body skin is thicker and behaves differently.
    if (where === "body") {
      const area = areaLabel(slots.bodyArea as BodyArea, lang);
      const bodyMatches = await inStockOnly(
        pickBodyProducts(products, slots.mainConcern ?? "", profile, tenant.id, safety),
      );
      return NextResponse.json({
        reply: await say(
          bodyMatches.length ? copy.bodyResult(bodyMatches.length, area) : copy.noBodyProducts(area),
        ),
        phase: bodyMatches.length ? "result" : "referral",
        slots: { ...slots, gaveRoutine: true, lastRoutine: bodyMatches.map((match) => match.id) },
        safetyLevel: safety.level,
        language: spoken,
        rtl: isRtl(spoken),
        products: bodyMatches,
      });
    }

    const recommendation = await inStockRoutine({
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

    const count = recommendation.items.length;
    const routineIds = recommendation.items.map((item) => item.product.id);

    // Did anything we just did actually change what they are looking at? The
    // routine that was on screen is carried in the slots, so this is an exact
    // comparison rather than a guess — and it is what stops the advisor reading
    // the identical sentence out a second time.
    const sameAsBefore =
      Boolean(before.gaveRoutine) &&
      before.lastRoutine?.length === routineIds.length &&
      before.lastRoutine.every((id, index) => id === routineIds[index]);

    // Which adjustment, if any, this turn applied.
    const adjusted: "fuller" | "simpler" | "gentler" | null = !before.gaveRoutine
      ? null
      : Boolean(slots.gentle) && !before.gentle
        ? "gentler"
        : slots.routineShape !== before.routineShape
          ? slots.routineShape === "full"
            ? "fuller"
            : "simpler"
          : null;

    // Let the model phrase the result, but re-run the safety gate over whatever
    // it produced and fall back to fixed copy if it drifts.
    const provider = getLLMProvider();
    // If the shopper volunteered everything up front we never asked a question,
    // so restate what was understood before recommending - otherwise jumping
    // straight to products reads as if it ignored them.
    const understood = summariseSlots(slots, lang);
    const skippedAhead = !before.askedSkinType && !before.askedPregnancy && !before.askedAllergies;
    // An allergy just named is the one thing that has to be repeated back.
    // "yes salicylic acid" went straight to "here's your routine", which gives
    // the shopper no way of knowing it was heard — and it is precisely the
    // answer they need to know was heard.
    const namedAllergies = before.allergies === undefined && slots.allergies?.length ? slots.allergies : null;
    const preface = namedAllergies
      ? `${copy.avoiding(namedAllergies)} `
      : skippedAhead && understood
        ? `${copy.understood(understood)} `
        : "";

    let spokenReply: string;
    if (sameAsBefore) {
      // Nothing moved. Say so, instead of replaying the same line at them.
      spokenReply = adjusted === "fuller" ? copy.nothingStronger : copy.sameAgain(count);
    } else if (adjusted) {
      // Name the change. "Here's a simple routine with 4 products" after a
      // request for something stronger reads as if nobody was listening.
      spokenReply =
        adjusted === "fuller" && before.gentle
          ? copy.adjusted.fullerAfterGentle(count)
          : copy.adjusted[adjusted](count);
    } else {
      spokenReply = `${preface}${copy.result(count)}`;
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
    }

    return NextResponse.json({
      reply: await say(spokenReply),
      phase: "result",
      slots: { ...slots, gaveRoutine: true, lastRoutine: routineIds },
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
        expectedResults: item.expectedResults,
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
 * A routine containing nothing the storefront refuses to sell.
 *
 * A shopper reached checkout with a cleanser the shop then removed from their
 * cart as SOLD OUT. The catalogue's `inStock` flag was not wrong so much as
 * old — it is written at sync time and the merchant sells out between syncs.
 *
 * Sold-out items are excluded and the routine is REBUILT rather than trimmed,
 * so the next-best cleanser takes the missing cleanser's place instead of the
 * shopper being handed a routine with no cleanser in it. Bounded to three
 * attempts; the availability lookups are cached, so the later passes are
 * usually free.
 */
async function inStockRoutine(base: Parameters<typeof buildRecommendations>[0]) {
  const excluded = new Set<string>();
  let routine = buildRecommendations(base);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!routine.items.length) break;
    const soldOut = await soldOutProductIds(
      routine.items.map((item) => ({ id: item.product.id, url: item.product.url })),
    );
    if (!soldOut.size) break;
    soldOut.forEach((id) => excluded.add(id));
    routine = buildRecommendations({ ...base, excludeProductIds: excluded });
  }

  return routine;
}

/** The same check for the hair and body lists, which are picked, not built. */
async function inStockOnly<T extends { id: string; url: string }>(picks: T[]): Promise<T[]> {
  if (!picks.length) return picks;
  const soldOut = await soldOutProductIds(picks);
  return soldOut.size ? picks.filter((pick) => !soldOut.has(pick.id)) : picks;
}

/**
 * The sentence a person would say before getting on with the question.
 *
 * The deterministic reaction covers the cases worth being sure about — pain,
 * frustration, embarrassment, worry — and returns nothing when the utterance
 * carries no feeling, because inventing sympathy for "I want a glow routine"
 * is worse than saying "Got it.".
 *
 * When a model is configured it gets one attempt at something better, on the
 * opening turn only: that is where warmth is worth a round trip, and later
 * turns are one-word answers with no feeling in them. Whatever it writes is
 * checked for questions, advice, products and diagnoses before it is used.
 */
async function empathise(utterance: string, lang: AgentLang, opening: boolean): Promise<string> {
  const deterministic = reactionTo(utterance, lang);
  if (deterministic) return deterministic;
  // English only: the models are not prompted in Arabic, and the authored
  // Arabic reactions above already cover the cases that matter.
  if (!opening || lang !== "en" || utterance.trim().split(/\s+/).length < 3) return "";

  const provider = getLLMProvider();
  if ((provider.lastUsedId ?? provider.id) === "mock") return "";

  const safe = { level: "LOW" as const, reasons: [], recommendationAllowed: true };
  const written = await withBudget(
    provider.generateAssistantMessage({
      messages: [
        { role: "system", content: REACTION_PROMPT },
        { role: "user", content: utterance },
      ],
      approvedProducts: [],
      safety: safe,
    }),
    1200,
    "",
  );

  const reaction = usableReaction(written);
  if (!reaction) return "";
  return validateAssistantTextForSafety(reaction, safe).recommendationAllowed ? reaction : "";
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

const BODY_LABELS: Record<string, string> = {
  cleanser: "wash",
  moisturizer: "moisturiser",
  sunscreen: "sunscreen",
  exfoliant: "weekly exfoliant",
  treatment: "targeted step",
};

/**
 * Body, hand and foot matching.
 *
 * A dark-knuckles or rough-elbows question used to be answered with a facial
 * routine, because a face routine was the only thing the agent could build.
 * Body skin is thicker and tolerates different things, and the products made
 * for it are a different part of the catalogue — so this reads that part, under
 * the same hard safety filters as everything else.
 *
 * The reasons stay cosmetic. "Evens tone" is a claim about how skin looks;
 * "lightens" and "whitens" are claims this advisor does not make.
 */
function pickBodyProducts(
  products: ProductCatalogItem[],
  concern: string,
  profile: IntakeProfileInput,
  tenantId: string,
  safety: SafetyTriage,
) {
  const text = concern.toLowerCase();
  const wants = [
    { term: "dark spots", match: /dark|pigment|discolou?r|uneven|tone|melasma/ },
    { term: "dryness", match: /dry|crack|flak|peel|rough|scal/ },
    { term: "texture", match: /texture|bump|smooth|thick|callus|ingrown/ },
    { term: "redness", match: /red|irritat|itch|rash|sensitiv|chaf/ },
  ]
    .filter((entry) => entry.match.test(text))
    .map((entry) => entry.term);

  return products
    .filter((product) => passesHardFilters(product, profile, tenantId, safety))
    .filter((product) => productKind(product) === "body")
    .map((product) => {
      const tags = [...product.concernsJson, ...derivedConcerns(product)].map((tag) => tag.toLowerCase());
      const haystack = `${product.name} ${product.category} ${product.description}`.toLowerCase();
      const specific = wants.filter((want) => tags.includes(want) || haystack.includes(want)).length;
      return { product, score: specific * 10 + product.merchantPriority / 100 };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(({ product }) => {
      const step = routineStep(product);
      return {
        id: product.id,
        name: product.name,
        brand: product.brand,
        category: product.category,
        price: product.price,
        currency: product.currency,
        imageUrl: product.imageUrl ?? null,
        url: product.url,
        step,
        slot: BODY_LABELS[step] ?? "body care",
        reason: wants.length
          ? `Chosen for the ${wants.slice(0, 2).join(" and ")} you described.`
          : "A gentle body step for what you described.",
        expectedResults:
          "Body skin is slower than facial skin — most people give this six to eight weeks of daily use before judging it.",
        cautions: [
          "Patch test on a small area before first use.",
          "Stop use if severe irritation occurs.",
          "Follow the label directions.",
        ],
        sponsored: false,
      };
    });
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
