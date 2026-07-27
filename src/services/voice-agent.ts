import type { IntakeProfileInput } from "@/domain/skincare";

/**
 * Deterministic dialogue backbone for the voice concierge.
 *
 * The LLM is used to UNDERSTAND free-form speech, never to decide safety. The
 * required safety slots (pregnancy/breastfeeding, allergies) are always asked
 * and are filled only from explicit deterministic parsing of what the shopper
 * said, so a model cannot skip or override them.
 */
export type AgentLang = "en" | "ar";

export type AgentSlots = {
  mainConcern?: string;
  skinType?: string;
  pregnantOrBreastfeeding?: boolean;
  allergies?: string[];
  askedPregnancy?: boolean;
  askedAllergies?: boolean;
  askedSkinType?: boolean;
  /** Set once the shopper says they DO have allergies but hasn't named them. */
  askedAllergyNames?: boolean;
  /** How many times we have failed to understand the current question. */
  misses?: number;
  /** Consecutive off-topic turns, so the agent stops nagging and lets go. */
  offTopic?: number;
};

/**
 * A question is asked at most twice. Voice transcription is imperfect and a
 * shopper who cannot be understood must never be trapped in a loop, so the
 * third time we take the safest available answer and move on.
 */
const MAX_MISSES = 1;

export type AgentPhase = "asking" | "result" | "referral";

/**
 * Speech-to-text splits and hyphenates compound words unpredictably: the same
 * answer arrives as "breastfeeding", "breast-feeding" or "breast feeding"
 * depending on the device. Matching the raw transcript meant one spelling was
 * understood and the others looped. Everything below matches against this
 * normalised form instead.
 */
export function normaliseTranscript(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[-_/.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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

  const skinType = extractSkinType(text);
  if (skinType) found.skinType = skinType;

  // Pregnancy: only an explicit statement counts.
  const pregnant = readsPregnant(text);
  if (pregnant !== undefined) found.pregnantOrBreastfeeding = pregnant;

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
  /\b(skin|hair|scalp|face|facial|complexion|acne|pimple|blemish|spot|patch|blotch|bruis|dry|oily|greasy|pore|blackhead|wrinkle|line|dull|glow|tone|pigment|redness|irritat|itch|flake|dandruff|serum|cream|cleanser|wash|sunscreen|spf|moistur|routine|product|allerg|pregnan|breast|sensitive|barrier|eczema|rash|burn|scar|mole|lip|eye|nose|cheek|forehead|chin|neck|beard|shave)/i;
// Ingredient names are valid answers to "what are you allergic to?", so they
// must never read as a tangent.
const INGREDIENT_TERMS =
  /\b(acid|salicylic|glycolic|lactic|mandelic|azelaic|hyaluronic|retino|tretinoin|adapalene|benzoyl|niacinamide|vitamin|ascorbic|ceramide|panthenol|centella|cica|peptide|zinc|titanium|fragrance|perfume|parfum|paraben|sulfate|alcohol|essential oil|lanolin|latex|nut|shea|coconut|aloe|tea tree|penicillin|sulfa|nickel)/i;
const SKIN_TERMS_AR = /بشرة|وجه|شعر|فروة|حبوب|بقع|جاف|دهني|مسام|تجاعيد|قشرة|كريم|سيروم|غسول|واقي|روتين|حساسية|حامل/;

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
export function classifyAside(input: string): Aside | null {
  const text = normaliseTranscript(input);
  if (!text) return null;

  const answersSomething =
    readYesNo(text) !== undefined ||
    extractSkinType(text) !== undefined ||
    readsPregnant(text) !== undefined;
  const aboutSkin = SKIN_TERMS.test(text) || INGREDIENT_TERMS.test(text) || SKIN_TERMS_AR.test(input);

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
  if (slots.pregnantOrBreastfeeding === true) parts.push(lang === "ar" ? "حامل أو مرضعة" : "pregnant or breastfeeding");
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

/** Allergy list from a spoken answer. "no"/"none" yields an empty list. */
export function extractAllergies(input: string): string[] | undefined {
  if (readYesNo(input) === false) return [];
  const cleaned = normaliseTranscript(input)
    .replace(/\b(yes|yeah|i am|i'm|allergic|to|allergy|allergies|and)\b/gi, " ")
    .replace(/حساسية|من|و/g, " ")
    .replace(/[.,؛;!؟?]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2);
  return cleaned.length ? Array.from(new Set(cleaned)).slice(0, 6) : undefined;
}

const COPY = {
  en: {
    greeting: "Hi — I'm your skin advisor. Tell me what's bothering your skin or hair.",
    askConcern: "Tell me your main skin or hair concern.",
    askSkinType: "How would you describe your skin — oily, dry, combination, or sensitive?",
    askPregnancy: "Before I suggest anything — are you pregnant or breastfeeding?",
    askAllergies: "And do you have any product or ingredient allergies? Say no if none.",
    askAllergyNames: "Which ingredients or products are you allergic to?",
    building: "Perfect, building your routine now.",
    noProducts:
      "I couldn't find products in this store that pass the safety checks for what you told me. It may be worth speaking to a pharmacist.",
    noHairProducts:
      "That's a hair and scalp concern, and this store's catalogue is skincare only — so I'd be guessing if I recommended anything. For dandruff or hair fall, an anti-dandruff shampoo from a pharmacy is the right place to start, and a pharmacist can point you to one.",
    repeat: "Sorry, I didn't catch that.",
    understood: (summary: string) => `Got it — ${summary}.`,
    aside: {
      greeting: "Hello!",
      identity: "I'm the AI skin advisor for this store — not a doctor, and I only suggest over-the-counter products.",
      thanks: "Happy to help.",
      offtopic: "Just to be clear, I only cover skin and hair here.",
    },
    offTopicBridge: (topic: string) =>
      `It sounds like you're asking about ${topic}. Just to be clear, I only cover skin and hair here.`,
    offTopicLetGo: "Understood — I'll leave that one. If a skin or hair question comes up, I'm here.",
    heardConcern: (concern: string) => `${concern} — understood.`,
    result: (count: number) =>
      `Here's a simple routine with ${count} product${count === 1 ? "" : "s"} matched from the store. I've kept it conservative — patch test anything new, and use sunscreen every morning.`,
  },
  ar: {
    greeting: "مرحباً — أنا مستشار البشرة. أخبرني ما الذي يزعج بشرتك أو شعرك.",
    askConcern: "أخبرني بمشكلتك الأساسية في البشرة أو الشعر.",
    askSkinType: "كيف تصف بشرتك — دهنية أم جافة أم مختلطة أم حساسة؟",
    askPregnancy: "شكراً. قبل أن أقترح أي شيء: هل أنتِ حامل أو مرضعة؟",
    askAllergies: "وهل لديك أي حساسية من منتجات أو مكونات؟ قل لا إذا لم يكن هناك.",
    askAllergyNames: "ما المكونات أو المنتجات التي لديك حساسية منها؟",
    building: "ممتاز، أبني روتينك الآن.",
    noProducts:
      "لم أجد منتجات في هذا المتجر تجتاز فحوصات السلامة بناءً على ما ذكرته. قد يكون من الأفضل استشارة صيدلي.",
    noHairProducts:
      "هذه مشكلة تتعلق بالشعر وفروة الرأس، وكتالوج هذا المتجر للعناية بالبشرة فقط — لذلك سأكون مخطئاً إن اقترحت منتجاً. لعلاج القشرة أو تساقط الشعر، ابدأ بشامبو مخصص من الصيدلية، ويمكن للصيدلي إرشادك.",
    repeat: "عذراً، لم أسمع ذلك بوضوح.",
    understood: (summary: string) => `تمام — ${summary}.`,
    aside: {
      greeting: "أهلاً!",
      identity: "أنا مستشار البشرة الذكي لهذا المتجر — لست طبيباً، وأقترح منتجات بدون وصفة فقط.",
      thanks: "بكل سرور.",
      offtopic: "للتوضيح، أنا هنا للبشرة والشعر فقط.",
    },
    offTopicBridge: (topic: string) => `يبدو أنك تسأل عن ${topic}. للتوضيح، أنا هنا للبشرة والشعر فقط.`,
    offTopicLetGo: "مفهوم — سأترك هذا الأمر. إن كان لديك سؤال عن البشرة أو الشعر فأنا هنا.",
    heardConcern: (concern: string) => `${concern} — فهمت.`,
    result: (count: number) =>
      `هذا روتين بسيط يضم ${count} منتج مطابق من المتجر. أبقيته متحفظاً — جرّب المنتج على مساحة صغيرة أولاً، واستخدم واقي الشمس كل صباح.`,
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
    return { ...next, ...extractInlineSlots(text) };
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

  if (next.askedSkinType && !next.skinType) {
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
      next.skinType = "combination";
      next.misses = 0;
    }
    return next;
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

  if (!next.skinType) {
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
    skinType: slots.skinType,
    sensitivity: slots.skinType === "sensitive" ? "high" : "low",
    pregnantOrBreastfeeding: slots.pregnantOrBreastfeeding ?? false,
    allergies: slots.allergies ?? [],
    routinePreference: "simple",
    secondaryConcerns: [],
    currentProducts: [],
    currentActives: [],
    symptoms: [],
  };
}
