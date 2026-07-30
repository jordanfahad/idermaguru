import { normaliseTranscript, type AgentLang } from "./text";

/**
 * Who the advice is actually for, and how old they are.
 *
 * From a live session:
 *
 *   You      My neighbor's daughter has dandruff
 *   Advisor  Got it. One safety check — a few ingredients aren't advised in
 *            pregnancy or breastfeeding. Does either apply to you?
 *   You      She's four years old
 *   Advisor  That one's outside my world, I'm afraid.
 *
 * Two failures in four lines. It asked a shopper whether *they* were pregnant
 * about a product for somebody else's child, and then a stated age of four was
 * classified as a tangent and thrown away.
 *
 * The safety triage has always had an under-18 rule. Nothing ever populated
 * `ageRange` from a conversation, so it could not fire — a four-year-old could
 * be handed a salicylic acid routine.
 */

const RELATION =
  "(?:son|daughter|kid|child|baby|boy|girl|mum|mother|dad|father|wife|husband|partner|friend|sister|brother|niece|nephew|grandmother|grandfather|grandma|grandad|granddaughter|grandson|cousin|colleague|neighbou?r)";

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20,
};

const WORD_NUMBER = Object.keys(NUMBER_WORDS).join("|");

/**
 * Age is only read where the sentence is plainly about an age. A bare number is
 * never enough — "a simple glow routine under AED 200" and "I use it 3 times a
 * week" are not ages.
 */
const AGE_PATTERNS: RegExp[] = [
  new RegExp(`\\b(\\d{1,2}|${WORD_NUMBER})[\\s-]*(?:years?|yrs?|yo)[\\s-]*old\\b`),
  new RegExp(`\\ba\\s+(\\d{1,2}|${WORD_NUMBER})[\\s-]*(?:years?|yr)[\\s-]*old\\b`),
  new RegExp(`\\b(?:aged?|age(?:\\s+is)?)\\s+(\\d{1,2}|${WORD_NUMBER})\\b`),
  new RegExp(`\\b(?:she|he|they|i|we)(?:'s|'re|'m| is| are| am)\\s+(\\d{1,2}|${WORD_NUMBER})\\b(?!\\s*(?:times|weeks?|months?|days?|hours?|minutes?|percent|%|aed|usd|eur))`),
  new RegExp(`\\b(?:turning|turns|just turned)\\s+(\\d{1,2}|${WORD_NUMBER})\\b`),
  // "my son is 7" — a named subject rather than a pronoun. Tied to the relation
  // list so "my routine is 4 steps" cannot be read as somebody aged four.
  new RegExp(`\\bmy\\s+(?:\\w+'?s?\\s+)?${RELATION}\\s+(?:is|just turned|turns|turned)\\s+(\\d{1,2}|${WORD_NUMBER})\\b`),
];

/** Words that name a young child without naming a number. */
const VERY_YOUNG = /\b(?:newborn|new born|infant|toddler|my baby|a baby|the baby|nursery|preschool|kindergarten)\b/;

/**
 * The person's age in years, or undefined when the sentence does not state one.
 */
export function readsAge(input: string): number | undefined {
  const text = normaliseTranscript(input);
  if (!text) return undefined;

  for (const pattern of AGE_PATTERNS) {
    const match = pattern.exec(text);
    const raw = match?.[1];
    if (!raw) continue;
    const value = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw];
    if (Number.isFinite(value) && value > 0 && value <= 120) return value;
  }

  // "my baby has cradle cap" states an age well enough for the only decision
  // that turns on it.
  if (VERY_YOUNG.test(text)) return 2;
  return undefined;
}

/**
 * Is the shopper asking on somebody else's behalf?
 *
 * Matters because every question this advisor asks is written in the second
 * person. "Does either apply to you?" is the wrong question when the person
 * using the product is a four-year-old down the road.
 */
const THIRD_PARTY = new RegExp(
  `\\bmy\\s+(?:\\w+'?s?\\s+)?${RELATION}\\b|\\bfor\\s+(?:my|her|his|their)\\s+(?:\\w+'?s?\\s+)?${RELATION}\\b|\\bfor\\s+(?:a|my)\\s+friend\\b`,
);

export function readsThirdParty(input: string): boolean {
  return THIRD_PARTY.test(normaliseTranscript(input));
}

/**
 * The age below which this advisor stops and sends them to a person.
 *
 * Set to 10 by the owner. Above it the ordinary flow runs, so a teenager with
 * acne — one of the most common shoppers there is — gets helped rather than
 * turned away. Below it the products simply are not formulated or tested for
 * that skin, and no amount of careful questioning changes that.
 *
 * Configurable per deployment, because the right line is a legal and
 * commercial judgement that differs by market rather than a fact about skin.
 */
export const MIN_ADVICE_AGE = (() => {
  const configured = Number(process.env.ADVISOR_MIN_AGE);
  return Number.isInteger(configured) && configured >= 0 && configured <= 25 ? configured : 10;
})();

export function isChild(age: number | undefined): boolean {
  return age !== undefined && age < MIN_ADVICE_AGE;
}

const CHILD_COPY: Record<AgentLang, (age: number, other: boolean) => string> = {
  en: (age, other) =>
    age <= 12
      ? `Ah — ${age} changes it, I'm afraid. Children's skin genuinely is not adult skin, and everything this store stocks is formulated and tested for adults, so anything I picked would be a guess. A pharmacist or ${other ? "her doctor" : "their doctor"} can look properly and suggest something made for that age. I'm sorry not to be more use.`
      : `Ah — at ${age} I'd want a pharmacist to have the final say rather than me. This store's products are formulated for adults, and I'm not set up to advise anyone under ${MIN_ADVICE_AGE} without a parent or guardian in the conversation. A pharmacy counter is a good next stop, and they'll be able to help properly.`,
  ar: (age, other) =>
    age <= 12
      ? `آه — عمر ${age} يغيّر الأمر للأسف. بشرة الأطفال ليست كبشرة البالغين، وكل ما يوفّره هذا المتجر مُصمّم ومُختبر للبالغين، لذلك سيكون أي اقتراح مني تخميناً. يمكن لصيدلي أو ${other ? "طبيبها" : "طبيبه"} الفحص واقتراح ما يناسب هذا العمر. آسف لعدم قدرتي على المساعدة أكثر.`
      : `آه — في عمر ${age} أفضّل أن يكون القرار للصيدلي وليس لي. منتجات هذا المتجر مخصصة للبالغين، ولستُ مهيّأ لتقديم النصح لمن هم دون ${MIN_ADVICE_AGE} دون وجود ولي أمر. الصيدلية محطة تالية جيدة وسيساعدونك بشكل صحيح.`,
};

export function childCopy(age: number, lang: AgentLang, forSomeoneElse: boolean): string {
  return CHILD_COPY[lang](age, forSomeoneElse);
}
