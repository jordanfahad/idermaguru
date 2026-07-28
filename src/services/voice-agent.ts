import type { IntakeProfileInput } from "@/domain/skincare";
import { areaRoute, extractBodyArea, namesSkinType, needsBodyArea, type BodyArea } from "./body-area";
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

export function readAdjustment(input: string): RoutineAdjustment | null {
  const text = normaliseTranscript(input);
  if (!text) return null;
  if (WANT_GENTLER.test(text)) return "gentler";
  if (WANT_SIMPLER.test(text)) return "simpler";
  if (WANT_FULLER.test(text)) return "fuller";
  return null;
}

/**
 * A question is asked at most twice. Voice transcription is imperfect and a
 * shopper who cannot be understood must never be trapped in a loop, so the
 * third time we take the safest available answer and move on.
 */
const MAX_MISSES = 1;

export type AgentPhase = "asking" | "result" | "referral";

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
  if (PREGNANT.test(text) || PREGNANT_AR.test(input)) return true;
  if (NOT_PREGNANT.test(text) || NOT_PREGNANT_AR.test(input)) return false;
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
  return readYesNo(text);
}

const HAIR_CONCERN =
  /\b(hair|scalp|dandruff|dandruf|flakes?|flaky scalp|hair ?fall|hair ?loss|shedding|balding|thinning hair|split ends|frizz|shampoo|conditioner)\b/i;
const HAIR_CONCERN_AR = /شعر|فروة|قشرة|تساقط|شامبو|بلسم/;

/** True when the shopper is asking about hair or scalp rather than skin. */
export function isHairConcern(input: string): boolean {
  return HAIR_CONCERN.test(normaliseTranscript(input)) || HAIR_CONCERN_AR.test(input);
}

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

  // Only when the word was attached to their skin, or the whole utterance is
  // the answer. "dry patches on my elbows" says nothing about skin type, and
  // recording "dry skin" from it reads back as a fabrication — and, worse, it
  // convinced the agent it was talking about a face, so it never asked where
  // the patches were.
  const statesType = namesSkinType(text) || text.split(/\s+/).length <= 3;
  const skinType = statesType ? extractSkinType(text) : undefined;
  if (skinType) found.skinType = skinType;

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

export type Aside = "greeting" | "identity" | "thanks" | "offtopic";

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
    askConcern: "Tell me your main skin or hair concern.",
    askSkinType: "How would you describe your skin — oily, dry, combination, or sensitive?",
    // Phrased as a rule about ingredients rather than a question about the
    // shopper's body. Asked flatly, it reads as a presumption to every man who
    // hears it. Skipped entirely when they have said it does not apply.
    askPregnancy:
      "One safety check — a few ingredients aren't advised in pregnancy or breastfeeding. Does either apply to you?",
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
    nothingStronger:
      "That's genuinely as far as I can take it with what this store stocks and still keep it safe for you — there's nothing further to add. If you want to go harder than this, a pharmacist or a dermatologist can offer things I'm not allowed to suggest.",
    sameAgain: (count: number) =>
      `I've had another look and I'd still put you on the same ${count} steps — nothing else here fits you better. Tell me what you'd change about it and I'll have another go.`,
    result: (count: number) =>
      `Here's a simple routine with ${count} product${count === 1 ? "" : "s"} matched from the store. I've kept it conservative — patch test anything new, and use sunscreen every morning.`,
    bodyResult: (count: number, area: string) =>
      `Here's what the store has for ${area} — ${count} product${count === 1 ? "" : "s"}, kept gentle. Patch test on a small area first, and give it a couple of weeks before you judge it.`,
  },
  ar: {
    greeting: "مرحباً — أنا مستشار البشرة. أخبرني ما الذي يزعج بشرتك أو شعرك.",
    askConcern: "أخبرني بمشكلتك الأساسية في البشرة أو الشعر.",
    askSkinType: "كيف تصف بشرتك — دهنية أم جافة أم مختلطة أم حساسة؟",
    askPregnancy: "شكراً. قبل أن أقترح أي شيء: هل أنتِ حامل أو مرضعة؟",
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
      offtopic: "هذا خارج مجالي للأسف — البشرة والشعر هما ما أعرفه.",
      elsewhere:
        "آه، يؤسفني ذلك — يبدو مزعجاً، وبصراحة ليس مما أستطيع المساعدة فيه. الطبيب أو الصيدلي هو الشخص المناسب. لكن إن كان لديك ما يخص البشرة أو الشعر، فأنا رهن إشارتك.",
    },
    offTopicBridge: (topic: string) => `يبدو أنك تسأل عن ${topic} — هذا خارج مجالي للأسف. البشرة والشعر هما ما أعرفه.`,
    offTopicLetGo: "لا بأس — سأترك هذا الأمر. إن كان لديك سؤال عن البشرة أو الشعر فأنا هنا.",
    heardConcern: (concern: string) => `${concern} — فهمت.`,
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
    nothingStronger:
      "هذا أقصى ما أستطيع الوصول إليه بما يوفّره هذا المتجر مع الحفاظ على سلامتك — لا يوجد ما أضيفه. إن أردت أقوى من ذلك، يمكن لصيدلي أو طبيب جلدية تقديم ما لا يُسمح لي باقتراحه.",
    sameAgain: (count: number) =>
      `راجعت مرة أخرى وما زلت أقترح الخطوات الـ${count} نفسها — لا يوجد هنا ما يناسبك أكثر. أخبرني بما تريد تغييره وسأحاول مجدداً.`,
    result: (count: number) =>
      `هذا روتين بسيط يضم ${count} منتج مطابق من المتجر. أبقيته متحفظاً — جرّب المنتج على مساحة صغيرة أولاً، واستخدم واقي الشمس كل صباح.`,
    bodyResult: (count: number, area: string) =>
      `هذا ما يوفّره المتجر لـ${area} — ${count} منتج، اخترتها لطيفة. جرّبها على مساحة صغيرة أولاً، وامنحها أسبوعين قبل الحكم عليها.`,
  },
};

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
    copy.askAllergies,
    copy.askAllergyNames,
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
    const area = extractBodyArea(text);
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
    if (readYesNo(text) === true) {
      next.askedAllergyNames = true;
      next.misses = 0;
      return next;
    }
    if (gained) {
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
  const onTheFace = areaRoute(next.bodyArea) === "face";
  if (onTheFace && !next.skinType && !next.skinTypeUnknown) {
    next.askedSkinType = true;
    return { question: copy.askSkinType, slots: next };
  }

  if (next.pregnantOrBreastfeeding === undefined) {
    next.askedPregnancy = true;
    return { question: copy.askPregnancy, slots: next };
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
    // Where it is belongs in the text the engine ranks against: a hand cream
    // should win for a hand concern, and nothing else told it that.
    freeText: slots.bodyArea ? slots.bodyArea.replace("-", " and ") : undefined,
    skinType: slots.skinType,
    // "very high" is what the hard filter reads, so asking for gentler actually
    // removes the strong acids rather than merely re-ranking around them.
    sensitivity: slots.gentle ? "very high" : slots.skinType === "sensitive" ? "high" : "low",
    pregnantOrBreastfeeding: slots.pregnantOrBreastfeeding ?? false,
    allergies: slots.allergies ?? [],
    routinePreference: slots.routineShape === "full" ? "balanced" : "simple",
    secondaryConcerns: [],
    currentProducts: [],
    currentActives: [],
    symptoms: [],
  };
}
