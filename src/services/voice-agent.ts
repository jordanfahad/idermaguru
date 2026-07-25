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
};

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
const PREGNANT = /\b(pregnant|pregnancy|expecting|breastfeeding|nursing)\b/i;
const PREGNANT_AR = /حامل|مرضع/;
// Negation must sit next to the pregnancy word. A sentence-wide "no" test read
// "I am pregnant, no allergies" as NOT pregnant, because "no allergies"
// supplied the negative - and that silently disabled the retinoid filter.
const NOT_PREGNANT_PHRASE =
  /\b(?:not|never|no longer|isn'?t|ain'?t|am ?n[o']?t|'m not)\s+(?:\w+\s+){0,2}?(?:pregnant|pregnancy|expecting|breastfeeding|nursing)\b/i;
const NOT_PREGNANT_PHRASE_AR = /(?:لست|لسنا|غير|لا)\s*(?:حامل|مرضع)/;

/**
 * Single source of truth for "is this person pregnant or breastfeeding?".
 * Returns undefined when the text does not say either way.
 */
export function readsPregnant(text: string): boolean | undefined {
  if (NOT_PREGNANT_PHRASE.test(text) || NOT_PREGNANT_PHRASE_AR.test(text)) return false;
  if (PREGNANT.test(text) || PREGNANT_AR.test(text)) return true;
  if (NOT_PREGNANT.test(text) || NOT_PREGNANT_AR.test(text)) return false;
  return undefined;
}

export function extractSkinType(text: string): string | undefined {
  for (const type of SKIN_TYPES) {
    if (type.en.test(text) || type.ar.test(text)) return type.key;
  }
  return undefined;
}

/** Explicit yes/no reading. Returns undefined when the answer is unclear. */
export function readYesNo(text: string): boolean | undefined {
  const negative = NO.test(text) || NO_AR.test(text);
  const positive = YES.test(text) || YES_AR.test(text);
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
export function isHairConcern(text: string): boolean {
  return HAIR_CONCERN.test(text) || HAIR_CONCERN_AR.test(text);
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
export function extractInlineSlots(text: string): Partial<AgentSlots> {
  const found: Partial<AgentSlots> = {};
  if (!text.trim()) return found;

  const skinType = extractSkinType(text);
  if (skinType) found.skinType = skinType;

  // Pregnancy: only an explicit statement counts.
  const pregnant = readsPregnant(text);
  if (pregnant !== undefined) found.pregnantOrBreastfeeding = pregnant;

  // Allergies: an explicit "no allergies", or a named "allergic to X".
  if (NO_ALLERGIES.test(text) || NO_ALLERGIES_AR.test(text)) {
    found.allergies = [];
  } else {
    const named = ALLERGIC_TO.exec(text)?.[1] ?? ALLERGIC_TO_AR.exec(text)?.[1];
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
export function extractAllergies(text: string): string[] | undefined {
  if (readYesNo(text) === false) return [];
  const cleaned = text
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
    greeting: "Hi, I'm your AI skin advisor. Tell me what's going on with your skin or hair.",
    askConcern: "Tell me your main skin or hair concern.",
    askSkinType: "Got it. How would you describe your skin — oily, dry, combination, or sensitive?",
    askPregnancy: "Thanks. Before I suggest anything: are you pregnant or breastfeeding?",
    askAllergies: "And do you have any product or ingredient allergies? Say no if none.",
    building: "Perfect, building your routine now.",
    noProducts:
      "I couldn't find products in this store that pass the safety checks for what you told me. It may be worth speaking to a pharmacist.",
    noHairProducts:
      "That's a hair and scalp concern, and this store's catalogue is skincare only — so I'd be guessing if I recommended anything. For dandruff or hair fall, an anti-dandruff shampoo from a pharmacy is the right place to start, and a pharmacist can point you to one.",
    repeat: "Sorry, I didn't catch that.",
    understood: (summary: string) => `Got it — ${summary}.`,
    result: (count: number) =>
      `Here's a simple routine with ${count} product${count === 1 ? "" : "s"} matched from the store. I've kept it conservative — patch test anything new, and use sunscreen every morning.`,
  },
  ar: {
    greeting: "مرحباً، أنا مستشار البشرة الذكي. أخبرني ما الذي يزعجك في بشرتك أو شعرك.",
    askConcern: "أخبرني بمشكلتك الأساسية في البشرة أو الشعر.",
    askSkinType: "تمام. كيف تصف بشرتك — دهنية أم جافة أم مختلطة أم حساسة؟",
    askPregnancy: "شكراً. قبل أن أقترح أي شيء: هل أنتِ حامل أو مرضعة؟",
    askAllergies: "وهل لديك أي حساسية من منتجات أو مكونات؟ قل لا إذا لم يكن هناك.",
    building: "ممتاز، أبني روتينك الآن.",
    noProducts:
      "لم أجد منتجات في هذا المتجر تجتاز فحوصات السلامة بناءً على ما ذكرته. قد يكون من الأفضل استشارة صيدلي.",
    noHairProducts:
      "هذه مشكلة تتعلق بالشعر وفروة الرأس، وكتالوج هذا المتجر للعناية بالبشرة فقط — لذلك سأكون مخطئاً إن اقترحت منتجاً. لعلاج القشرة أو تساقط الشعر، ابدأ بشامبو مخصص من الصيدلية، ويمكن للصيدلي إرشادك.",
    repeat: "عذراً، لم أسمع ذلك بوضوح.",
    understood: (summary: string) => `تمام — ${summary}.`,
    result: (count: number) =>
      `هذا روتين بسيط يضم ${count} منتج مطابق من المتجر. أبقيته متحفظاً — جرّب المنتج على مساحة صغيرة أولاً، واستخدم واقي الشمس كل صباح.`,
  },
};

export function agentCopy(lang: AgentLang) {
  return COPY[lang];
}

/**
 * Merges a new utterance into the accumulated slots, given which question was
 * outstanding. Safety slots are only set from an explicit answer.
 */
export function updateSlots(slots: AgentSlots, utterance: string, lang: AgentLang): AgentSlots {
  const next: AgentSlots = { ...slots };
  const text = utterance.trim();
  if (!text) return next;

  if (!next.mainConcern) {
    next.mainConcern = text;
    // Take everything else the shopper volunteered in the same breath.
    return { ...next, ...extractInlineSlots(text) };
  }

  // Answers are interpreted against the question we actually asked last.
  if (next.askedPregnancy && next.pregnantOrBreastfeeding === undefined) {
    const answer = readPregnancyAnswer(text);
    if (answer !== undefined) {
      next.pregnantOrBreastfeeding = answer;
      return next;
    }
    // Unclear answer to a safety question: leave the slot empty so it is asked
    // again, and do NOT fold the misheard words into the concern.
    return next;
  }

  if (next.askedAllergies && next.allergies === undefined) {
    const allergies = extractAllergies(text);
    if (allergies !== undefined) {
      next.allergies = allergies;
      return next;
    }
    return next;
  }

  if (next.askedSkinType && !next.skinType) {
    const skinType = extractSkinType(text);
    if (skinType) {
      next.skinType = skinType;
      return next;
    }
    // Unrecognised description still moves the flow on rather than looping.
    next.skinType = "combination";
    return next;
  }

  // Otherwise treat it as more detail about the concern, still harvesting any
  // slots it happens to contain.
  next.mainConcern = `${next.mainConcern}. ${text}`;
  const inline = extractInlineSlots(text);
  if (inline.skinType && !next.skinType) next.skinType = inline.skinType;
  if (inline.pregnantOrBreastfeeding !== undefined && next.pregnantOrBreastfeeding === undefined) {
    next.pregnantOrBreastfeeding = inline.pregnantOrBreastfeeding;
  }
  if (inline.allergies !== undefined && next.allergies === undefined) next.allergies = inline.allergies;
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
