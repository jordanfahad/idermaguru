import { escalationMessage, type IntakeProfileInput } from "@/domain/skincare";
import { distressCopy, feelingCopy, sorrowCopy } from "./empathy";
import { areaRoute, extractBodyArea, namesSkinType, needsBodyArea, type BodyArea } from "./body-area";
import { readsAge, readsThirdParty } from "./audience";
import { normaliseTranscript, type AgentLang } from "./text";

/**
 * Deterministic dialogue backbone for the voice concierge.
 *
 * The LLM is used to UNDERSTAND free-form speech, never to decide safety. The
 * required safety slots (pregnancy/breastfeeding, allergies) are always asked
 * and are filled only from explicit deterministic parsing of what the shopper
 * said, so a model cannot skip or override them.
 */
export type { AgentLang };
export { normaliseTranscript };

export type AgentSlots = {
  mainConcern?: string;
  skinType?: string;
  pregnantOrBreastfeeding?: boolean;
  allergies?: string[];
  /** Where the concern is. Decides which pipeline answers it. */
  bodyArea?: BodyArea;
  askedPregnancy?: boolean;
  askedAllergies?: boolean;
  askedSkinType?: boolean;
  askedBodyArea?: boolean;
  /** Set once the shopper says they DO have allergies but hasn't named them. */
  askedAllergyNames?: boolean;
  /** Set once we have given up asking for a skin type, so we stop asking. */
  skinTypeUnknown?: boolean;
  /** Set once we have given up asking where it is, so we stop asking. */
  bodyAreaUnknown?: boolean;
  /** How many times we have failed to understand the current question. */
  misses?: number;
  /** Consecutive off-topic turns, so the agent stops nagging and lets go. */
  offTopic?: number;
  /** Set once a routine has been given, so the next turn is a follow-up. */
  gaveRoutine?: boolean;
  /** What was in that routine, so we can tell whether a rebuild changed it. */
  lastRoutine?: string[];
  /** Adjustments the shopper asked for after seeing the routine. */
  routineShape?: "simple" | "full";
  gentle?: boolean;
  /** Products the shopper rejected, so a swap never brings one back. */
  dislikedIds?: string[];
  /** How old the person using the product is, when they have said. */
  ageYears?: number;
  /** True when the shopper is asking on somebody else's behalf. */
  forSomeoneElse?: boolean;
  /** True once a photo has been reviewed, so the result can speak to it. */
  sawPhoto?: boolean;
  /**
   * Set after the shopper answers "yes" to "anything else?" — the very next
   * utterance IS the new concern, whatever words it uses.
   */
  awaitingConcern?: boolean;
  /**
   * Products the shopper asked for BY NAME, kept in the routine across every
   * later rebuild — "make it stronger" must not silently drop the serum they
   * specifically requested.
   */
  pinnedIds?: string[];
  /**
   * Brand words the shopper rejected ("I don't like laroche — only Korean
   * brands"). Matched fuzzily against product NAMES, because merchant feeds
   * put the store's own name in the brand column. A brand dislike is about
   * the person, not the concern: it survives topic switches.
   */
  dislikedBrands?: string[];
  /** "Only Korean brands" — honoured wherever the brand registry knows origins. */
  preferredOrigin?: "korean" | "french";
  /**
   * Concerns whose routines are FINISHED and must stay on screen. Switching
   * from dandruff to acne used to REPLACE the hair routine with the face one;
   * the shopper asked "did you remove it?" and the cart could only ever carry
   * whichever routine happened to be visible.
   */
  keptConcerns?: string[];
};

/**
 * What the shopper wants changed about the routine they are looking at.
 *
 * "I need it more intense routine" was answered by rebuilding the identical
 * routine and reading out the identical sentence — the conversation simply
 * ended at the result and every further turn bounced off it.
 *
 * Gentler is read before stronger on purpose: "too strong" is a request for
 * less, and it contains the word the stronger patterns look for.
 */
export type RoutineAdjustment = "fuller" | "simpler" | "gentler";

const WANT_GENTLER =
  /\b(gentler|too harsh|too strong|too much for|milder|softer|less harsh|less aggressive|irritat\w*|stings?|burning|too intense)\b/;
const WANT_SIMPLER =
  /\b(simpler|simplest|fewer steps|less steps|too many|too complicated|shorter|minimal|bare minimum|just the essentials|cut it down|trim it)\b/;
const WANT_FULLER =
  /\b(more intense|intense|stronger|strong|advanced|serious|aggressive|full routine|complete routine|more steps|extra steps|add more|more thorough|deeper|go harder|maximum)\b/;

/**
 * A challenge to the routine on screen: "why that one?" or "give me a
 * different one". The advisor answers with its actual reasoning, or swaps the
 * product and says what changed — a shopper pushing back is engaging, not
 * off-topic, and both used to fall through to the tangent classifier.
 */
export type RoutineFollowup = "why" | "swap";

const ASKS_WHY =
  /\bwhy\b|\bwhat(?:'s| is)? (?:that|this|it) for\b|\bwhat does (?:it|this|that) do\b|\bhow come\b|\bexplain\b|\bconvince me\b|\bjustify\b/;
// Word-bounded throughout: without \b, "whatever" contains "hate" and a
// perfectly agreeable sentence reads as a demand to swap.
const ASKS_SWAP =
  /\b(?:swap|replace|remove|different one|something else|another (?:one|option|product)|other options?|alternative)\b|\btake (?:it|that|this)? ?(?:out|off)\b|\bget rid of\b|\bdon'?t (?:like|want|trust|need)\b|\bnot a fan\b|\bhate\b|\binstead of\b|\btoo expensive\b|\bcheaper\b/;
export function readFollowup(input: string): RoutineFollowup | null {
  const text = normaliseTranscript(input);
  if (!text) return null;
  // An adjustment ("make it stronger") is its own flow and wins.
  if (readAdjustment(text)) return null;
  if (ASKS_WHY.test(text)) return "why";
  if (ASKS_SWAP.test(text)) return "swap";
  return null;
}

export function readAdjustment(input: string): RoutineAdjustment | null {
  const text = normaliseTranscript(input);
  if (!text) return null;
  if (WANT_GENTLER.test(text)) return "gentler";
  if (WANT_SIMPLER.test(text)) return "simpler";
  if (WANT_FULLER.test(text)) return "fuller";
  return null;
}

/**
 * A NEW concern raised after the routine is a new conversation, not an
 * adjustment of the old one.
 *
 * "I want to add more for my acne", said over a dandruff routine, contains
 * "add more" — so the adjustment reader claimed it, rebuilt the same three
 * hair products at the shopper, and the acne was never heard at all. A named
 * concern that is not part of the current one outranks every routine follow-up.
 */
const CONCERN_WORDS =
  /\b(acne|pimples?|breakouts?|blackheads?|whiteheads?|dark spots?|dark circles|pigmentation|melasma|uneven tone|wrinkles?|fine lines|ageing|aging|dry skin|dryness|oily skin|dull(?:ness)?|redness|rosacea|eczema|psoriasis|blemish(?:es)?|scars?|large pores|dandruff|hair ?fall|hair loss|frizz|itchy scalp|rash(?:es)?)\b|(?:بثور|حبوب|رؤوس سوداء|بقع داكنة|هالات|تصبغات|تجاعيد|خطوط رفيعة|جفاف|احمرار|أكزيما|ندوب|مسام|قشرة|تساقط|طفح)/i;

export function readNewConcern(utterance: string, currentConcern: string | undefined): string | null {
  const text = normaliseTranscript(utterance);
  if (!text) return null;
  const match = text.match(CONCERN_WORDS);
  if (!match) return null;
  const word = (match[1] ?? match[0]).toLowerCase();
  // "What about my dandruff?" straight after the dandruff routine is the same
  // conversation. Only a concern ABSENT from the current one switches topic.
  if (normaliseTranscript(currentConcern ?? "").includes(word)) return null;
  return utterance.trim();
}

/**
 * Starting over on a new concern, without forgetting the person.
 *
 * Skin type, pregnancy, allergies, age and disliked products all describe the
 * shopper and carry over — re-asking them is how a conversation stops feeling
 * like one. Everything scoped to the old concern resets, so the interview asks
 * only what the new concern actually needs.
 */
export function beginConcern(slots: AgentSlots, utterance: string): AgentSlots {
  const text = utterance.trim();
  const area = extractBodyArea(text) ?? (isHairConcern(text) ? "scalp" : undefined);
  // A finished routine from a DIFFERENT domain stays on screen. Same-domain
  // switches replace (two face routines would double every step).
  const oldConcern = slots.gaveRoutine ? slots.mainConcern : undefined;
  const differentDomain = oldConcern && isHairConcern(oldConcern) !== isHairConcern(text);
  const kept = differentDomain
    ? [...(slots.keptConcerns ?? []).filter((concern) => concern !== oldConcern), oldConcern].slice(-2)
    : slots.keptConcerns;
  return {
    ...slots,
    keptConcerns: kept,
    mainConcern: text,
    bodyArea: area,
    bodyAreaUnknown: undefined,
    askedBodyArea: undefined,
    gaveRoutine: undefined,
    lastRoutine: undefined,
    awaitingConcern: undefined,
    // Pins are requests about THIS routine; a hair serum pinned by name must
    // not follow the shopper into their face routine.
    pinnedIds: undefined,
    misses: 0,
    offTopic: 0,
    ...extractInlineSlots(text),
  };
}

/**
 * A question about a specific product: "do you have any hair serum?", "what
 * about the Ordinary multi-peptide?". Asked three different ways in one live
 * session and answered, all three times, by re-reading the same routine —
 * the single most robotic thing the advisor did that day.
 *
 * The shape test is deliberately loose; the CALLER only acts when the query
 * also matches something in the catalogue, so "do you have something else"
 * still falls through to the swap flow.
 */
const PRODUCT_QUERY_SHAPE =
  /\b(?:do (?:you|u) (?:have|stock|carry|sell)|have you got|got any|is there|any chance of|what about|how about|looking for|asking about|هل عندك|هل لديك|هل يوجد|ماذا عن)\b/i;

/** Words that describe the shopper or the domain, never a product's name. */
const QUERY_STOPWORDS = new Set([
  "do", "you", "have", "any", "got", "the", "a", "an", "is", "there", "what", "how", "about", "it",
  "them", "this", "that", "im", "i", "am", "asking", "sell", "stock", "carry", "of", "for", "in",
  "me", "my", "please", "does", "u", "want", "need", "just", "and", "or", "with", "your", "yours",
  "something", "anything", "else", "one", "some", "chance", "looking",
]);
const QUERY_DOMAIN_WORDS = new Set(["face", "skin", "hair", "scalp", "body"]);

export function readProductQuery(input: string): string[] | null {
  if (!PRODUCT_QUERY_SHAPE.test(input)) return null;
  const tokens = normaliseTranscript(input)
    .split(/[^a-z0-9؀-ۿ]+/)
    .filter((token) => token.length >= 3 && !QUERY_STOPWORDS.has(token));
  if (!tokens.length) return null;
  // "What about my dandruff?" names a concern and a domain, not a product.
  const aboutProducts = tokens.some(
    (token) => !QUERY_DOMAIN_WORDS.has(token) && !CONCERN_WORDS.test(token),
  );
  return aboutProducts ? tokens : null;
}

/**
 * Whether two tokens are within two edits of each other — the scale of damage
 * speech-to-text does to a brand name ("Miley" for "Mielle").
 */
export function closeEnough(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 2) return false;
  const rows = a.length + 1;
  const cols = b.length + 1;
  let previous = Array.from({ length: cols }, (_, j) => j);
  for (let i = 1; i < rows; i += 1) {
    const current = [i];
    for (let j = 1; j < cols; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[cols - 1] <= 2;
}

/**
 * The catalogue row a query is talking about, if any is a confident match.
 *
 * Token scoring with prefix and edit-distance credit, because these arrive
 * from speech-to-text: "multiply hair serum" is "Multi-Peptide", "hair salon"
 * is "hair serum", and "Miley hair oil" is the Mielle oil.
 */
export function findProductByQuery<
  T extends { name: string; brand: string; category: string; merchantPriority: number },
>(products: T[], tokens: string[]): T | null {
  let best: T | null = null;
  let bestScore = 0;
  for (const product of products) {
    const words = `${product.name} ${product.brand} ${product.category}`
      .toLowerCase()
      .split(/[^a-z0-9؀-ۿ]+/)
      .filter(Boolean);
    let score = 0;
    let matched = 0;
    for (const token of tokens) {
      const exact = words.some((word) => word === token);
      const prefix =
        !exact &&
        token.length >= 4 &&
        words.some((word) => word.length >= 4 && (word.startsWith(token) || token.startsWith(word)));
      const fuzzy =
        !exact && !prefix && token.length >= 5 && words.some((word) => word.length >= 5 && closeEnough(token, word));
      if (exact) {
        score += 2;
        matched += 1;
      } else if (prefix || fuzzy) {
        score += 1;
        matched += 1;
      }
    }
    if (matched < Math.ceil(tokens.length / 2) || score < 2) continue;
    if (score > bestScore || (score === bestScore && best && product.merchantPriority > best.merchantPriority)) {
      best = product;
      bestScore = score;
    }
  }
  return best;
}

/**
 * The two answers to "anything else I can help with?". Deliberately strict,
 * whole-utterance matches: "no" mid-interview belongs to the open question,
 * and these are only consulted once the routine is settled.
 */
const ALL_DONE =
  /^(?:no+|nope|nah|no,? thanks?(?: you)?|no,? thank you|not really|that'?s (?:all|it|everything)|i'?m (?:all )?(?:good|done|set|fine|okay|ok)|nothing(?: else)?(?:,? thanks?| for now)?|all good|we'?re done|i'?m done|that will be all|that'?ll be all|لا|لا شكرا|لا شكراً|خلاص|هذا كل شيء|انتهيت|كفى)[.!؟]?$/i;
const WANTS_MORE =
  /^(?:yes|yeah|yep|yup|sure|please|yes please|go on|one more(?: thing)?|actually,? yes|نعم|أجل|ايوه|إيوه|طبعا|طبعاً|تمام)[.!؟]?$/i;

export function readsDone(utterance: string): boolean {
  return ALL_DONE.test(utterance.trim());
}

export function readsMore(utterance: string): boolean {
  return WANTS_MORE.test(utterance.trim());
}

/**
 * "Goodbye", however it is said — with thanks, with warmth, in either
 * language. From a live session: "Goodbye." was answered with a rebuilt
 * routine, "Goodbye, thank you so much." with "Any time.", and "Bye-bye."
 * with the off-topic brush-off — three attempts to leave, none heard. A
 * farewell is one or more goodbye words surrounded by nothing but courtesy;
 * any substantive word ("bye bye blackheads") means it is not a goodbye.
 */
const FAREWELL_CORE =
  "(?:good\\s?bye|bye(?: ?bye)?|farewell|ciao|cya|see (?:you|ya)(?: later| soon| around)?|take care|good night|catch you later|i(?:'m| am) (?:off|leaving|heading (?:off|out))|(?:i )?(?:got|gotta|have) to (?:go|run)|مع السلامة|السلامة|سلامات|وداعا|وداعاً|باي(?: باي)?|تصبح على خير|تصبحين على خير)";
const FAREWELL_COURTESY =
  "(?:thank(?:s| you)?(?: so much| a lot| very much)?|so much|really|ok(?:ay)?|all right|alright|great|perfect|lovely|wonderful|amazing|that'?s all|my dear|dear|i love you|love you|good|then|for now|and|شكرا|شكراً|جزيلا|جزيلاً|لك|كثير|يا عزيزي|يا عزيزتي|حبيبي|حبيبتي|تمام|خلاص)";
const FAREWELL = new RegExp(`^(?:${FAREWELL_COURTESY} )*${FAREWELL_CORE}(?: ${FAREWELL_COURTESY})*$`, "i");

export function readsFarewell(utterance: string): boolean {
  const clean = utterance
    .toLowerCase()
    .replace(/[.,!?؟…—-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return FAREWELL.test(clean);
}

/**
 * "It's still there" — the shopper says the routine still contains the thing
 * they rejected. It named nothing in the skin vocabulary, so it got "That
 * one's outside my world" at the exact moment trust needed repairing.
 */
const STILL_THERE =
  /\b(?:(?:it'?s?|is|are|they'?re?) still (?:there|here|showing|in|the same)|still (?:there|showing|see|selling|sells?|shows?|stocks?|in the (?:routine|list|recommendation))|can still see|didn'?t (?:change|swap|remove|listen)|hasn'?t (?:changed|gone)|not (?:changed|removed|gone)|you kept (?:it|them)|(?:same|identical) (?:thing|product|routine|list) again)\b|ما زال موجود|لا يزال موجود|لم يتغير|نفس الشيء/i;

const ONLY_KOREAN =
  /\b(?:only|just) (?:korean|k[- ]?beauty)\b|\bkorean (?:brands?|products?)?\s*only\b|\bkorean brands? please\b|كوري(?:ة)? فقط|فقط الكوري/i;
const ONLY_FRENCH = /\b(?:only|just) french\b|\bfrench (?:pharmacy |brands? )?only\b|فرنسي(?:ة)? فقط/i;

/** "Only Korean brands please" — a standing preference, not a one-off swap. */
export function readOriginPreference(input: string): "korean" | "french" | undefined {
  const text = normaliseTranscript(input);
  if (ONLY_KOREAN.test(text) || ONLY_KOREAN.test(input)) return "korean";
  if (ONLY_FRENCH.test(text) || ONLY_FRENCH.test(input)) return "french";
  return undefined;
}

export function readsStillThere(input: string): boolean {
  return STILL_THERE.test(normaliseTranscript(input)) || STILL_THERE.test(input);
}

/**
 * The word a shopper used for a brand they reject, matched against a product
 * name. Fuzzy on purpose: speech-to-text writes "laroche" for La Roche-Posay,
 * and name words are also tried joined in pairs so split brand names match.
 */
export function nameMatchesBrandToken(productName: string, token: string): boolean {
  const needle = token.toLowerCase();
  // Three-letter words ("oil", "gel") match exactly or not at all; the fuzzy
  // paths below already demand longer words on both sides.
  if (needle.length < 3) return false;
  const words = productName
    .toLowerCase()
    .split(/[^a-z0-9؀-ۿ]+/)
    .filter(Boolean);
  const candidates = [...words];
  for (let i = 0; i < words.length - 1; i += 1) candidates.push(`${words[i]}${words[i + 1]}`);
  return candidates.some(
    (word) =>
      word === needle ||
      (word.length >= 4 && (word.startsWith(needle) || needle.startsWith(word))) ||
      (word.length >= 5 && needle.length >= 5 && closeEnough(word, needle)),
  );
}

/**
 * A question is asked at most twice. Voice transcription is imperfect and a
 * shopper who cannot be understood must never be trapped in a loop, so the
 * third time we take the safest available answer and move on.
 */
const MAX_MISSES = 1;

export type AgentPhase = "asking" | "result" | "referral" | "farewell";

const ARABIC = /[؀-ۿ]/;

export function detectLang(text: string, fallback: AgentLang = "en"): AgentLang {
  return ARABIC.test(text) ? "ar" : fallback;
}

// Ordered most-conservative first: "dry sensitive skin" must resolve to
// sensitive, because that is what tightens the product filters.
const SKIN_TYPES: { key: string; en: RegExp; ar: RegExp }[] = [
  // "حساسية" (allergy) contains "حساس" (sensitive), so saying "no allergies" in
  // Arabic used to classify the shopper as sensitive-skinned. Exclude it.
  { key: "sensitive", en: /\bsensitive|reactive\b/i, ar: /حساس(?!ية)/ },
  { key: "oily", en: /\boily|greasy|shiny\b/i, ar: /دهني|دهنية/ },
  { key: "dry", en: /\bdry|dehydrated|tight\b/i, ar: /جاف|جافة/ },
  { key: "combination", en: /\bcombination|combo\b/i, ar: /مختلط|مختلطة/ },
  { key: "normal", en: /\bnormal\b/i, ar: /عادي|عادية/ },
];

// "i am" is deliberately NOT an affirmative: "I am a man" was being read as a
// yes to "are you pregnant?", which recorded the wrong safety answer.
const YES = /\b(yes|yeah|yep|yup|correct|sure|i do|i have|affirmative)\b/i;
const YES_AR = /نعم|أجل|ايوه|إيوه|صح/;
const NO = /\b(no|nope|nah|not|none|neither|negative|never|nothing)\b/i;
const NO_AR = /لا|كلا|ما في|مافي|ولا|ما عندي/;
// Statements that answer "are you pregnant/breastfeeding?" with an implicit no.
const NOT_PREGNANT = /\b(man|male|guy|boy|father|husband|not pregnant)\b/i;
const NOT_PREGNANT_AR = /رجل|ذكر|لست حامل/;
// Written against the normalised transcript, so compounds are matched with an
// optional space: "breastfeeding" / "breast-feeding" / "breast feeding".
const PREGNANT = /\b(pregnant|pregnancy|expecting|breast ?feeding|nursing|feeding my baby)\b/i;
const PREGNANT_AR = /حامل|مرضع/;
// Negation must sit next to the pregnancy word. A sentence-wide "no" test read
// "I am pregnant, no allergies" as NOT pregnant, because "no allergies"
// supplied the negative - and that silently disabled the retinoid filter.
const NOT_PREGNANT_PHRASE =
  /\b(?:not|never|no longer|isn'?t|ain'?t|am ?n[o']?t|'m not)\s+(?:\w+\s+){0,2}?(?:pregnant|pregnancy|expecting|breast ?feeding|nursing)\b/i;
const NOT_PREGNANT_PHRASE_AR = /(?:لست|لسنا|غير|لا)\s*(?:حامل|مرضع)/;

/**
 * Single source of truth for "is this person pregnant or breastfeeding?".
 * Returns undefined when the text does not say either way.
 */
export function readsPregnant(input: string): boolean | undefined {
  const text = normaliseTranscript(input);
  if (NOT_PREGNANT_PHRASE.test(text) || NOT_PREGNANT_PHRASE_AR.test(input)) return false;

  const saysPregnant = PREGNANT.test(text) || PREGNANT_AR.test(input);
  const saysNot = NOT_PREGNANT.test(text) || NOT_PREGNANT_AR.test(input);
  // "I am breast-feeding man" says both things at once. Taking the first match
  // resolved it silently and read back "I'll skip the ingredients that aren't
  // advised" to somebody who had just said they were a man. An answer that
  // contradicts itself is not an answer — ask it again. If it stays unclear the
  // caller falls back to the assumption that filters the most.
  if (saysPregnant && saysNot) return undefined;
  if (saysPregnant) return true;
  if (saysNot) return false;
  return undefined;
}

export function extractSkinType(input: string): string | undefined {
  const text = normaliseTranscript(input);
  for (const type of SKIN_TYPES) {
    if (type.en.test(text) || type.ar.test(input)) return type.key;
  }
  return undefined;
}

/** Explicit yes/no reading. Returns undefined when the answer is unclear. */
export function readYesNo(input: string): boolean | undefined {
  const text = normaliseTranscript(input);
  const negative = NO.test(text) || NO_AR.test(input);
  const positive = YES.test(text) || YES_AR.test(input);
  if (negative && !positive) return false;
  if (positive && !negative) return true;
  return undefined;
}

/**
 * Reading of the pregnancy/breastfeeding question specifically. Speech is messy
 * ("I'm a man" transcribes as "I am a mad"), so an unclear answer must stay
 * undefined and be asked again rather than be guessed.
 */
export function readPregnancyAnswer(text: string): boolean | undefined {
  const stated = readsPregnant(text);
  if (stated !== undefined) return stated;
  // "Hey I have hair dandruff and acne" contains "I have" — a yes-marker —
  // and was recorded as a pregnancy. A sentence that is busy describing a
  // skin or hair concern is not answering this question at all.
  if (describesConcern(text)) return undefined;
  return readYesNo(text);
}

/**
 * True when the utterance is describing a skin or hair concern — which means
 * it is NOT an answer to whatever yes/no safety question happens to be open.
 */
export function describesConcern(input: string): boolean {
  return isHairConcern(input) || CONCERN_WORDS.test(normaliseTranscript(input)) || CONCERN_WORDS.test(input);
}

const HAIR_CONCERN =
  /\b(hair|scalp|dandruff|dandruf|flakes?|flaky scalp|hair ?fall|hair ?loss|shedding|balding|thinning hair|split ends|frizz|shampoo|conditioner)\b/i;
const HAIR_CONCERN_AR = /شعر|فروة|قشرة|تساقط|شامبو|بلسم/;

/** True when the shopper is asking about hair or scalp rather than skin. */
export function isHairConcern(input: string): boolean {
  return HAIR_CONCERN.test(normaliseTranscript(input)) || HAIR_CONCERN_AR.test(input);
}

/**
 * An utterance that is a skin type and nothing else — how the question is
 * actually answered. Anything with a second idea in it ("super dry dandruff")
 * is a description, not an answer, and must not be recorded as one.
 */
const BARE_SKIN_TYPE =
  /^(?:i(?:'m| am| have)?\s+)?(?:got\s+)?(?:a\s+)?(?:very |really |quite |super |bit |kind of )?(oily|dry|combination|combo|sensitive|normal|dehydrated)(?:\s+skin)?$/;

const NO_ALLERGIES =
  /\b(no|not any|none|without|zero)\b[^.]{0,20}\ballerg/i;
const NO_ALLERGIES_AR = /(لا|ما)\s*(يوجد|عندي)?\s*حساسية/;
const ALLERGIC_TO = /\ballergic to\s+([^.,;!?]{2,60})/i;
const ALLERGIC_TO_AR = /حساسية\s+(?:من|تجاه)\s+([^.،؛!؟]{2,60})/;

/**
 * Pulls every slot a shopper volunteers in one breath.
 *
 * People answer a voice agent conversationally - "oily skin, I'm 29, not
 * pregnant, no allergies" - and being asked those same three questions one at a
 * time afterwards is what makes an advisor feel like a form. Safety slots are
 * still only set from an EXPLICIT statement; anything merely implied is left
 * empty so it gets asked properly.
 */
export function extractInlineSlots(input: string): Partial<AgentSlots> {
  const found: Partial<AgentSlots> = {};
  if (!input.trim()) return found;
  const text = normaliseTranscript(input);

  // Only when the word was attached to their skin, or the utterance is the
  // answer and nothing else. "dry patches on my elbows" says nothing about skin
  // type, and neither does "super dry dandruff" — which was recorded as a dry
  // skin type and read straight back as "Got it — dry skin" to somebody talking
  // about their scalp. A word-count rule was too loose to tell them apart.
  const statesType = namesSkinType(text) || BARE_SKIN_TYPE.test(text);
  const skinType = statesType ? extractSkinType(text) : undefined;
  if (skinType) found.skinType = skinType;

  // "She's four years old" was thrown away as a tangent. An age is an answer
  // wherever it turns up, and it is the one fact that can stop the sale.
  const age = readsAge(text);
  if (age !== undefined) found.ageYears = age;
  if (readsThirdParty(text)) found.forSomeoneElse = true;

  // Pregnancy: only an explicit statement counts.
  const pregnant = readsPregnant(text);
  if (pregnant !== undefined) found.pregnantOrBreastfeeding = pregnant;
  // A shopper who has told us he is a man should never be asked whether he is
  // pregnant. Asking anyway is the kind of thing that loses a customer.
  else if (MALE.test(text)) found.pregnantOrBreastfeeding = false;

  // Allergies: an explicit "no allergies", or a named "allergic to X".
  if (NO_ALLERGIES.test(text) || NO_ALLERGIES_AR.test(input)) {
    found.allergies = [];
  } else {
    const named = ALLERGIC_TO.exec(text)?.[1] ?? ALLERGIC_TO_AR.exec(input)?.[1];
    if (named) {
      const list = named
        .split(/\s*(?:,|and|أو|و)\s*/i)
        .map((item) => item.trim())
        .filter((item) => item.length > 2);
      if (list.length) found.allergies = Array.from(new Set(list)).slice(0, 6);
    }
  }

  return found;
}

const SKIN_TERMS =
  /\b(skin|hair|scalp|face|facial|complexion|acne|pimple|blemish|spot|patch|blotch|bruis|dry|oily|greasy|pore|blackhead|wrinkle|line|dull|glow|tone|pigment|redness|irritat|itch|flake|dandruff|serum|cream|cleanser|wash|sunscreen|spf|moistur|routine|product|allerg|pregnan|breast|sensitive|barrier|eczema|rash|hives|burn|scar|stretch mark|mole|ingrown|chaf|callus|blister|lip|eye|nose|cheek|forehead|chin|neck|beard|shave)/i;
/**
 * How skin looks, as opposed to what it is attached to.
 *
 * A real shopper says "dark knuckles" or "my elbows are darker than the rest" —
 * no word in the list above appears in either, so both were classified as
 * off-topic and answered with "I only cover skin and hair here". The body part
 * deliberately does not count on its own: adding "elbow" to the skin vocabulary
 * would have made "my elbow hurts" a skincare concern too.
 */
const SKIN_LOOK =
  /\b(dark|darker|darkening|darkness|discolou?r\w*|hyperpigment\w*|uneven|lighten\w*|brighten\w*|whiten\w*|bleach\w*|patchy|blotchy|bumpy|rough|ashy|crack\w*|peel\w*|thicken\w*)\b/i;
// Ingredient names are valid answers to "what are you allergic to?", so they
// must never read as a tangent.
const INGREDIENT_TERMS =
  /\b(acid|salicylic|glycolic|lactic|mandelic|azelaic|hyaluronic|retino|tretinoin|adapalene|benzoyl|niacinamide|vitamin|ascorbic|ceramide|panthenol|centella|cica|peptide|zinc|titanium|fragrance|perfume|parfum|paraben|sulfate|alcohol|essential oil|lanolin|latex|nut|shea|coconut|aloe|tea tree|penicillin|sulfa|nickel)/i;
const SKIN_TERMS_AR = /بشرة|وجه|شعر|فروة|حبوب|بقع|جاف|دهني|مسام|تجاعيد|قشرة|كريم|سيروم|غسول|واقي|روتين|حساسية|حامل/;

/** "I'm a man" — enough to skip the pregnancy question entirely. */
const MALE = /\b(?:i am|i'?m|im)\s+(?:a\s+)?(?:man|male|guy|boy|dude|father|dad|husband)\b|\bmale\b/i;

/**
 * "I don't know" is an honest answer to a question we asked, not a tangent.
 * It used to be met with "Just to be clear, I only cover skin and hair here."
 */
const UNSURE = /\b(?:i (?:don'?t|dont|do not) know|not sure|no idea|unsure|dunno|can'?t tell)\b/i;

/**
 * A complaint about a part of the body that isn't skin or hair. A skincare
 * advisor has nothing useful to say about a sore knee, and answering "how would
 * you describe your skin?" to "I have a leg pain" reads as not listening.
 */
const OTHER_BODY_PART =
  /\b(leg|knee|ankle|foot|feet|toe|arm|elbow|shoulder|wrist|hip|back|spine|tooth|teeth|gum|jaw|stomach|belly|abdomen|chest|lung|kidney|liver|bladder|joint|muscle|bone|throat|ear|head)\b/i;
const BODY_COMPLAINT =
  /\b(pain|ache|aching|aches|hurts?|hurting|sore|swollen|swelling|stiff|injur\w*|broken|sprain\w*|cramp\w*)\b/i;
/** "toothache" is one word, so the two patterns above never meet inside it. */
const ACHE_COMPOUND = /\b(tooth|head|back|stomach|ear|belly|neck|body)aches?\b/i;

const GREETINGS = /\b(hi|hello|hey|salam|marhaba|good (morning|evening|afternoon))\b/i;
const IDENTITY = /\b(who|what) (are|r) (you|u)\b|\byour name\b|\bare you (a )?(human|robot|bot|real|ai)\b/i;
const THANKS = /\b(thanks|thank you|shukran|cheers|appreciate)\b/i;
// "Hello can you hear me" is a person checking the thing works, and it was
// answered with "That one's outside my world" — the coldest possible reply to
// the warmest possible opening. A hearing check gets "Loud and clear!".
const MIC_CHECK =
  /\b(?:can|do) you hear(?: me)?\b|\bhear me\?|\bare you (?:there|listening)\b|\bis this (?:thing )?(?:on|working)\b|\btesting[,.\s]+(?:testing|one|1)\b|\bmic (?:check|test)\b|هل تسمعني|أتسمعني|هل أنت (?:هنا|موجود|تسمع)/i;

export function readsMicCheck(input: string): boolean {
  return MIC_CHECK.test(normaliseTranscript(input)) || MIC_CHECK.test(input);
}

export type Aside = "greeting" | "identity" | "thanks" | "offtopic" | "hearing";

/**
 * Detects an utterance that isn't answering us and isn't about skin.
 *
 * People say hello, ask what you are, thank you, or wander off topic entirely.
 * Treating those as a skin concern - or as a failure to understand - is what
 * makes an assistant feel robotic. They get a real answer and are then brought
 * back to the question that is still open.
 */
/**
 * Is the shopper's opening line something this advisor can help with?
 *
 * Nothing checked it before: the first utterance was stored as the main concern
 * whatever it said, so "I have a leg pain" was answered with "I have a leg pain
 * — understood. How would you describe your skin?", and "do you sell iphones"
 * became a skin concern. The tangent classifier existed but was only consulted
 * from the second turn onwards.
 *
 * Safety triage runs before this, so anything alarming has already been sent to
 * a clinician by the time we get here.
 */
/**
 * Does this utterance mention skin or hair at all?
 *
 * Used to tell "my dog died" from "I have scars after the accident". The first
 * is bad news and nothing else; the second is bad news *and* a question this
 * advisor can answer, and diverting it would be its own kind of not listening.
 */
export function mentionsSkinOrHair(input: string): boolean {
  const text = normaliseTranscript(input);
  return (
    SKIN_TERMS.test(text) || SKIN_LOOK.test(text) || INGREDIENT_TERMS.test(text) || SKIN_TERMS_AR.test(input)
  );
}

export function classifyOpening(input: string): "elsewhere" | "offtopic" | null {
  const text = normaliseTranscript(input);
  if (!text) return null;

  const aboutSkin =
    SKIN_TERMS.test(text) || SKIN_LOOK.test(text) || INGREDIENT_TERMS.test(text) || SKIN_TERMS_AR.test(input);
  if (aboutSkin) return null;

  if (ACHE_COMPOUND.test(text)) return "elsewhere";
  if (OTHER_BODY_PART.test(text) && BODY_COMPLAINT.test(text)) return "elsewhere";
  // One word ("acne", "dandruff") is a concern, not a tangent, even if the
  // vocabulary above hasn't heard of it.
  return text.split(/\s+/).length >= 2 ? "offtopic" : null;
}

export function classifyAside(input: string): Aside | null {
  const text = normaliseTranscript(input);
  if (!text) return null;

  const answersSomething =
    readYesNo(text) !== undefined ||
    extractSkinType(text) !== undefined ||
    readsPregnant(text) !== undefined;
  const aboutSkin =
    SKIN_TERMS.test(text) || SKIN_LOOK.test(text) || INGREDIENT_TERMS.test(text) || SKIN_TERMS_AR.test(input);

  // An honest "I don't know" is an answer to the open question, not a tangent.
  if (UNSURE.test(text)) return null;
  // A hearing check is unmistakable and outranks everything: whatever else the
  // sentence contains, the person is asking whether they are being heard.
  if (readsMicCheck(input)) return "hearing";
  if (IDENTITY.test(text)) return "identity";
  if (answersSomething || aboutSkin) return null;
  if (THANKS.test(text)) return "thanks";
  if (GREETINGS.test(text) && text.split(" ").length <= 4) return "greeting";
  // Anything else with real content that mentions nothing we handle.
  return text.split(" ").length >= 2 ? "offtopic" : null;
}

/** Human-readable summary of what was understood, in the agent's own words. */
export function summariseSlots(slots: AgentSlots, lang: AgentLang): string {
  const parts: string[] = [];
  if (slots.skinType) {
    parts.push(lang === "ar" ? `بشرة ${translateSkinType(slots.skinType)}` : `${slots.skinType} skin`);
  }
  // Not "pregnant or breastfeeding" — read back to a shopper it sounds like the
  // agent guessing which. It only ever affects which ingredients are excluded,
  // so say that instead.
  if (slots.pregnantOrBreastfeeding === true) {
    parts.push(lang === "ar" ? "سأتجنّب المكونات غير المناسبة" : "I'll skip the ingredients that aren't advised");
  }
  if (slots.allergies?.length) {
    parts.push(
      lang === "ar" ? `حساسية من ${slots.allergies.join("، ")}` : `allergic to ${slots.allergies.join(", ")}`,
    );
  } else if (slots.allergies?.length === 0) {
    parts.push(lang === "ar" ? "بدون حساسية" : "no allergies");
  }
  return parts.join(lang === "ar" ? "، " : ", ");
}

function translateSkinType(value: string) {
  return (
    { oily: "دهنية", dry: "جافة", combination: "مختلطة", sensitive: "حساسة", normal: "عادية" }[value] ?? value
  );
}

/**
 * Things people are actually allergic to in skincare.
 *
 * Not exhaustive, and not meant to be: it exists to tell a named allergen from
 * a stray word. Anything the shopper introduces with "allergic to" is taken at
 * face value regardless, so an ingredient missing from this list is still heard.
 */
const KNOWN_ALLERGENS = [
  "fragrance", "perfume", "parfum", "essential oil", "lavender", "citrus", "limonene", "linalool",
  "alcohol", "paraben", "sulfate", "sls", "formaldehyde", "lanolin", "propylene glycol", "peg",
  "nickel", "latex", "silicone", "dimethicone", "shea", "coconut", "almond", "nut", "peanut",
  "soy", "gluten", "wheat", "dairy", "milk", "lactic acid", "salicylic", "aspirin", "benzoyl",
  // The full name as well as the stem. The most-specific-match filter below
  // keeps only one of them, so a shopper who says "salicylic acid" hears
  // "salicylic acid" back rather than a truncated "salicylic".
  "salicylic acid", "glycolic acid", "azelaic acid", "kojic acid", "hyaluronic acid",
  "ascorbic acid", "benzoyl peroxide", "mandelic acid",
  "retinol", "retinoid", "tretinoin", "vitamin c", "ascorbic", "niacinamide", "glycolic", "aha",
  "bha", "urea", "sunscreen", "avobenzone", "oxybenzone", "octocrylene", "zinc", "titanium",
  "tea tree", "aloe", "honey", "propolis", "beeswax", "collagen", "hyaluronic", "menthol",
  "camphor", "sulfur", "iodine", "penicillin", "steroid", "hydroquinone", "chamomile", "argan",
  "jojoba", "castor", "mineral oil", "petrolatum", "charcoal", "clay", "kojic", "azelaic",
];

/**
 * Allergy list from a spoken answer. "no"/"none" yields an empty list;
 * undefined means "that was not an answer" and the question is asked again.
 *
 * This used to strip a few filler words and keep whatever was left, so
 * "yes I do have period of energy" was recorded as an allergy to "have",
 * "period" and "energy" — and, the profile being complete, the shopper went
 * straight to a routine built around it. A word only counts as an allergen if
 * it reads like one, or if they explicitly said "allergic to" it.
 */
export function extractAllergies(input: string): string[] | undefined {
  if (readYesNo(input) === false) return [];
  const text = normaliseTranscript(input);

  // Explicitly named: believe them, whatever the ingredient is.
  const named = ALLERGIC_TO.exec(text)?.[1] ?? ALLERGIC_TO_AR.exec(input)?.[1];
  if (named?.trim()) {
    const list = named
      .split(/\s*(?:,|and|&|\u0648)\s*/i)
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 1);
    if (list.length) return Array.from(new Set(list)).slice(0, 6);
  }

  // Otherwise only recognisable allergens count. A bare "yes" carries no
  // allergen at all, which is what askedAllergyNames is for.
  const matched = KNOWN_ALLERGENS.filter((allergen) => text.includes(allergen));
  // "peanut" contains "nut", so a bare peanut allergy matched both and read back
  // as "allergic to nut, peanut". Keep only the most specific match.
  const specific = matched.filter(
    (allergen) => !matched.some((other) => other !== allergen && other.includes(allergen)),
  );
  return specific.length ? Array.from(new Set(specific)).slice(0, 6) : undefined;
}

const COPY = {
  en: {
    greeting: "Hi — I'm your skin advisor. Tell me what's bothering your skin or hair.",
    // Opened from a product page, where the shopper is already looking at one
    // thing. Naming it is the whole point of the entry point: an advisor that
    // opened with the generic greeting there would be admitting it had not
    // been told, on the one page where it was.
    //
    // It still ends by asking about their skin rather than about the product.
    // "Is this right for me" is not answerable from the label — it needs the
    // same concern and safety questions as any other route through — and the
    // dialogue below is what makes sure those get asked.
    greetingAboutProduct: (product: string) =>
      `Hi — I see you're looking at ${product}. I can tell you whether it suits your skin. What's your skin like, or what's bothering it?`,
    askConcern: "Tell me your main skin or hair concern.",
    askSkinType: "How would you describe your skin — oily, dry, combination, or sensitive?",
    // Phrased as a rule about ingredients rather than a question about the
    // shopper's body. Asked flatly, it reads as a presumption to every man who
    // hears it. Skipped entirely when they have said it does not apply.
    askPregnancy:
      "One safety check — a few ingredients aren't advised in pregnancy or breastfeeding. Does either apply to you?",
    askPregnancyOther:
      "One safety check — a few ingredients aren't advised in pregnancy or breastfeeding. Does either apply to the person this is for?",
    askAllergies: "And do you have any product or ingredient allergies? Say no if none.",
    askAllergyNames: "Which ingredients or products are you allergic to?",
    // Asked before the skin-type question, because the skin-type question is
    // about a face and this is what decides whether we are talking about one.
    askBodyArea:
      "Whereabouts is it? Face, neck, hands, underarms, elbows or knees, feet, somewhere else — it really does change what I'd suggest.",
    building: "Perfect, building your routine now.",
    noProducts:
      "I couldn't find anything in this store that passes the safety checks for what you've told me — I'd rather say that than sell you something that doesn't fit. A pharmacist would be worth a few minutes of your time.",
    noHairProducts:
      "That's a hair and scalp concern, and this store's catalogue is skincare only — so I'd be guessing if I recommended anything. For dandruff or hair fall, an anti-dandruff shampoo from a pharmacy is the right place to start, and a pharmacist can point you to one.",
    noBodyProducts: (area: string) =>
      `I've had a proper look, and this store doesn't stock anything made for ${area} — everything here is face care, and face products on ${area} are usually a waste of your money. A pharmacy will have body-specific options, and a pharmacist can point you at the right one.`,
    repeat: "Sorry, I missed that.",
    didNotFollow: "Sorry, I didn't quite follow that.",
    understood: (summary: string) => `Got it — ${summary}.`,
    aside: {
      greeting: "Hello!",
      identity: "I'm the AI skin advisor for this store — not a doctor, and I only suggest over-the-counter products.",
      thanks: "Any time.",
      hearing: "Loud and clear — I can hear you!",
      offtopic: "That one's outside my world, I'm afraid — skin and hair are what I know.",
      elsewhere:
        "Ah, I'm sorry — that sounds rotten, and it's honestly not something I can help with. A doctor or pharmacist is the right person for it. If something's going on with your skin or hair though, I'm all yours.",
    },
    offTopicBridge: (topic: string) =>
      `It sounds like you're asking about ${topic} — that one's outside my world, I'm afraid. Skin and hair are what I know.`,
    offTopicLetGo: "Fair enough — I'll leave that one alone. If a skin or hair question comes up, I'm here.",
    // Never repeat the shopper's words back at them: it reads as a machine
    // proving it recorded the string, and speech-to-text mistakes turn the echo
    // into an insult.
    heardConcern: () => "Got it.",
    // Intimate skin is thin, occluded and easily damaged, and the products sold
    // for lightening it are the ones most likely to do harm. This is a common
    // thing to be asked and the answer has to be kind about it, not squeamish —
    // but the answer is still a person, not a product from a shelf.
    intimateArea:
      "Thanks for telling me — genuinely, that's one of the most common things I get asked about and there's nothing awkward about it. It's also the one place I won't pick products for you. The skin there is thin and easily irritated, and a lot of what's sold for it can leave things worse. Please see a doctor or a pharmacist who can actually look — they'll have something safe. In the meantime: wash with something plain and unfragranced, skip the scrubs and acids, and loose cotton helps more than people expect.",
    // An allergy is the one answer a shopper needs to hear repeated back. Going
    // straight from "yes salicylic acid" to "here's your routine" gives them no
    // way of knowing whether it was heard at all.
    avoiding: (items: string[]) =>
      `Noted — I'll keep ${items.join(" and ")} out of everything I suggest.`,
    adjusted: {
      fuller: (count: number) =>
        `Right — opened it up to ${count} steps. Bring them in one at a time, a week or so apart, or if your skin reacts you won't know which one did it.`,
      simpler: (count: number) =>
        `Fair enough — back down to ${count} steps. These are the ones carrying the result; the rest was optional.`,
      gentler: (count: number) =>
        `Understood — I've taken out the strong acids and rebuilt it from what tends to suit easily-irritated skin. ${count} steps.`,
      // They asked for gentler a moment ago and are now asking for stronger.
      // Doing it silently would quietly undo something they told us hurt.
      fullerAfterGentle: (count: number) =>
        `Alright — ${count} steps, and the actives are back in. You did say it was stinging, so go slowly with them: one new thing a week, and stop the one that bites.`,
    },
    // The examples must name steps that are actually on the screen. Quoting
    // 'the cleanser' at someone looking at a shampoo routine reads as not
    // having looked at their routine at all.
    whichSwap: (steps: string[]) => {
      const named = steps.filter(Boolean);
      const example =
        named.length >= 2
          ? ` Tell me the product or the step, like 'the ${named[0]}' or 'the ${named[1]}'.`
          : " Tell me the product or the step.";
      return `Happy to change it — which one?${example}`;
    },
    swapNone:
      "I did look — that's genuinely the only product in this store that fits that step and what you've told me. I could go gentler or fuller instead, but a straight swap would mean breaking something you asked for.",
    swapped: (oldName: string, newName: string) =>
      `Fair enough — out goes ${oldName}, in comes ${newName}. Same job, different formula, and it still clears every check you gave me.`,
    whyThis: (name: string, reason: string, timing: string) =>
      `${name} — ${reason} ${timing} If that doesn't win you over, say so and I'll swap it.`,
    whyAll: (lines: string) => `Here's my thinking, step by step: ${lines} Challenge any of them and I'll defend it or swap it.`,
    nothingStronger:
      "That's genuinely as far as I can take it with what this store stocks and still keep it safe for you — there's nothing further to add. If you want to go harder than this, a pharmacist or a dermatologist can offer things I'm not allowed to suggest.",
    sameAgain: (count: number) =>
      `I've had another look and I'd still put you on the same ${count} steps — nothing else here fits you better. Tell me what you'd change about it and I'll have another go.`,
    result: (count: number) =>
      `Here's a simple routine with ${count} product${count === 1 ? "" : "s"} matched from the store. I've kept it conservative — patch test anything new, and use sunscreen every morning.`,
    // The dermatologist's escape hatch, said only when a photo was involved:
    // confident about what was seen, honest about when to stop trusting it.
    photoNote:
      "And since I've actually seen it — give this six weeks of consistent use. If what I saw hasn't visibly shifted by then, that's when I'd want a dermatologist's eyes on it rather than mine.",
    // The face line told a shopper with dandruff to use sunscreen every
    // morning: good advice, and nothing to do with what they asked about.
    hairResult: (count: number) =>
      `Here's a ${count}-step hair and scalp routine from the store. Scalps are slower than faces, so give it a few weeks of regular washes — and patch test anything new.`,
    bodyResult: (count: number, area: string) =>
      `Here's what the store has for ${area} — ${count} product${count === 1 ? "" : "s"}, kept gentle. Patch test on a small area first, and give it a couple of weeks before you judge it.`,
    // The conversation doesn't end at the routine — the door is held open, by
    // name: skin or hair, more to sort or all done.
    anythingElse:
      "Anything else I can help with — your skin, your hair? Or if that's everything, I'll leave you to look through it.",
    whatElse: "Go on — what else is bothering you?",
    wrapUp:
      "Lovely. It's all in the panel whenever you're ready, and I'm right here if anything else comes up. Look after yourself!",
    nextConcern: "Happy to help with that too — let's sort it.",
    // A question about a specific product gets an answer about that product:
    // found and buyable, found but sold out, or honestly not stocked.
    productSwappedIn: (name: string, oldName: string) =>
      `Good shout — the store has ${name}. In it goes, out comes ${oldName}, and it still clears every check you gave me.`,
    productAdded: (name: string, slot: string) =>
      `Good shout — the store has ${name}. I've added it to your routine as your ${slot}.`,
    productSoldOut: (name: string) =>
      `The store does list ${name} — but it's out of stock right now, so I won't put it in your routine. Tell me the job you want done and I'll find you an in-stock alternative.`,
    productBlocked: (name: string) =>
      `The store does have ${name}, but it doesn't clear the checks you've given me — your allergies or your skin's sensitivities — so I won't put it in your routine.`,
    productNotStocked:
      "I've been through the whole catalogue — the store doesn't stock that one. Tell me the job you want done and I'll find the closest thing it does have.",
    // A product asked for before any routine exists: confirm it, keep it, and
    // get on with the interview that decides what goes around it.
    productHere: (name: string) =>
      `Good news — the store has ${name}. I've put it on screen and I'll keep it in whatever we build.`,
    // Two concerns in one breath. Say the plan, or the second one sounds ignored.
    twoThings: "Got it — that's two things, so let's take them one at a time. Hair first.",
    // The swap refusal when an alternative EXISTS but the shelf is empty. The
    // plain refusal claimed to be the only product that fits, which was untrue.
    swapSoldOut:
      "There is an alternative for that step, but it's out of stock right now — I'd rather leave you something you can actually buy today than swap in something you can't.",
    // A rejected BRAND leaves whole, not one product at a time — swapping one
    // La Roche-Posay for another La Roche-Posay is the opposite of listening.
    brandDropped:
      "Fair enough — everything with that name on it is out, for good. Here's your routine without it.",
    // "It's still there" answered with an apology and the fix, never a shrug.
    youAreRight: "You're right — my mistake, and it's gone now. Here's the corrected routine.",
    checkedClean:
      "I've just double-checked the routine on your screen — the one you didn't want isn't in it. If something still looks wrong, name the product and I'll take it out.",
    originOnly: (origin: "korean" | "french") =>
      `Done — from here I'll only pick from ${origin === "korean" ? "Korean" : "French"} brands. Here's your routine, rebuilt around that.`,
  },
  ar: {
    greeting: "مرحباً — أنا مستشار البشرة. أخبرني ما الذي يزعج بشرتك أو شعرك.",
    greetingAboutProduct: (product: string) =>
      `مرحباً — أرى أنك تطّلع على ${product}. يمكنني أن أخبرك إن كان مناسباً لبشرتك. كيف هي بشرتك، أو ما الذي يزعجك فيها؟`,
    askConcern: "أخبرني بمشكلتك الأساسية في البشرة أو الشعر.",
    askSkinType: "كيف تصف بشرتك — دهنية أم جافة أم مختلطة أم حساسة؟",
    askPregnancy: "شكراً. قبل أن أقترح أي شيء: هل أنتِ حامل أو مرضعة؟",
    askPregnancyOther:
      "فحص سلامة واحد — بعض المكونات لا يُنصح بها أثناء الحمل أو الرضاعة. هل ينطبق ذلك على الشخص المعني؟",
    askAllergies: "وهل لديك أي حساسية من منتجات أو مكونات؟ قل لا إذا لم يكن هناك.",
    askAllergyNames: "ما المكونات أو المنتجات التي لديك حساسية منها؟",
    askBodyArea:
      "أين تحديداً؟ الوجه، الرقبة، اليدين، تحت الإبط، الكوعين أو الركبتين، القدمين، أو مكان آخر — هذا يغيّر ما سأقترحه فعلاً.",
    building: "ممتاز، أبني روتينك الآن.",
    noProducts:
      "لم أجد في هذا المتجر ما يجتاز فحوصات السلامة بناءً على ما ذكرته — أفضّل أن أقول ذلك بدل أن أبيعك شيئاً لا يناسبك. استشارة صيدلي تستحق بضع دقائق من وقتك.",
    noHairProducts:
      "هذه مشكلة تتعلق بالشعر وفروة الرأس، وكتالوج هذا المتجر للعناية بالبشرة فقط — لذلك سأكون مخطئاً إن اقترحت منتجاً. لعلاج القشرة أو تساقط الشعر، ابدأ بشامبو مخصص من الصيدلية، ويمكن للصيدلي إرشادك.",
    noBodyProducts: (area: string) =>
      `بحثت جيداً، وهذا المتجر لا يوفّر منتجات مخصصة لـ${area} — كل ما هنا للعناية بالوجه، ومنتجات الوجه على ${area} غالباً إهدار لمالك. الصيدلية لديها خيارات مخصصة للجسم، والصيدلي سيرشدك للمناسب.`,
    repeat: "عذراً، لم أسمع ذلك بوضوح.",
    didNotFollow: "عذراً، لم أفهم ذلك تماماً.",
    understood: (summary: string) => `تمام — ${summary}.`,
    aside: {
      greeting: "أهلاً!",
      identity: "أنا مستشار البشرة الذكي لهذا المتجر — لست طبيباً، وأقترح منتجات بدون وصفة فقط.",
      thanks: "على الرحب والسعة.",
      hearing: "أسمعك بوضوح تام!",
      offtopic: "هذا خارج مجالي للأسف — البشرة والشعر هما ما أعرفه.",
      elsewhere:
        "آه، يؤسفني ذلك — يبدو مزعجاً، وبصراحة ليس مما أستطيع المساعدة فيه. الطبيب أو الصيدلي هو الشخص المناسب. لكن إن كان لديك ما يخص البشرة أو الشعر، فأنا رهن إشارتك.",
    },
    offTopicBridge: (topic: string) => `يبدو أنك تسأل عن ${topic} — هذا خارج مجالي للأسف. البشرة والشعر هما ما أعرفه.`,
    offTopicLetGo: "لا بأس — سأترك هذا الأمر. إن كان لديك سؤال عن البشرة أو الشعر فأنا هنا.",
    // Matches the English: never repeat the shopper's words back. Speech-to-text
    // mistakes turn a friendly echo into an insult, and a line with the
    // transcript spliced into it can never be spoken from cache either.
    heardConcern: () => "فهمت.",
    intimateArea:
      "شكراً لأنك أخبرتني — بصدق، هذا من أكثر ما يُسألني عنه ولا حرج فيه إطلاقاً. وهو أيضاً المكان الوحيد الذي لن أختار لك منتجات له. الجلد هناك رقيق وسريع التهيّج، وكثير مما يُباع لهذا الغرض قد يزيد الأمر سوءاً. راجع طبيباً أو صيدلياً يستطيع الفحص فعلاً — لديه ما هو آمن. وفي الأثناء: اغسل بمنتج بسيط خالٍ من العطر، وتجنّب المقشّرات والأحماض، والملابس القطنية الفضفاضة تساعد أكثر مما يتوقع الناس.",
    avoiding: (items: string[]) => `سُجّل — سأستبعد ${items.join(" و")} من كل ما أقترحه.`,
    adjusted: {
      fuller: (count: number) =>
        `تمام — وسّعته إلى ${count} خطوات. أدخِلها واحدة تلو الأخرى بفارق أسبوع تقريباً، وإلا لن تعرف أيها سبّب التهيّج إن حدث.`,
      simpler: (count: number) =>
        `لا بأس — اختصرته إلى ${count} خطوات. هذه هي التي تحقق النتيجة، والباقي كان اختيارياً.`,
      gentler: (count: number) =>
        `مفهوم — أزلت الأحماض القوية وأعدت بناءه مما يناسب البشرة سريعة التهيّج. ${count} خطوات.`,
      fullerAfterGentle: (count: number) =>
        `تمام — ${count} خطوات، وأعدت المكونات الفعّالة. لكنك ذكرت أنها كانت تسبب حرقة، فتدرّج ببطء: منتج جديد كل أسبوع، وأوقف ما يزعجك.`,
    },
    whichSwap: (steps: string[]) => {
      // Slot labels arrive in English; the ones a routine can carry are named
      // here, and an unmapped label simply drops the example rather than
      // splicing English into an Arabic sentence.
      const labels: Record<string, string> = {
        cleanser: "الغسول",
        serum: "السيروم",
        "second serum": "السيروم الثاني",
        toner: "التونر",
        moisturiser: "المرطب",
        sunscreen: "واقي الشمس",
        "eye cream": "كريم العين",
        "weekly exfoliant": "المقشر الأسبوعي",
        "weekly mask": "الماسك الأسبوعي",
        shampoo: "الشامبو",
        conditioner: "البلسم",
        "scalp care": "عناية فروة الرأس",
        "hair oil": "زيت الشعر",
        wash: "الغسول",
        "targeted step": "الخطوة الموجّهة",
      };
      const named = steps.map((step) => labels[step]).filter(Boolean);
      const example =
        named.length >= 2 ? ` اذكر المنتج أو الخطوة، مثل «${named[0]}» أو «${named[1]}».` : " اذكر المنتج أو الخطوة.";
      return `يسعدني تغييره — أيّ واحد؟${example}`;
    },
    swapNone:
      "بحثت فعلاً — هذا هو المنتج الوحيد في المتجر الذي يناسب هذه الخطوة وما أخبرتني به. يمكنني جعل الروتين ألطف أو أشمل، لكن الاستبدال المباشر سيخالف شيئاً طلبتَه.",
    swapped: (oldName: string, newName: string) =>
      `لا بأس — استبعدتُ ${oldName} ووضعتُ ${newName} مكانه. المهمة نفسها بتركيبة مختلفة، وما زال يجتاز كل الفحوصات.`,
    whyThis: (name: string, reason: string, timing: string) =>
      `${name} — ${reason} ${timing} إن لم يقنعك ذلك فأخبرني وسأستبدله.`,
    whyAll: (lines: string) => `إليك منطقي خطوة بخطوة: ${lines} اعترض على أيٍّ منها وسأدافع عنه أو أستبدله.`,
    nothingStronger:
      "هذا أقصى ما أستطيع الوصول إليه بما يوفّره هذا المتجر مع الحفاظ على سلامتك — لا يوجد ما أضيفه. إن أردت أقوى من ذلك، يمكن لصيدلي أو طبيب جلدية تقديم ما لا يُسمح لي باقتراحه.",
    sameAgain: (count: number) =>
      `راجعت مرة أخرى وما زلت أقترح الخطوات الـ${count} نفسها — لا يوجد هنا ما يناسبك أكثر. أخبرني بما تريد تغييره وسأحاول مجدداً.`,
    result: (count: number) =>
      `هذا روتين بسيط يضم ${count} منتج مطابق من المتجر. أبقيته متحفظاً — جرّب المنتج على مساحة صغيرة أولاً، واستخدم واقي الشمس كل صباح.`,
    photoNote:
      "وبما أنني رأيتُ بشرتك فعلاً — امنح هذا الروتين ستة أسابيع من الاستخدام المنتظم. إن لم يتغيّر ما رأيتُه بشكل ملحوظ حينها، فذلك وقت عرضه على طبيب جلدية بدلاً مني.",
    hairResult: (count: number) =>
      `هذا روتين للشعر وفروة الرأس من ${count} خطوات. فروة الرأس أبطأ من الوجه، فامنحه بضعة أسابيع من الغسل المنتظم — وجرّب أي منتج جديد على مساحة صغيرة أولاً.`,
    bodyResult: (count: number, area: string) =>
      `هذا ما يوفّره المتجر لـ${area} — ${count} منتج، اخترتها لطيفة. جرّبها على مساحة صغيرة أولاً، وامنحها أسبوعين قبل الحكم عليها.`,
    anythingElse: "هل أساعدك في شيء آخر — بشرتك أو شعرك؟ وإن كان هذا كل شيء، أترك لك تصفّح الروتين.",
    whatElse: "تفضل — ما الذي يزعجك أيضاً؟",
    wrapUp: "رائع. كل شيء في اللوحة متى ما كنت جاهزاً، وأنا هنا إن استجدّ شيء. اعتنِ بنفسك!",
    nextConcern: "يسعدني المساعدة في هذا أيضاً — لنبدأ.",
    productSwappedIn: (name: string, oldName: string) =>
      `فكرة موفقة — المتجر لديه ${name}. وضعتُه مكان ${oldName}، وما زال يجتاز كل الفحوصات التي أعطيتني إياها.`,
    productAdded: (name: string, slot: string) => `فكرة موفقة — المتجر لديه ${name}. أضفته إلى روتينك ضمن خطوة ${slot}.`,
    productSoldOut: (name: string) =>
      `المتجر يعرض ${name} فعلاً — لكنه نافد من المخزون حالياً، لذا لن أضعه في روتينك. أخبرني بما تريد تحقيقه وسأجد لك بديلاً متوفراً.`,
    productBlocked: (name: string) =>
      `المتجر لديه ${name}، لكنه لا يجتاز الفحوصات التي أعطيتني إياها — حساسيتك أو طبيعة بشرتك — لذا لن أضعه في روتينك.`,
    productNotStocked: "بحثت في الكتالوج كاملاً — المتجر لا يوفّر هذا المنتج. أخبرني بما تريد تحقيقه وسأجد أقرب بديل متوفر.",
    productHere: (name: string) => `خبر جيد — المتجر لديه ${name}. عرضته لك وسأبقيه في كل ما نبنيه معاً.`,
    twoThings: "فهمت — هذان أمران، فلنأخذهما واحداً تلو الآخر: الشعر أولاً.",
    swapSoldOut:
      "يوجد بديل لهذه الخطوة فعلاً، لكنه نافد من المخزون حالياً — أفضّل أن أترك لك ما يمكنك شراؤه اليوم بدل أن أضع ما لا يمكنك شراؤه.",
    brandDropped: "تمام — استبعدت كل ما يحمل هذا الاسم نهائياً. هذا روتينك من دونه.",
    youAreRight: "معك حق — كان خطئي، وقد أزلته الآن. هذا هو الروتين المصحّح.",
    checkedClean:
      "راجعت الروتين المعروض أمامك للتو — المنتج الذي لم ترغب به ليس فيه. إن كان شيء آخر يبدو خاطئاً، سمِّ المنتج وسأزيله.",
    originOnly: (origin: "korean" | "french") =>
      `تم — من الآن سأختار من العلامات ${origin === "korean" ? "الكورية" : "الفرنسية"} فقط. هذا روتينك بعد إعادة بنائه.`,
  },
};

/**
 * What the advisor says after actually looking at the photo.
 *
 * The old line was a machine reading a list: "From the photo I can see slight
 * oiliness, visible texture, uneven-looking tone." A person who has just looked
 * at your skin doesn't talk in commas — they open, they describe, they reassure,
 * and they move on. On voice this line was never spoken at all; the shopper
 * heard silence and then a question, as if the photo had gone nowhere.
 */
export function describePhoto(observations: string[], lang: AgentLang): string {
  const seen = observations.map((entry) => entry.trim().replace(/\.$/, "")).filter(Boolean).slice(0, 5);
  if (!seen.length) return "";
  const lowered = seen.map((entry) => entry.charAt(0).toLowerCase() + entry.slice(1));

  if (lang === "ar") {
    const woven = lowered.length === 1 ? lowered[0] : `${lowered.slice(0, -1).join("، ")} و${lowered[lowered.length - 1]}`;
    return `حسناً — ألقيتُ نظرة متأنية. أرى ${woven}. لا شيء مقلق فيما أراه — وهذا يعطيني صورة أوضح بكثير للعمل عليها.`;
  }

  const woven = lowered.length === 1 ? lowered[0] : `${lowered.slice(0, -1).join(", ")} and ${lowered[lowered.length - 1]}`;
  return `Right — I've had a proper look. I can see ${woven}. Nothing there that worries me, and it gives me a much better picture to work from.`;
}

export function agentCopy(lang: AgentLang) {
  return COPY[lang];
}

/**
 * The lines every single session says, in the order they are said.
 *
 * The client synthesises these ahead of time so the first tap makes a sound
 * immediately and each answer is followed straight away by the next question,
 * instead of a pause while the speech API catches up.
 */
export function scriptedLines(lang: AgentLang): string[] {
  const copy = COPY[lang];
  return [
    copy.greeting,
    copy.askConcern,
    copy.askBodyArea,
    copy.askSkinType,
    copy.askPregnancy,
    copy.askPregnancyOther,
    copy.askAllergies,
    copy.askAllergyNames,
  ];
}

/** Routine lengths worth pre-rendering. Nine is the longest plan there is. */
const COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * Every line the advisor can say that is not written by a model.
 *
 * This is the set that can be spoken from a cache instead of a round trip to
 * the speech API. Production logs showed the opposite: only the seven questions
 * above were treated as cacheable, so every acknowledgement, reaction and
 * result line went over POST and was synthesised from scratch, every turn, for
 * every shopper — seconds of silence before the advisor said anything.
 *
 * Nothing here contains anything about the shopper beyond a step count, so it
 * is safe to fetch by URL and let the browser keep it.
 */
export function fixedLines(lang: AgentLang): string[] {
  const copy = COPY[lang];
  // Every acknowledgement the interview can open a sentence with. "Got it —
  // sensitive skin." was the one dynamic-looking line in the loop, so the
  // answer's echo paid a full TTS synthesis while the question behind it sat
  // in cache — heard as a huge pause exactly where the shopper had just
  // spoken. There are only five skin types, one pregnancy line and one
  // no-allergies line: enumerable, so enumerated.
  const understoodSingles = [
    ...["oily", "dry", "combination", "sensitive", "normal"].map((type) =>
      copy.understood(summariseSlots({ skinType: type }, lang)),
    ),
    copy.understood(summariseSlots({ pregnantOrBreastfeeding: true }, lang)),
    copy.understood(summariseSlots({ allergies: [] }, lang)),
  ];
  return [
    ...understoodSingles,
    ...scriptedLines(lang),
    ...acknowledgements(lang),
    copy.noProducts,
    copy.noHairProducts,
    copy.intimateArea,
    copy.nothingStronger,
    // The which-one question, with the step examples each routine shape
    // actually opens with. Odd shapes fall back to dynamic synthesis.
    copy.whichSwap(["cleanser", "serum"]),
    copy.whichSwap(["cleanser", "toner"]),
    copy.whichSwap(["shampoo", "conditioner"]),
    copy.whichSwap(["wash", "moisturiser"]),
    copy.swapNone,
    copy.photoNote,
    copy.anythingElse,
    copy.whatElse,
    copy.wrapUp,
    copy.nextConcern,
    copy.productNotStocked,
    copy.swapSoldOut,
    copy.twoThings,
    copy.brandDropped,
    copy.youAreRight,
    copy.checkedClean,
    copy.originOnly("korean"),
    copy.originOnly("french"),
    escalationMessage(lang),
    ...COUNTS.map((count) => copy.result(count)),
    ...COUNTS.map((count) => copy.hairResult(count)),
    ...COUNTS.map((count) => copy.sameAgain(count)),
    ...COUNTS.map((count) => copy.adjusted.fuller(count)),
    ...COUNTS.map((count) => copy.adjusted.simpler(count)),
    ...COUNTS.map((count) => copy.adjusted.gentler(count)),
    ...COUNTS.map((count) => copy.adjusted.fullerAfterGentle(count)),
    ...(["emergency", "urgent-care", "crisis", "bystander"] as const).map((kind) => distressCopy(kind, lang)),
    ...(["grief", "misfortune"] as const).map((kind) => sorrowCopy(kind, lang)),
  ];
}

/**
 * The short lines that open a turn. Small, said constantly, and worth having in
 * the browser before the shopper has finished their first sentence.
 */
export function acknowledgements(lang: AgentLang): string[] {
  const copy = COPY[lang];
  return [
    copy.heardConcern(),
    copy.repeat,
    copy.didNotFollow,
    copy.aside.greeting,
    copy.aside.identity,
    copy.aside.thanks,
    copy.aside.hearing,
    copy.aside.offtopic,
    copy.aside.elsewhere,
    copy.offTopicLetGo,
    ...(["sore", "frustrated", "self-conscious", "worried", "amused"] as const).map((feeling) =>
      feelingCopy(feeling, lang),
    ),
  ];
}

/**
 * Merges a new utterance into the accumulated slots.
 *
 * Anything the shopper volunteers is harvested FIRST, whatever question happens
 * to be open. A real session looped because "Breast-feeding" was said while the
 * agent was asking about skin type: the old code treated the utterance purely
 * as a skin-type answer, defaulted the slot and discarded the pregnancy fact
 * entirely. People answer the question they want to answer, not the one they
 * were asked.
 *
 * Safety slots are still only set from an explicit statement, and a question is
 * only counted as missed when the utterance told us nothing at all - so a
 * shopper who answers a different question is never scolded or looped.
 */
export function updateSlots(slots: AgentSlots, utterance: string, lang: AgentLang): AgentSlots {
  void lang;
  const next: AgentSlots = { ...slots };
  const text = utterance.trim();
  if (!text) return next;

  if (!next.mainConcern) {
    next.mainConcern = text;
    // A shopper who already said where it is ("a rash on my hands") must not
    // then be asked where it is. Only harvested from the opening line: a stray
    // "hand cream" in a later answer is not a statement about location.
    //
    // Dandruff is on a scalp. Nobody needs to be asked, and "super dry
    // dandruff" was being met with "whereabouts is it? Face, neck, hands..."
    // because the word "dry" made it look like a symptom that moves around.
    const area = extractBodyArea(text) ?? (isHairConcern(text) ? "scalp" : undefined);
    return { ...next, ...extractInlineSlots(text), ...(area ? { bodyArea: area } : {}) };
  }

  // Harvest whatever was volunteered, without overwriting a known answer.
  const volunteered = extractInlineSlots(text);
  let gained = false;
  if (volunteered.skinType && !next.skinType) {
    next.skinType = volunteered.skinType;
    gained = true;
  }
  if (volunteered.pregnantOrBreastfeeding !== undefined && next.pregnantOrBreastfeeding === undefined) {
    next.pregnantOrBreastfeeding = volunteered.pregnantOrBreastfeeding;
    gained = true;
  }
  if (volunteered.allergies !== undefined && next.allergies === undefined) {
    next.allergies = volunteered.allergies;
    gained = true;
  }
  if (volunteered.ageYears !== undefined && next.ageYears === undefined) {
    next.ageYears = volunteered.ageYears;
    gained = true;
  }
  if (volunteered.forSomeoneElse && !next.forSomeoneElse) {
    next.forSomeoneElse = true;
    gained = true;
  }

  // Then resolve the question that is actually open.
  if (next.askedPregnancy && next.pregnantOrBreastfeeding === undefined) {
    const answer = readPregnancyAnswer(text);
    if (answer !== undefined) {
      next.pregnantOrBreastfeeding = answer;
      next.misses = 0;
      return next;
    }
    if (gained) {
      next.misses = 0;
      return next;
    }
    // A restated or expanded concern ("Hey I have hair dandruff and acne") is
    // real information, not a failure to answer: keep it, and ask again.
    if (describesConcern(text)) {
      next.mainConcern = `${next.mainConcern}. ${text}`;
      next.misses = 0;
      return next;
    }
    // Unintelligible: ask once more, then assume the answer that filters the
    // most rather than looping or guessing "no".
    next.misses = (next.misses ?? 0) + 1;
    if (next.misses > MAX_MISSES) {
      next.pregnantOrBreastfeeding = true;
      next.misses = 0;
    }
    return next;
  }

  // "Yes I do" to the allergy question: they have allergies but haven't named
  // one. Ask which, rather than treating it as unintelligible.
  if (next.askedAllergies && next.allergies === undefined && !next.askedAllergyNames) {
    const allergies = extractAllergies(text);
    if (allergies !== undefined) {
      next.allergies = allergies;
      next.misses = 0;
      return next;
    }
    // Same trap as the pregnancy question: "I have hair dandruff" contains
    // the yes-marker "I have" and would be read as "yes, allergies".
    if (readYesNo(text) === true && !describesConcern(text)) {
      next.askedAllergyNames = true;
      next.misses = 0;
      return next;
    }
    if (gained) {
      next.misses = 0;
      return next;
    }
    if (describesConcern(text)) {
      next.mainConcern = `${next.mainConcern}. ${text}`;
      next.misses = 0;
      return next;
    }
    next.misses = (next.misses ?? 0) + 1;
    if (next.misses > MAX_MISSES) {
      next.askedAllergyNames = true;
      next.misses = 0;
    }
    return next;
  }

  // Follow-up: whatever they say now IS the allergen list.
  if (next.askedAllergyNames && next.allergies === undefined) {
    const named = extractAllergies(text);
    if (named && named.length) {
      next.allergies = named;
      next.misses = 0;
      return next;
    }
    if (readYesNo(text) === false) {
      next.allergies = [];
      next.misses = 0;
      return next;
    }
    // Keep their exact words: the engine matches allergy terms against
    // ingredient text, so raw input is more useful than dropping it.
    const raw = text.trim();
    if (raw.length > 2) {
      next.allergies = [raw.toLowerCase().slice(0, 60)];
      next.misses = 0;
      return next;
    }
    next.misses = (next.misses ?? 0) + 1;
    if (next.misses > MAX_MISSES) {
      next.allergies = [];
      next.misses = 0;
    }
    return next;
  }

  // Where it is. Asked before the skin type, because the skin-type question is
  // a question about a face and this decides whether we are talking about one.
  if (next.askedBodyArea && !next.bodyArea && !next.bodyAreaUnknown) {
    const area = extractBodyArea(text);
    if (area) {
      next.bodyArea = area;
      next.misses = 0;
    } else if (gained) {
      next.misses = 0;
    } else {
      next.misses = (next.misses ?? 0) + 1;
      if (next.misses > MAX_MISSES) {
        // Somewhere we could not place. Treat it as a face concern rather than
        // asking a third time — that is where most of the catalogue is anyway.
        next.bodyAreaUnknown = true;
        next.misses = 0;
      }
    }
    // Keep the words either way: "the backs of my arms" carries more than the
    // area does, and both the safety triage and the ranking read this text.
    next.mainConcern = `${next.mainConcern}. ${text}`;
    return next;
  }

  if (next.askedSkinType && !next.skinType && !next.skinTypeUnknown) {
    const skinType = extractSkinType(text);
    if (skinType) {
      next.skinType = skinType;
      next.misses = 0;
      return next;
    }
    if (gained) {
      // They answered a different question; ask this one again rather than
      // inventing a skin type from an unrelated sentence.
      next.misses = 0;
      return next;
    }
    next.misses = (next.misses ?? 0) + 1;
    if (next.misses > MAX_MISSES) {
      // Move on without a skin type rather than inventing one. This used to
      // assign "combination", and the agent then said "Got it — combination
      // skin" to a shopper who had never said it: a fabrication presented as
      // understanding. The engine scores an unknown skin type neutrally, so
      // the routine is still sound, just less tailored.
      next.skinTypeUnknown = true;
      next.misses = 0;
    }
    return next;
  }

  // Past the routine, "make it stronger" is an instruction about the routine,
  // not more detail about the concern. Folding it into the concern text put
  // "more intense routine" into what the ranking reads, and changed nothing.
  if (next.gaveRoutine) {
    const adjustment = readAdjustment(text);
    if (adjustment === "fuller") {
      next.routineShape = "full";
      next.gentle = false;
      return next;
    }
    if (adjustment === "simpler") {
      next.routineShape = "simple";
      return next;
    }
    if (adjustment === "gentler") {
      next.gentle = true;
      next.routineShape = "simple";
      return next;
    }
  }

  // Otherwise it is more detail about the concern.
  next.mainConcern = `${next.mainConcern}. ${text}`;
  return next;
}

/** The next question to ask, or null when we have everything we need. */
export function nextQuestion(slots: AgentSlots, lang: AgentLang): { question: string; slots: AgentSlots } | null {
  const copy = COPY[lang];
  const next = { ...slots };

  if (!next.mainConcern) return { question: copy.askConcern, slots: next };

  // A shopper who has named a skin type is describing a face — nobody calls
  // their knuckles combination — so the location question is already answered
  // and asking it would just be one more thing between them and an answer.
  // needsBodyArea makes the same judgement about the concern text itself.
  if (!next.bodyArea && !next.bodyAreaUnknown && !next.skinType && needsBodyArea(next.mainConcern)) {
    next.askedBodyArea = true;
    return { question: copy.askBodyArea, slots: next };
  }

  // "Oily, dry, combination or sensitive" is a question about a face. Asked
  // about a pair of knuckles it is noise, and noise is what makes an advisor
  // feel like a form.
  // Nor is it a question about a scalp. Asking somebody with dandruff whether
  // their skin is oily or dry produced "Got it — dry skin" in a conversation
  // that was never about skin at all.
  const onTheFace = areaRoute(next.bodyArea) === "face" && !isHairConcern(next.mainConcern ?? "");
  if (onTheFace && !next.skinType && !next.skinTypeUnknown) {
    next.askedSkinType = true;
    return { question: copy.askSkinType, slots: next };
  }

  if (next.pregnantOrBreastfeeding === undefined) {
    next.askedPregnancy = true;
    // "Does either apply to you?" is the wrong question when the product is for
    // somebody else — it was asked about a neighbour's four-year-old.
    return {
      question: next.forSomeoneElse ? copy.askPregnancyOther : copy.askPregnancy,
      slots: next,
    };
  }

  if (next.allergies === undefined) {
    if (next.askedAllergyNames) {
      return { question: copy.askAllergyNames, slots: next };
    }
    next.askedAllergies = true;
    return { question: copy.askAllergies, slots: next };
  }

  return null;
}

export function slotsToProfile(slots: AgentSlots, sessionId?: string): IntakeProfileInput {
  return {
    sessionId,
    mainConcern: slots.mainConcern ?? "general routine building",
    // The triage has always had an under-18 rule; nothing ever gave it an age.
    ageRange: slots.ageYears !== undefined ? `${slots.ageYears} years old` : undefined,
    // Where it is belongs in the text the engine ranks against: a hand cream
    // should win for a hand concern, and nothing else told it that.
    freeText: slots.bodyArea ? slots.bodyArea.replace("-", " and ") : undefined,
    skinType: slots.skinType,
    // "very high" is what the hard filter reads, so asking for gentler actually
    // removes the strong acids rather than merely re-ranking around them.
    sensitivity: slots.gentle ? "very high" : slots.skinType === "sensitive" ? "high" : "low",
    pregnantOrBreastfeeding: slots.pregnantOrBreastfeeding ?? false,
    allergies: slots.allergies ?? [],
    routinePreference: slots.routineShape === "full" ? "full" : "simple",
    secondaryConcerns: [],
    currentProducts: [],
    currentActives: [],
    symptoms: [],
  };
}
