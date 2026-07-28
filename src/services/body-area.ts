import { normaliseTranscript } from "./text";

/**
 * Where on the body the concern is.
 *
 * "I have a rash" was answered with "How would you describe your skin — oily,
 * dry, combination, or sensitive?", which is a question about a face asked
 * about something that might be on a shin. A rash on the face, in a skin fold,
 * on the hands and between the toes are four different problems with four
 * different answers, and the shopper always knows which one they have.
 *
 * The areas are grouped by what changes the advice, not by anatomy: hands,
 * elbows and knees behave like each other and not like a cheek, so they are
 * separate entries only where the wording of the reply differs.
 */
export type BodyArea =
  | "face"
  | "neck"
  | "scalp"
  | "hands"
  | "underarms"
  | "elbows-knees"
  | "feet"
  | "intimate"
  | "body";

/**
 * Order matters. Intimate goes first so "inner thigh" is not read as a leg, and
 * the specific body parts go before the catch-all "body" so "my knuckles" is
 * not flattened into "somewhere on the body".
 */
const AREAS: { area: BodyArea; en: RegExp; ar: RegExp }[] = [
  {
    area: "intimate",
    en: /\b(bikini ?(line|area)?|groin|inner thighs?|vagina\w*|vulva|labia|genital\w*|pubic|private (parts?|area)|intimate (area|zone)|perineum|anus|anal|scrotum|testicles?|between my legs)\b/,
    ar: /المنطقة الحساسة|منطقة البكيني|الأربية|بين الفخذين|المهبل|العانة/,
  },
  {
    area: "underarms",
    en: /\b(under ?arms?|under (my|the) arms?|arm ?pits?|axilla\w*)\b/,
    ar: /الإبط|الابط|تحت الإبط|الإبطين/,
  },
  {
    area: "hands",
    en: /\b(hands?|knuckles?|fingers?|palms?|wrists?|fingertips?)\b/,
    ar: /اليد|اليدين|الأصابع|مفاصل الأصابع|الكف/,
  },
  {
    area: "elbows-knees",
    en: /\b(elbows?|knees?|kneecaps?)\b/,
    ar: /الكوع|الأكواع|الركبة|الركب/,
  },
  {
    area: "feet",
    en: /\b(feet|foot|toes?|heels?|soles?|ankles?)\b/,
    ar: /القدم|الأقدام|الكعب|أصابع القدم/,
  },
  {
    area: "scalp",
    en: /\b(scalp|hairline|roots)\b/,
    ar: /فروة|فروة الرأس|منابت الشعر/,
  },
  {
    area: "neck",
    en: /\b(neck|nape|d[eé]collet[eé]|collarbone)\b/,
    ar: /الرقبة|العنق/,
  },
  {
    area: "face",
    en: /\b(face|facial|cheeks?|forehead|chin|nose|jaw ?line|jaw|t ?zone|under ?eyes?|eyelids?|around my eyes|temples?)\b/,
    ar: /الوجه|وجهي|الخد|الجبين|الذقن|الأنف|حول العين/,
  },
  {
    area: "body",
    en: /\b(body|back|chest|shoulders?|stomach|belly|torso|legs?|thighs?|shins?|calves|calf|arms?|forearms?|buttocks?|bum|hips?|waist|all over|everywhere|everywhere else)\b/,
    ar: /الجسم|الظهر|الصدر|الكتف|البطن|الساق|الفخذ|الذراع/,
  },
];

/** The area named in an utterance, or undefined when none is. */
export function extractBodyArea(input: string): BodyArea | undefined {
  const text = normaliseTranscript(input);
  if (!text) return undefined;
  for (const entry of AREAS) {
    if (entry.en.test(text) || entry.ar.test(input)) return entry.area;
  }
  return undefined;
}

/**
 * Symptoms whose answer depends entirely on where they are. A rash, a dark
 * patch or a bout of dryness is a different conversation on a cheek, a knuckle
 * and a skin fold.
 */
const LOCATION_DEPENDENT =
  /\b(rash\w*|hives?|itch\w*|scratch\w*|dark\w*|discolou?r\w*|pigment\w*|uneven|blotch\w*|patch\w*|bumps?|bumpy|lumps?|spots?|dry\w*|flak\w*|peel\w*|crack\w*|redness|irritat\w*|rough\w*|thick\w*|scars?|stretch ?marks?|eczema|psoriasis|ingrown|chaf\w*|calluses?|callus|sweat\w*|odou?r|blister\w*)\b/;

/**
 * Concerns that are about a face by definition. Asking a shopper who said
 * "blackheads on my nose" where their blackheads are is the kind of question
 * that makes a person close the widget.
 */
const INHERENTLY_FACIAL =
  /\b(acne|pimples?|blackheads?|whiteheads?|pores?|wrinkles?|fine lines?|crows ?feet|dark circles?|dark spots?|eye bags?|under ?eyes?|t ?zone|complexion|melasma|double chin|beard|shav\w*|makeup|foundation|dull\w*|glow\w*|radian\w*|skin tone|even tone)\b/;

/**
 * Should we ask where it is before anything else?
 *
 * Only when the concern names a symptom that moves around, does not already say
 * where it is, and is not facial by definition. Everything else goes straight
 * to the questions it always asked, so the common path gains no new step.
 */
export function needsBodyArea(concern: string | undefined): boolean {
  if (!concern) return false;
  const text = normaliseTranscript(concern);
  if (!text) return false;
  if (extractBodyArea(text)) return false;
  if (INHERENTLY_FACIAL.test(text) || namesSkinType(text)) return false;
  return LOCATION_DEPENDENT.test(text);
}

/**
 * "My skin is dry" is a shopper describing a face. "Dry patches for years" is
 * not, and the ordinary skin-type reader cannot tell them apart — it finds
 * "dry" in both, which is right for ranking and wrong for this. The word has to
 * be attached to the skin itself.
 */
const SKIN_TYPE_PHRASE =
  /\b(oily|dry|combination|combo|sensitive|normal|dehydrated)\s+skin\b|\bskin\s+(is|are|gets|feels|seems|becomes)\s+(really |very |quite |so |a bit )?(oily|dry|combination|sensitive|normal|dehydrated)\b/;
const SKIN_TYPE_PHRASE_AR = /(بشرة|بشرتي|جلدي)\s*(دهنية|جافة|مختلطة|حساسة|عادية)/;

export function namesSkinType(text: string): boolean {
  return SKIN_TYPE_PHRASE.test(normaliseTranscript(text)) || SKIN_TYPE_PHRASE_AR.test(text);
}

/**
 * Which pipeline an area belongs to.
 *
 * "face" also covers the neck, because the neck is served by the same products
 * and telling a shopper otherwise would be inventing a distinction.
 */
export function areaRoute(area: BodyArea | undefined): "face" | "hair" | "body" | "intimate" {
  if (area === "intimate") return "intimate";
  if (area === "scalp") return "hair";
  if (!area || area === "face" || area === "neck") return "face";
  return "body";
}

/** How the advisor refers to the area out loud. */
const AREA_LABEL: Record<BodyArea, { en: string; ar: string }> = {
  face: { en: "your face", ar: "وجهك" },
  neck: { en: "your neck", ar: "رقبتك" },
  scalp: { en: "your scalp", ar: "فروة رأسك" },
  hands: { en: "your hands", ar: "يديك" },
  underarms: { en: "your underarms", ar: "منطقة الإبط" },
  "elbows-knees": { en: "your elbows and knees", ar: "الكوعين والركبتين" },
  feet: { en: "your feet", ar: "قدميك" },
  intimate: { en: "that area", ar: "تلك المنطقة" },
  body: { en: "your body", ar: "جسمك" },
};

export function areaLabel(area: BodyArea, lang: "en" | "ar"): string {
  return AREA_LABEL[area][lang];
}
