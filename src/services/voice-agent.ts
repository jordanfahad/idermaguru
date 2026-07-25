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

const SKIN_TYPES: { key: string; en: RegExp; ar: RegExp }[] = [
  { key: "oily", en: /\boily|greasy|shiny\b/i, ar: /دهني|دهنية/ },
  { key: "dry", en: /\bdry|dehydrated|tight\b/i, ar: /جاف|جافة/ },
  { key: "combination", en: /\bcombination|combo\b/i, ar: /مختلط|مختلطة/ },
  { key: "sensitive", en: /\bsensitive|reactive\b/i, ar: /حساس|حساسة/ },
  { key: "normal", en: /\bnormal\b/i, ar: /عادي|عادية/ },
];

const YES = /\b(yes|yeah|yep|yup|i am|correct|right|sure)\b/i;
const YES_AR = /نعم|أجل|ايوه|إيوه|صح/;
const NO = /\b(no|nope|nah|not|none|neither|negative)\b/i;
const NO_AR = /لا|كلا|ما في|مافي|ولا/;

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
    heard: (concern: string) => `Okay — ${concern}.`,
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
    heard: (concern: string) => `حسناً — ${concern}.`,
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
    const inlineSkinType = extractSkinType(text);
    if (inlineSkinType) next.skinType = inlineSkinType;
    return next;
  }

  // Answers are interpreted against the question we actually asked last.
  if (next.askedPregnancy && next.pregnantOrBreastfeeding === undefined) {
    const answer = readYesNo(text);
    if (answer !== undefined) {
      next.pregnantOrBreastfeeding = answer;
      return next;
    }
  }

  if (next.askedAllergies && next.allergies === undefined) {
    const allergies = extractAllergies(text);
    if (allergies !== undefined) {
      next.allergies = allergies;
      return next;
    }
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

  // Otherwise treat it as more detail about the concern.
  next.mainConcern = `${next.mainConcern}. ${text}`;
  const skinType = extractSkinType(text);
  if (skinType && !next.skinType) next.skinType = skinType;
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
