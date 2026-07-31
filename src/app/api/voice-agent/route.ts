import { NextResponse } from "next/server";
import { z } from "zod";
import { seedTenant } from "@/data/seed-catalog";
import { ESCALATION_MESSAGE, type IntakeProfileInput, type ProductCatalogItem, type SafetyTriage } from "@/domain/skincare";
import { getTenantBySlug, listTenantProducts } from "@/services/catalog";
import { getLLMProvider, UNREADABLE_ANSWER } from "@/services/llm/provider";
import { buildRecommendations, passesHardFilters } from "@/services/recommendation-engine";
import { runSafetyTriage, validateAssistantTextForSafety } from "@/services/safety-triage";
import { areaLabel, areaRoute, type BodyArea } from "@/services/body-area";
import {
  classifyDistress,
  distressCopy,
  reactionTo,
  readsSorrow,
  REACTION_PROMPT,
  sorrowCopy,
  sorrowLead,
  usableReaction,
} from "@/services/empathy";
import { soldOutProductIds } from "@/services/stock";
import { childCopy, isChild, readsAge } from "@/services/audience";
import {
  agentCopy,
  beginConcern,
  classifyAside,
  classifyOpening,
  detectLang,
  extractSkinType,
  findProductByQuery,
  isHairConcern,
  mentionsSkinOrHair,
  nextQuestion,
  readProductQuery,
  readAdjustment,
  readFollowup,
  nameMatchesBrandToken,
  readNewConcern,
  readOriginPreference,
  readsDone,
  readsMicCheck,
  readsMore,
  readsStillThere,
  slotsToProfile,
  summariseSlots,
  updateSlots,
  type AgentLang,
  type AgentSlots,
} from "@/services/voice-agent";
import { derivedConcerns, productFamily, productKind, routineStep, type RoutineStep } from "@/services/product-taxonomy";
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
  dislikedIds: z.array(z.string()).optional(),
  ageYears: z.number().optional(),
  forSomeoneElse: z.boolean().optional(),
  sawPhoto: z.boolean().optional(),
  awaitingConcern: z.boolean().optional(),
  pinnedIds: z.array(z.string()).optional(),
  dislikedBrands: z.array(z.string()).optional(),
  preferredOrigin: z.enum(["korean", "french"]).optional(),
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

    // BAD NEWS THAT IS NOT AN EMERGENCY.
    //
    // "My dog died" was answered "That one's outside my world, I'm afraid —
    // skin and hair are what I know." Every word of that is true and all of it
    // is horrible. Grief is not a tangent to be redirected; it is a sentence to
    // be answered. Unlike distress this does not end the session — the open
    // question still follows, so a shopper who wants to carry on can.
    // Only when the bad news is ALL they said. "I have scars after the accident"
    // is bad news and a question we can answer, and diverting it would be its
    // own kind of not listening — that one gets a short condolence in front of
    // the ordinary flow instead, further down.
    const sorrow = readsSorrow(input.utterance);
    if (sorrow && !mentionsSkinOrHair(input.utterance)) {
      const pendingSorrow = nextQuestion(before, lang);
      const leadIn = sorrowCopy(sorrow, lang);
      const question = pendingSorrow?.question;
      return NextResponse.json({
        reply: await say(question ? `${leadIn} ${question}` : leadIn),
        speech: speakable(spoken, leadIn, question),
        phase: "asking",
        slots: pendingSorrow?.slots ?? before,
        products: [],
        language: spoken,
        rtl: isRtl(spoken),
      });
    }

    // Once a child's age is known it holds for the rest of the session. Without
    // this, every later turn fell through to the generic clinical referral —
    // a shopper who answered "no" twice got a wall of text about breathing
    // difficulties instead of the answer they had already been given.
    if (isChild(before.ageYears)) {
      return NextResponse.json({
        reply: await say(childCopy(before.ageYears!, lang, Boolean(before.forSomeoneElse))),
        phase: "referral",
        slots: before,
        products: [],
        safetyLevel: "REFER_CLINIC",
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
      // "Hello can you hear me" is a person checking the microphone works —
      // it got the off-topic brush-off, which reads as a machine failing a
      // human test. Confirm warmly, then ask.
      if (readsMicCheck(input.utterance)) {
        return NextResponse.json({
          reply: await say(`${copy.aside.hearing} ${copy.askConcern}`),
          speech: speakable(spoken, copy.aside.hearing, copy.askConcern),
          phase: "asking",
          slots: before,
          products: [],
          language: spoken,
          rtl: isRtl(spoken),
        });
      }
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
    // Same trap as the allergen list, and it swallowed the answer to the
    // question this release added: "on my hands" contains no word the skin
    // vocabulary knows, so asking "whereabouts is it?" and being told "on my
    // hands" produced "That one's outside my world, I'm afraid." Whatever is
    // said while a question is open is an answer to that question.
    const awaitingArea = Boolean(before.askedBodyArea) && !before.bodyArea && !before.bodyAreaUnknown;
    // "make it stronger" mentions nothing this advisor's vocabulary knows, so
    // once a routine is on screen it read as a tangent and got the off-topic
    // bridge. It is an instruction about the routine, and it is handled below.
    const adjusting = Boolean(before.gaveRoutine) && readAdjustment(input.utterance) !== null;
    // "She's four years old" mentions nothing in the skin vocabulary, so the
    // tangent classifier took it — the single most important fact in that
    // conversation, discarded as small talk.
    const statesAge = readsAge(input.utterance) !== undefined;
    // "swap something" and "why?" name nothing in the skin vocabulary, so the
    // tangent classifier claimed them — the same trap as the allergen list and
    // the body-area answer before them.
    const followup = before.gaveRoutine ? readFollowup(input.utterance) : null;
    // A NEW concern outranks every routine follow-up. "I want to add more for
    // my acne", said over a dandruff routine, contains "add more" — the
    // adjustment reader claimed it and rebuilt the same three hair products
    // while the acne went unheard. A concern that is not part of the current
    // one starts a fresh interview (keeping everything known about the person);
    // after "anything else?" was answered yes, the next utterance IS the new
    // concern whatever words it uses.
    const routineSettled = Boolean(before.gaveRoutine) && !nextQuestion(before, lang);
    const done = (routineSettled || Boolean(before.awaitingConcern)) && readsDone(input.utterance);
    const wantsMore = routineSettled && !before.awaitingConcern && readsMore(input.utterance);
    const newConcern = done
      ? null
      : (routineSettled ? readNewConcern(input.utterance, before.mainConcern) : null) ??
        (before.awaitingConcern && !classifyOpening(input.utterance) ? input.utterance.trim() || null : null);
    // "Do you have any hair serum?" — asked three ways in one live session and
    // answered, all three times, by re-reading the same routine. And "Do you
    // have a Miley hair oil" as the very FIRST words was swallowed into the
    // interview as if it were a concern. A question about a product gets an
    // answer about that product, at any point in the conversation. Shape only
    // here; the handler below acts only when the catalogue actually matches.
    // Never while the allergen list or the body-area answer is open: "what
    // about my hands" is an answer to the question, not a shopping query.
    const productQuery =
      !done && !wantsMore && !newConcern && !adjusting && !awaitingAllergens && !awaitingArea
        ? readProductQuery(input.utterance)
        : null;
    // "It's still there" is a complaint about the routine, not a tangent —
    // it got "outside my world" at the exact moment trust needed repairing.
    const grievance = routineSettled && !newConcern && readsStillThere(input.utterance);
    const originPref = !newConcern ? readOriginPreference(input.utterance) : undefined;
    const aside =
      before.mainConcern &&
      !awaitingAllergens &&
      !awaitingArea &&
      !adjusting &&
      !statesAge &&
      !followup &&
      !done &&
      !wantsMore &&
      !newConcern &&
      !productQuery &&
      !grievance &&
      !originPref
        ? classifyAside(input.utterance)
        : null;

    // "No, that's everything" closes the visit warmly instead of bouncing off
    // the tangent classifier; a bare "yes" opens the floor for the next thing.
    if (done) {
      return NextResponse.json({
        reply: await say(copy.wrapUp),
        speech: speakable(spoken, "", copy.wrapUp),
        phase: "farewell",
        slots: { ...before, awaitingConcern: undefined },
        products: [],
        language: spoken,
        rtl: isRtl(spoken),
      });
    }
    if (wantsMore) {
      return NextResponse.json({
        reply: await say(copy.whatElse),
        speech: speakable(spoken, "", copy.whatElse),
        phase: "asking",
        slots: { ...before, awaitingConcern: true },
        products: [],
        language: spoken,
        rtl: isRtl(spoken),
      });
    }
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
        const topic = await withBudget(summariseTopic(input.utterance, lang), READING_BUDGET_MS, "");
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

    // A CHALLENGE TO THE ROUTINE IS A CONVERSATION, NOT A TANGENT.
    //
    // "Why that one?" is answered with the actual reasoning behind the pick,
    // "I don't like it" swaps the product for the next-best that clears the
    // same checks, and "do you have any hair serum?" is answered about that
    // product — found and swapped in, sold out, or honestly not stocked. All
    // of these used to bounce: the first two off the tangent classifier, the
    // last into a verbatim re-read of the routine. A new concern outranks
    // every one of them: that sentence is about the new thing.
    if ((followup || productQuery || grievance || originPref) && !newConcern) {
      const tenantF = await getTenantBySlug(input.tenantSlug);
      if (tenantF) {
        const profileF = slotsToProfile(before, input.sessionId);
        const safetyF = runSafetyTriage(profileF);
        const productsF = await listTenantProducts(input.tenantSlug);
        const disliked = new Set(before.dislikedIds ?? []);
        // The routine being argued with must be rebuilt by the SAME builder
        // that produced it. This always used the face builder, so a hair
        // shopper saying "I don't like the oil" was matched against a face
        // routine with no oil in it — and asked "which one?" with examples
        // ('the cleanser', 'the serum') from steps that were never on their
        // screen.
        const hairF = areaRoute(before.bodyArea) === "hair" || isHairConcern(before.mainConcern ?? "");
        const bodyF = areaRoute(before.bodyArea) === "body";
        const build = (
          exclude: Set<string>,
          pins: string[] | undefined = before.pinnedIds,
          brands: string[] | undefined = before.dislikedBrands,
          // Defaults to the STANDING preference: `current` must mirror the
          // screen the shopper is looking at. A preference stated THIS turn
          // is passed explicitly by the branches that apply it.
          origin: "korean" | "french" | undefined = before.preferredOrigin,
        ): ReturnType<typeof routineItemToProduct>[] => {
          const available = productsF.filter(
            (product) =>
              !exclude.has(product.id) &&
              !blockedByBrand(product.name, brands) &&
              (!origin || product.originBucket === origin),
          );
          const built = hairF
            ? pickHairProducts(available, before.mainConcern ?? "", profileF, tenantF.id, safetyF)
            : bodyF
              ? pickBodyProducts(available, before.mainConcern ?? "", profileF, tenantF.id, safetyF)
              : buildRecommendations({
                  tenantId: tenantF.id,
                  profile: profileF,
                  safety: safetyF,
                  products: available,
                  sponsoredEnabled: true,
                }).items.map(routineItemToProduct);
          return applyPins(built, pins, productsF, profileF, tenantF.id, safetyF);
        };
        // A NAMED PRODUCT OUTRANKS THE SWAP READING OF THE SAME SENTENCE —
        // but only when the catalogue actually matches; "do you have
        // something else" still falls through to the swap flow below.
        if (productQuery) {
          const match = findProductByQuery(productsF, productQuery);
          // Asked before any routine exists — the opening line, or while a
          // safety question is open. Answer it, keep the product, and get on
          // with the interview that decides what goes around it.
          if (match && !before.gaveRoutine) {
            const soldOutEarly = await soldOutProductIds([{ id: match.id, url: match.url }], STOCK_BUDGET_MS);
            const pendingEarly = nextQuestion(before, lang);
            const question = pendingEarly?.question ?? copy.askConcern;
            if (soldOutEarly.has(match.id)) {
              return NextResponse.json({
                reply: await say(`${copy.productSoldOut(match.name)} ${question}`),
                speech: speakable(spoken, copy.productSoldOut(match.name), question),
                phase: "asking",
                slots: pendingEarly?.slots ?? before,
                products: [],
                language: spoken,
                rtl: isRtl(spoken),
              });
            }
            if (!passesHardFilters(match, profileF, tenantF.id, safetyF)) {
              return NextResponse.json({
                reply: await say(`${copy.productBlocked(match.name)} ${question}`),
                speech: speakable(spoken, copy.productBlocked(match.name), question),
                phase: "asking",
                slots: pendingEarly?.slots ?? before,
                products: [],
                language: spoken,
                rtl: isRtl(spoken),
              });
            }
            const pinnedEarly = [...(before.pinnedIds ?? []).filter((id) => id !== match.id), match.id];
            return NextResponse.json({
              reply: await say(`${copy.productHere(match.name)} ${question}`),
              speech: speakable(spoken, copy.productHere(match.name), question),
              phase: "asking",
              slots: { ...(pendingEarly?.slots ?? before), pinnedIds: pinnedEarly },
              products: [pinnedItem(match)],
              language: spoken,
              rtl: isRtl(spoken),
            });
          }
          if (match) {
            const current = build(disliked);
            const already = current.find((item) => item.id === match.id);
            if (already) {
              // It's on their screen. Defend it rather than re-adding it.
              return NextResponse.json({
                reply: await say(copy.whyThis(already.name, already.reason, already.expectedResults)),
                phase: "result",
                slots: before,
                products: [],
                language: spoken,
                rtl: isRtl(spoken),
              });
            }
            const soldOut = await soldOutProductIds([{ id: match.id, url: match.url }], STOCK_BUDGET_MS);
            if (soldOut.has(match.id)) {
              return NextResponse.json({
                reply: await say(copy.productSoldOut(match.name)),
                phase: "result",
                slots: before,
                products: [],
                language: spoken,
                rtl: isRtl(spoken),
              });
            }
            if (!passesHardFilters(match, profileF, tenantF.id, safetyF)) {
              return NextResponse.json({
                reply: await say(copy.productBlocked(match.name)),
                phase: "result",
                slots: before,
                products: [],
                language: spoken,
                rtl: isRtl(spoken),
              });
            }
            const pinned = [...(before.pinnedIds ?? []).filter((id) => id !== match.id), match.id];
            const replaced = current.find(
              (item) => item.step === routineStep(match) && item.id !== match.id,
            );
            const rebuilt = await inStockOnly(build(disliked, pinned));
            return NextResponse.json({
              reply: await say(
                replaced
                  ? copy.productSwappedIn(match.name, replaced.name)
                  : copy.productAdded(match.name, slotLabelFor(routineStep(match))),
              ),
              phase: "result",
              slots: { ...before, pinnedIds: pinned, lastRoutine: rebuilt.map((item) => item.id) },
              products: rebuilt,
              language: spoken,
              rtl: isRtl(spoken),
            });
          }
          if (!followup) {
            // Before a routine exists the interview still has somewhere to go:
            // answer honestly, then carry on with the open question.
            const pendingMiss = before.gaveRoutine ? null : nextQuestion(before, lang);
            return NextResponse.json({
              reply: await say(
                pendingMiss ? `${copy.productNotStocked} ${pendingMiss.question}` : copy.productNotStocked,
              ),
              speech: pendingMiss
                ? speakable(spoken, copy.productNotStocked, pendingMiss.question)
                : speakable(spoken, "", copy.productNotStocked),
              phase: pendingMiss ? "asking" : "result",
              slots: pendingMiss?.slots ?? before,
              products: [],
              language: spoken,
              rtl: isRtl(spoken),
            });
          }
        }

        // The debate is about the routine ON SCREEN — the stock filter has
        // already hidden what cannot be bought, and matching a dislike
        // against an invisible product produced a refusal about a product
        // the shopper had never seen.
        const current = followup || grievance ? await inStockOnly(build(disliked)) : [];

        // "IT'S STILL THERE." The shopper says the routine still holds what
        // they rejected. Believe them: re-read the sentence for a brand or
        // product word, apply every exclusion again, and answer with either
        // the apology and the fix, or proof that the screen is clean.
        if (grievance) {
          const complaint = readBrandComplaint(input.utterance, current, false);
          // "On the website I can still see Ordinary Multipeptide Hair
          // Serum" is not about the routine — it names a product the store
          // sells and the advisor refused to use. Find it and use it.
          if (!complaint) {
            const namedTokens = input.utterance
              .toLowerCase()
              .split(/[^a-z0-9\u0600-\u06ff]+/)
              .filter((token) => token.length >= 4 && !BRAND_COMPLAINT_STOPWORDS.has(token));
            const named = namedTokens.length ? findProductByQuery(productsF, namedTokens) : null;
            if (
              named &&
              !current.some((item) => item.id === named.id) &&
              passesHardFilters(named, profileF, tenantF.id, safetyF)
            ) {
              const soldOutNamed = await soldOutProductIds([{ id: named.id, url: named.url }], STOCK_BUDGET_MS);
              if (!soldOutNamed.has(named.id)) {
                const pinnedNow = [...(before.pinnedIds ?? []).filter((id) => id !== named.id), named.id];
                const replacedNow = current.find(
                  (item) => item.step === routineStep(named) && item.id !== named.id,
                );
                const rebuiltNow = await inStockOnly(build(disliked, pinnedNow));
                return NextResponse.json({
                  reply: await say(
                    replacedNow
                      ? copy.productSwappedIn(named.name, replacedNow.name)
                      : copy.productAdded(named.name, slotLabelFor(routineStep(named))),
                  ),
                  phase: "result",
                  slots: { ...before, pinnedIds: pinnedNow, lastRoutine: rebuiltNow.map((item) => item.id) },
                  products: rebuiltNow,
                  language: spoken,
                  rtl: isRtl(spoken),
                });
              }
            }
          }
          let brands = before.dislikedBrands;
          if (complaint) {
            brands = [...(brands ?? []).filter((token) => token !== complaint.token), complaint.token];
            complaint.hits.forEach((hit) => disliked.add(hit.id));
          }
          const rebuilt = await inStockOnly(build(disliked, before.pinnedIds, brands));
          const ids = rebuilt.map((item) => item.id);
          const unchanged =
            before.lastRoutine?.length === ids.length && before.lastRoutine.every((id, index) => id === ids[index]);
          const line = unchanged ? copy.checkedClean : copy.youAreRight;
          return NextResponse.json({
            reply: await say(line),
            speech: speakable(spoken, "", line),
            phase: "result",
            slots: {
              ...before,
              dislikedIds: disliked.size ? [...disliked] : before.dislikedIds,
              dislikedBrands: brands,
              lastRoutine: unchanged ? before.lastRoutine : ids,
            },
            products: unchanged ? [] : rebuilt,
            language: spoken,
            rtl: isRtl(spoken),
          });
        }

        // "ONLY KOREAN BRANDS PLEASE" — a standing preference. The registry
        // knows each product's origin; from here every rebuild honours it.
        if (originPref && !followup) {
          const rebuilt = await inStockOnly(build(disliked, before.pinnedIds, before.dislikedBrands, originPref));
          return NextResponse.json({
            reply: await say(rebuilt.length ? copy.originOnly(originPref) : copy.noProducts),
            speech: rebuilt.length ? speakable(spoken, "", copy.originOnly(originPref)) : undefined,
            phase: "result",
            slots: {
              ...before,
              preferredOrigin: originPref,
              lastRoutine: rebuilt.length ? rebuilt.map((item) => item.id) : before.lastRoutine,
            },
            products: rebuilt,
            language: spoken,
            rtl: isRtl(spoken),
          });
        }

        if (followup && current.length) {
          // A rejected BRAND leaves whole. "I don't like laroche, only Korean
          // brands" used to swap ONE product — for another La Roche-Posay.
          if (followup === "swap") {
            const complaint = readBrandComplaint(input.utterance, current, true);
            if (complaint) {
              const brands = [
                ...(before.dislikedBrands ?? []).filter((token) => token !== complaint.token),
                complaint.token,
              ];
              complaint.hits.forEach((hit) => disliked.add(hit.id));
              const rebuilt = await inStockOnly(
                build(disliked, before.pinnedIds, brands, originPref ?? before.preferredOrigin),
              );
              return NextResponse.json({
                reply: await say(copy.brandDropped),
                speech: speakable(spoken, "", copy.brandDropped),
                phase: "result",
                slots: {
                  ...before,
                  dislikedIds: [...disliked],
                  dislikedBrands: brands,
                  ...(originPref ? { preferredOrigin: originPref } : {}),
                  lastRoutine: rebuilt.map((item) => item.id),
                },
                products: rebuilt,
                language: spoken,
                rtl: isRtl(spoken),
              });
            }
          }
          const target = matchRoutineItem(input.utterance, current);

          if (followup === "why") {
            const reply = target
              ? copy.whyThis(target.name, target.reason, target.expectedResults)
              : copy.whyAll(current.slice(0, 3).map((item) => `${item.slot} — ${item.reason}`).join(" "));
            return NextResponse.json({
              reply: await say(reply),
              phase: "result",
              slots: before,
              products: [],
              language: spoken,
              rtl: isRtl(spoken),
            });
          }

          if (!target) {
            const whichLine = copy.whichSwap(current.map((item) => item.slot));
            return NextResponse.json({
              reply: await say(whichLine),
              speech: speakable(spoken, "", whichLine),
              phase: "result",
              slots: before,
              products: [],
              language: spoken,
              rtl: isRtl(spoken),
            });
          }

          disliked.add(target.id);
          // A disliked product loses its pin: asked-for-by-name ends the
          // moment they say they don't want it.
          const pinsAfter = (before.pinnedIds ?? []).filter((id) => id !== target.id);
          const rebuiltAll = build(disliked, pinsAfter);
          const rebuilt = await inStockOnly(rebuiltAll);
          const replacement = rebuilt.find((item) => item.step === target.step && item.id !== target.id);
          if (!replacement) {
            // The dislike is NOT persisted: excluding the only product that
            // fits would silently drop the step from every later rebuild.
            // And the refusal tells the truth: an alternative that exists but
            // is out of stock is a different sentence from "there is nothing".
            const hadAlternative = rebuiltAll.some(
              (item) => item.step === target.step && item.id !== target.id,
            );
            return NextResponse.json({
              reply: await say(hadAlternative ? copy.swapSoldOut : copy.swapNone),
              phase: "result",
              slots: before,
              products: [],
              language: spoken,
              rtl: isRtl(spoken),
            });
          }
          return NextResponse.json({
            reply: await say(copy.swapped(target.name, replacement.name)),
            phase: "result",
            slots: {
              ...before,
              dislikedIds: [...disliked],
              pinnedIds: pinsAfter.length ? pinsAfter : undefined,
              lastRoutine: rebuilt.map((item) => item.id),
            },
            products: rebuilt,
            language: spoken,
            rtl: isRtl(spoken),
          });
        }
      }
    }

    // A topic switch bypasses the answer-parsing entirely: the utterance is not
    // an answer to any open question, it is the opening line of the next one.
    let slots: AgentSlots = newConcern
      ? beginConcern(before, newConcern)
      : updateSlots(before, input.utterance, lang);

    // When a real model is configured, let it read anything the deterministic
    // patterns missed - but only for non-safety slots. Pregnancy and allergies
    // stay with the explicit parser so a model can never assert them.
    //
    // Only on the opening description. Later turns are short answers ("yes",
    // "oily") that the patterns already handle, and calling the model on every
    // one of them added a round trip per turn for nothing.
    //
    // It runs alongside the empathy call rather than before it. Both are opening
    // -turn enrichments of the same sentence and neither needs the other's
    // answer, so waiting for one and then the other doubled the pause on the
    // very first thing the shopper says.
    const firstDescription = !before.mainConcern && Boolean(slots.mainConcern);
    const [intake, openingReaction] = await Promise.all([
      RICH_REPLIES && firstDescription && !slots.skinType
        ? withBudget(
            getLLMProvider().summarizeIntake([{ role: "user", content: input.utterance }]),
            READING_BUDGET_MS,
            null,
          )
        : Promise.resolve(null),
      empathise(input.utterance, lang, firstDescription),
    ]);
    if (firstDescription && !slots.skinType) {
      const guess = typeof intake?.skinType === "string" ? extractSkinType(intake.skinType) : undefined;
      if (guess) slots = { ...slots, skinType: guess };
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
        READING_BUDGET_MS,
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

    // A CHILD'S AGE STOPS THE SALE.
    //
    // "My neighbor's daughter has dandruff" / "She's four years old" ended with
    // the four-year-old treated as a tangent and the routine built anyway. The
    // triage has always had an under-18 rule, and nothing ever gave it an age,
    // so it could not fire. This is that rule, reachable.
    if (isChild(slots.ageYears)) {
      return NextResponse.json({
        reply: await say(childCopy(slots.ageYears!, lang, Boolean(slots.forSomeoneElse))),
        phase: "referral",
        slots,
        products: [],
        safetyLevel: "REFER_CLINIC",
        language: spoken,
        rtl: isRtl(spoken),
      });
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
      // we parsed into the profile is reflected back. An opening that names
      // TWO concerns ("hair dandruff and acne on my face") is told the plan —
      // one at a time, hair first — or the second one sounds ignored and the
      // shopper repeats themselves at the safety question.
      const dualOpening =
        !before.mainConcern &&
        Boolean(slots.mainConcern) &&
        isHairConcern(slots.mainConcern ?? "") &&
        FACE_CONCERN.test(slots.mainConcern ?? "");
      const openingConcern = dualOpening
        ? copy.twoThings
        : !before.mainConcern && slots.mainConcern && slots.mainConcern.length <= 60
          ? copy.heardConcern()
          : "";
      // React to what was said before asking the next thing. "I have a rash"
      // used to be met with a flat "Got it." and a question about whether the
      // shopper's skin is oily; a person would have said they were sorry first.
      // A condolence outranks the ordinary reaction: somebody who mentioned a
      // bereavement or an accident alongside their concern should hear that
      // first, not "Got it."
      // A switched concern gets its own welcome; the shopper just heard the
      // routine and is asking about the next thing, not repeating themselves.
      const reaction = misheard ? "" : newConcern ? copy.nextConcern : sorrow ? sorrowLead(sorrow, lang) : openingReaction;
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

    // An allergy named this turn is read back whichever routine follows. It was
    // only ever said on the face path, so a shopper who answered "I do have
    // peanut allergy" and got a hair routine was given no sign it had been
    // heard at all.
    const namedAllergies = before.allergies === undefined && slots.allergies?.length ? slots.allergies : null;
    const heard = namedAllergies ? `${copy.avoiding(namedAllergies)} ` : "";

    // A swapped-away product stays away here too. The face plan carries this
    // through excludeProductIds; the hair and body pickers read the catalogue
    // directly, so without this a "make it stronger" after a swap brought the
    // disliked product straight back.
    const dislikedNow = new Set(slots.dislikedIds ?? []);
    const pickable = products.filter(
      (product) =>
        !dislikedNow.has(product.id) &&
        !blockedByBrand(product.name, slots.dislikedBrands) &&
        (!slots.preferredOrigin || product.originBucket === slots.preferredOrigin),
    );

    // Hair and scalp concerns don't fit the face-routine slot model, so match
    // them directly against the catalogue instead of building an AM/PM routine.
    // If the merchant stocks nothing suitable we say so rather than selling a
    // face routine for dandruff.
    // A switched concern opens with its welcome; and a fresh routine ends by
    // holding the door open — "anything else?" is what keeps this a
    // conversation instead of a vending machine.
    const switchLead = newConcern ? `${copy.nextConcern} ` : "";

    if (where === "hair" || isHairConcern(slots.mainConcern ?? "")) {
      const hairMatches = await inStockOnly(
        applyPins(
          pickHairProducts(pickable, slots.mainConcern ?? "", profile, tenant.id, safety),
          slots.pinnedIds,
          products,
          profile,
          tenant.id,
          safety,
        ),
      );
      // The face path has said "same 3 steps — tell me what you'd change"
      // instead of re-reading itself for a while; the hair path read the
      // identical routine out loud every time anything fell through to it.
      const hairIds = hairMatches.map((match) => match.id);
      const sameHair =
        Boolean(before.gaveRoutine) &&
        before.lastRoutine?.length === hairIds.length &&
        before.lastRoutine.every((id, index) => id === hairIds[index]);
      const hairLine = `${switchLead}${heard}${copy.hairResult(hairMatches.length)}`;
      return NextResponse.json({
        reply: await say(
          !hairMatches.length
            ? copy.noHairProducts
            : sameHair
              ? copy.sameAgain(hairMatches.length)
              : `${hairLine} ${copy.anythingElse}`,
        ),
        speech:
          hairMatches.length && !sameHair
            ? speakParts(spoken, switchLead, heard, copy.hairResult(hairMatches.length), copy.anythingElse)
            : undefined,
        phase: hairMatches.length ? "result" : "referral",
        slots: { ...slots, gaveRoutine: true, lastRoutine: hairIds },
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
        applyPins(
          pickBodyProducts(pickable, slots.mainConcern ?? "", profile, tenant.id, safety),
          slots.pinnedIds,
          products,
          profile,
          tenant.id,
          safety,
        ),
      );
      const bodyIds = bodyMatches.map((match) => match.id);
      const sameBody =
        Boolean(before.gaveRoutine) &&
        before.lastRoutine?.length === bodyIds.length &&
        before.lastRoutine.every((id, index) => id === bodyIds[index]);
      const bodyLine = `${switchLead}${heard}${copy.bodyResult(bodyMatches.length, area)}`;
      return NextResponse.json({
        reply: await say(
          !bodyMatches.length
            ? copy.noBodyProducts(area)
            : sameBody
              ? copy.sameAgain(bodyMatches.length)
              : `${bodyLine} ${copy.anythingElse}`,
        ),
        speech:
          bodyMatches.length && !sameBody
            ? speakParts(spoken, switchLead, heard, copy.bodyResult(bodyMatches.length, area), copy.anythingElse)
            : undefined,
        phase: bodyMatches.length ? "result" : "referral",
        slots: { ...slots, gaveRoutine: true, lastRoutine: bodyIds },
        safetyLevel: safety.level,
        language: spoken,
        rtl: isRtl(spoken),
        products: bodyMatches,
      });
    }

    const plan = {
      tenantId: tenant.id,
      profile,
      safety,
      // Disliked products and brands are gone from the LIST, not just the
      // exclusion set — the sold-out rebuild overwrites excludeProductIds,
      // and an exclusion that lives in the list cannot be overwritten.
      products: pickable,
      sponsoredEnabled: true,
      // A swapped-away product stays away, whatever else changes later.
      excludeProductIds: new Set(slots.dislikedIds ?? []),
    };
    // The stock check and the model's phrasing of the result are independent,
    // and each used to wait for the other. Run them together: the turn now
    // costs the slower of the two rather than the sum.
    //
    // The explanation names products, so it is only usable if the stock check
    // did not swap any of them out. A rebuild is rare, and the deterministic
    // copy it falls back to was always going to be correct.
    const provider = getLLMProvider();
    const usingRealModel = (provider.lastUsedId ?? provider.id) !== "mock";
    const draftRoutine = buildRecommendations(plan);
    const [{ routine: recommendation, rebuilt }, explanation] = await Promise.all([
      inStockRoutine(plan, draftRoutine),
      RICH_REPLIES && usingRealModel && lang === "en" && draftRoutine.items.length
        ? withBudget(provider.explainRecommendations(profile, draftRoutine, safety), EXPLAIN_BUDGET_MS, "")
        : Promise.resolve(""),
    ]);

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

    const faceItems = applyPins(
      recommendation.items.map(routineItemToProduct),
      slots.pinnedIds,
      products,
      profile,
      tenant.id,
      safety,
    );
    const count = faceItems.length;
    const routineIds = faceItems.map((item) => item.id);

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

    // If the shopper volunteered everything up front we never asked a question,
    // so restate what was understood before recommending - otherwise jumping
    // straight to products reads as if it ignored them.
    const understood = summariseSlots(slots, lang);
    const skippedAhead = !before.askedSkinType && !before.askedPregnancy && !before.askedAllergies;
    // An allergy just named is the one thing that has to be repeated back.
    // "yes salicylic acid" went straight to "here's your routine", which gives
    // the shopper no way of knowing it was heard — and it is precisely the
    // answer they need to know was heard.
    const preface = heard || (skippedAhead && understood ? `${copy.understood(understood)} ` : "");

    let spokenReply: string;
    let resultParts: string[] | undefined;
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
      // A photo earns the six-week handoff: confident about what was seen,
      // honest about when to stop trusting a shop's eyes and see a real one.
      const photoNote = slots.sawPhoto ? ` ${copy.photoNote}` : "";
      spokenReply = `${switchLead}${preface}${copy.result(count)}${photoNote}`;
      resultParts = speakParts(
        spoken,
        switchLead,
        preface,
        copy.result(count),
        slots.sawPhoto ? copy.photoNote : undefined,
        copy.anythingElse,
      );
      // The model's phrasing names products, so it is only safe to use when the
      // stock check left the routine alone. It is also re-run through the safety
      // gate, and dropped if it drifts.
      if (
        !rebuilt &&
        explanation.trim() &&
        validateAssistantTextForSafety(explanation, safety).recommendationAllowed
      ) {
        spokenReply = `${switchLead}${preface}${shorten(explanation, 420)}`;
        resultParts = speakParts(spoken, spokenReply, copy.anythingElse);
      }
    }

    // A fresh routine ends with the door held open. The same-again and
    // adjusted lines already close with their own invitations.
    const freshRoutine = !sameAsBefore && !adjusted;
    return NextResponse.json({
      reply: await say(freshRoutine ? `${spokenReply} ${copy.anythingElse}` : spokenReply),
      speech: freshRoutine ? resultParts : undefined,
      phase: "result",
      slots: { ...slots, gaveRoutine: true, lastRoutine: routineIds },
      safetyLevel: safety.level,
      language: spoken,
      rtl: isRtl(spoken),
      products: faceItems,
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
async function inStockRoutine(
  base: Parameters<typeof buildRecommendations>[0],
  routine: ReturnType<typeof buildRecommendations>,
) {
  if (!routine.items.length) return { routine, rebuilt: false };

  const soldOut = await soldOutProductIds(
    routine.items.map((item) => ({ id: item.product.id, url: item.product.url })),
    STOCK_BUDGET_MS,
  );
  if (!soldOut.size) return { routine, rebuilt: false };

  // One rebuild, not a loop. Verifying the replacements too meant up to three
  // sequential round trips to the storefront on the slowest turn in the whole
  // conversation; a second sold-out product in the same routine is rare, and
  // the cost of missing it is one dud card, not a broken routine.
  return { routine: buildRecommendations({ ...base, excludeProductIds: soldOut }), rebuilt: true };
}

/**
 * How long the reply may wait on anything optional.
 *
 * Every one of these had a budget generous enough to be invisible on a fast
 * network and ruinous on a slow one — and they ran one after another, so the
 * turn that produces a routine could spend seven seconds before saying a word.
 * The deterministic answer is ready immediately in every case; these numbers
 * are how long it is worth holding it back for something better.
 */
const STOCK_BUDGET_MS = 500;
const EXPLAIN_BUDGET_MS = 1300;
const READING_BUDGET_MS = 800;

/**
 * Whether the optional model enrichments run at all.
 *
 * Three of them exist: a model-written reaction to the opening line, a model
 * reading of the intake, and a model phrasing of the result. Each is a nicety
 * over an answer the deterministic backbone already has — and each costs twice.
 * Once for the call, and again because what a model writes is unique, so the
 * speech API has to synthesise it from scratch while the shopper waits. The
 * fixed copy is already in their browser.
 *
 * Off by default. `ADVISOR_RICH_REPLIES=1` turns them back on for anyone who
 * would rather have the phrasing than the seconds.
 *
 * The one model call NOT gated here is `readAnswer`, which decides whether an
 * utterance was nonsense. That one earns its round trip: it only runs when the
 * parser could not place the answer at all, and it is the difference between
 * "I have horns" being questioned and being absorbed as a skin type.
 */
const RICH_REPLIES = process.env.ADVISOR_RICH_REPLIES === "1";

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
  if (!RICH_REPLIES || !opening || lang !== "en" || utterance.trim().split(/\s+/).length < 3) return "";

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
    READING_BUDGET_MS,
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

/**
 * A reply as separately-playable parts.
 *
 * The result turn used to weld its acknowledgement, its result line and its
 * closer into one string: one dynamic part, synthesised whole, every time —
 * the biggest reply in the product paying the biggest pause. Split, all but
 * the short acknowledgement play straight from cache.
 */
function speakParts(spoken: LanguageCode, ...parts: (string | undefined)[]): string[] | undefined {
  if (spoken !== "en" && spoken !== "ar") return undefined;
  const clean = parts.map((part) => part?.trim()).filter((part): part is string => Boolean(part));
  return clean.length ? clean : undefined;
}

/**
 * A hair routine, in the order it is used.
 *
 * There was no plan here at all: the four best-scoring hair products were
 * returned, so "dandruff" came back as the same Vichy anti-dandruff shampoo in
 * 200ML and 390ML, plus two more shampoos. Every step is optional — a routine
 * that skips what the catalogue cannot fill is honest.
 */
/** Which routine item an utterance is talking about, by product or step name. */
/** True when any rejected brand word matches this product's name. */
function blockedByBrand(name: string, brands: string[] | undefined): boolean {
  return Boolean(brands?.some((token) => nameMatchesBrandToken(name, token)));
}

const BRAND_COMPLAINT_STOPWORDS = new Set([
  "dont", "like", "want", "hate", "avoid", "without", "remove", "drop", "never", "this", "that",
  "these", "those", "only", "just", "please", "brand", "brands", "korean", "japanese", "french",
  "product", "products", "anything", "everything", "with", "from", "more", "again", "still",
  "there", "here", "recommendation", "routine", "saying", "said", "have", "some", "something",
  // Domain words describe every product at once; a complaint naming one of
  // these alone must never evict the whole routine.
  "hair", "skin", "face", "scalp", "body", "the", "and", "for", "you", "your", "added", "list",
  "website", "see", "can", "now", "what", "that", "was", "step", "steps",
]);

/**
 * A brand-level rejection, read against the routine on screen.
 *
 * The token must actually match something being shown — that is what keeps
 * "I don't like the cleanser" a single-product swap (one hit, no brand cue)
 * and makes "I don't like laroche, only korean brands" a brand eviction
 * (several hits, or one hit plus a brand-shaped sentence).
 */
function readBrandComplaint<T extends { id: string; name: string }>(
  utterance: string,
  items: T[],
  requireCue: boolean,
): { token: string; hits: T[] } | null {
  const text = utterance.toLowerCase();
  if (
    requireCue &&
    !/(?:don'?t|do not|dont)\s+(?:like|want|need)|no more|hate|avoid|without|remove|take (?:it |that )?out|get rid of|drop|never/.test(
      text,
    )
  ) {
    return null;
  }
  const tokens = text
    .split(/[^a-z0-9\u0600-\u06ff]+/)
    .filter((token) => token.length >= 3 && !BRAND_COMPLAINT_STOPWORDS.has(token));
  for (const token of tokens) {
    const hits = items.filter((item) => nameMatchesBrandToken(item.name, token));
    if (hits.length >= 2) return { token, hits };
    if (hits.length === 1 && /\b(?:brand|brands|only|all|anything|everything)\b/.test(text)) return { token, hits };
  }
  return null;
}

// Face-side concern words, used only to spot a two-concern opening — the hair
// side is isHairConcern, which routing already trusts.
const FACE_CONCERN =
  /\b(acne|pimples?|breakouts?|blackheads?|dark spots?|dark circles|pigmentation|melasma|wrinkles?|fine lines|redness|rosacea|eczema|blemish(es)?|dull(ness)?|large pores)\b/i;

const STEP_WORDS: Record<string, string[]> = {
  cleanser: ["cleanser", "cleansing", "wash", "الغسول", "غسول"],
  toner: ["toner", "تونر"],
  treatment: ["serum", "treatment", "سيروم"],
  eye: ["eye", "العين"],
  moisturizer: ["moisturiser", "moisturizer", "cream", "المرطب", "مرطب"],
  sunscreen: ["sunscreen", "spf", "sunblock", "واقي"],
  exfoliant: ["exfoliant", "scrub", "peel", "مقشر"],
  mask: ["mask", "ماسك"],
  // The hair steps were missing entirely, so no word a shopper could say
  // pointed at a hair product except its brand name.
  shampoo: ["shampoo", "شامبو"],
  conditioner: ["conditioner", "بلسم"],
  scalp: ["scalp", "فروة"],
  oil: ["oil", "زيت"],
};

function matchRoutineItem<T extends { step: string; slot: string; name: string }>(
  utterance: string,
  items: T[],
): T | null {
  const text = utterance.toLowerCase();
  let best: T | null = null;
  let bestScore = 0;
  for (const item of items) {
    let score = 0;
    for (const word of item.name.toLowerCase().split(/[^a-z0-9\u0600-\u06ff]+/)) {
      if (word.length > 2 && text.includes(word)) score += 2;
    }
    for (const word of STEP_WORDS[item.step] ?? []) if (text.includes(word)) score += 3;
    if (item.slot && text.includes(item.slot.toLowerCase())) score += 3;
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}

function routineItemToProduct(item: {
  product: ProductCatalogItem;
  step: string;
  slot: string;
  reason: string;
  expectedResults: string;
  cautions: string[];
  sponsored: boolean;
}) {
  return {
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
  };
}

const HAIR_ROUTINE: { step: RoutineStep; label: string }[] = [
  { step: "shampoo", label: "shampoo" },
  { step: "conditioner", label: "conditioner" },
  { step: "scalp", label: "scalp care" },
  { step: "oil", label: "hair oil" },
  { step: "mask", label: "weekly mask" },
];

function slotLabelFor(step: RoutineStep): string {
  return HAIR_ROUTINE.find((entry) => entry.step === step)?.label ?? BODY_LABELS[step] ?? step;
}

/**
 * Products the shopper asked for BY NAME, held in the routine across rebuilds.
 *
 * "Do you have any hair serum?" swapped the serum in; without this, the very
 * next "make it stronger" would rebuild the routine and silently drop the one
 * product the shopper specifically requested. A pin replaces the item on its
 * step or joins the end, still subject to the same hard safety filters as
 * everything else — a pinned product an allergy excludes stays out.
 */
/** The client card for a product the shopper asked for by name. */
function pinnedItem(product: ProductCatalogItem): ReturnType<typeof routineItemToProduct> {
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
    slot: slotLabelFor(step),
    reason: "In because you asked for it by name.",
    expectedResults: "Give it the same few weeks of regular use you'd give anything new.",
    cautions: ["Patch test before first use.", "Follow the label directions."],
    sponsored: false,
  };
}

function applyPins(
  items: ReturnType<typeof routineItemToProduct>[],
  pinnedIds: string[] | undefined,
  catalogue: ProductCatalogItem[],
  profile: IntakeProfileInput,
  tenantId: string,
  safety: SafetyTriage,
): ReturnType<typeof routineItemToProduct>[] {
  if (!pinnedIds?.length) return items;
  const result = [...items];
  for (const id of pinnedIds) {
    if (result.some((item) => item.id === id)) continue;
    const product = catalogue.find((row) => row.id === id);
    if (!product || !passesHardFilters(product, profile, tenantId, safety)) continue;
    const pinned = pinnedItem(product);
    const index = result.findIndex((item) => item.step === pinned.step);
    if (index >= 0) result[index] = pinned;
    else result.push(pinned);
  }
  return result;
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

  const ranked = products
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
    .sort((a, b) => b.score - a.score);

  // One product per routine, not one row per routine — the guard the face
  // builder has had for a while and this one never did. Two sizes of the same
  // shampoo are two catalogue rows and one product to a shopper, and both were
  // being offered as separate steps.
  const seenFamilies = new Set<string>();
  const distinct = ranked.filter(({ product }) => {
    const family = productFamily(product.name);
    if (!family) return true;
    if (seenFamilies.has(family)) return false;
    seenFamilies.add(family);
    return true;
  });

  // Best product per step, in routine order. Nothing is picked twice, so a
  // dandruff answer is a shampoo and the things you use alongside it.
  const chosen: typeof distinct = [];
  for (const entry of HAIR_ROUTINE) {
    const match = distinct.find(
      (candidate) =>
        routineStep(candidate.product) === entry.step &&
        !chosen.some((picked) => picked.product.id === candidate.product.id),
    );
    if (match) chosen.push(match);
  }

  return chosen.slice(0, 4).map(({ product }) => {
    const step = routineStep(product);
    const label = HAIR_ROUTINE.find((entry) => entry.step === step)?.label ?? "hair & scalp";
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
      slot: label,
      reason: wants.length
        ? `Chosen for the ${wants.slice(0, 2).join(" and ")} you described.`
        : `Your ${label} step for what you described.`,
      expectedResults:
        step === "shampoo"
          ? "Flaking and itch usually settle within two to four weeks of regular washes."
          : "Hair and scalp are slow — most people give a new step six to eight weeks.",
      cautions: ["Patch test before first use.", "Follow the label directions."],
      sponsored: false,
    };
  });
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
