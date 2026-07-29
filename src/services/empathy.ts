import { normaliseTranscript, type AgentLang } from "./text";

/**
 * How the advisor reacts to what it was just told.
 *
 * A shopper who says "I have a bullet wound" was answered with "Just to be
 * clear, I only cover skin and hair here." — factually true, and a horrible
 * thing to say to someone. Whatever else an advisor gets wrong, it has to sound
 * like it heard you.
 *
 * Two separable things live here. `classifyDistress` decides whether the
 * conversation should stop and point somewhere better, and is deterministic on
 * purpose: it is the one reaction that must never depend on a model being
 * reachable. `readFeeling` decides the tone of the sentence in front of the next
 * question, and is allowed to find nothing at all — a flat "Got it." is a fine
 * answer to a flat statement, and manufactured sympathy is worse than none.
 */

/**
 * Life-threatening right now. There is nothing to discuss and nothing to sell;
 * the only useful sentence is the one that gets them to help.
 */
const EMERGENCY = [
  /\b(bullet|gunshot|gun shot)\b|\bshot (in|through) (the|my)\b|\bbeen shot\b/,
  /\bstabbed?\b|\bstab wound\b|\bknife wound\b/,
  /\b(can'?t|cannot|struggling to|trouble) breath\w*\b|\bnot breathing\b|\bchoking\b/,
  /\bunconscious\b|\bpassed out\b|\bblacked out\b|\bwon'?t wake up\b|\bunresponsive\b/,
  /\bseizure\b|\bconvuls\w*\b|\bhaving a fit\b/,
  // "poison ivy" is a rash, not a poisoning, and "fitting" is an ordinary word
  // a shopper uses about a cream — both were caught by a looser version of this.
  /\boverdos\w*\b|\bpoisoned\b|\bswallowed (bleach|acid|chemicals?|pills)\b/,
  /\bheart attack\b|\b(had|having) a stroke\b|\bmini stroke\b|\bchest pain\b/,
  /\bbleeding (badly|heavily|a lot)\b|\bwon'?t stop bleeding\b|\bblood everywhere\b|\bhaemorrhag\w*\b|\bhemorrhag\w*\b/,
  /\bthird degree burn\b|\bchemical burn\b|\bsevere burn\b|\bon fire\b|\bscalded\b/,
  /\bsnake ?bite\b|\bbitten by a (snake|dog)\b/,
  /\banaphyla\w*\b/,
];

/**
 * Serious, not necessarily a 999 call, and still nothing a skincare advisor can
 * do: a hospital or clinic today rather than an ambulance now.
 */
const URGENT_CARE = [
  /\bbroken\b[^.]{0,20}\b(arm|leg|bone|wrist|ankle|finger|toe|rib|nose|collarbone|hip|foot|hand)\b/,
  /\b(arm|leg|bone|wrist|ankle|finger|toe|rib|nose|collarbone|hip|foot|hand)\b[^.]{0,20}\bbroken\b/,
  // "I broke my wrist" is how people actually say it, and none of the above
  // matched it.
  /\bbroke (my|his|her|their|the) (arm|leg|bone|wrist|ankle|finger|toe|rib|nose|collarbone|hip|foot|hand)\b/,
  /\bfractur\w*\b|\bdislocat\w*\b|\btorn ligament\b/,
  /\bdeep cut\b|\bdeep gash\b|\bneeds? stitches\b|\bsliced (my|the)\b/,
  /\bcar (crash|accident)\b|\bhit by a\b|\bbad fall\b|\bfell (down|off) (the|a|my)\b/,
  /\bconcussion\b|\bhead injury\b/,
  /\bcompound (fracture|break)\b/,
  // Not a bare "bitten by": a mosquito bite is a skin complaint, and this used
  // to send it to a hospital.
  /\banimal bite\b|\bbitten by a (dog|cat|snake|rat|animal|monkey)\b/,
];

/**
 * Someone telling a shopping assistant they want to hurt themselves is not a
 * tangent and is not a skincare question. It gets a human answer and a place to
 * go, not a redirect back to the product catalogue.
 */
const CRISIS = [
  /\b(kill|hurt|harm|cut) myself\b/,
  /\bsuicid\w*\b|\bend my life\b|\bdon'?t want to (live|be here)\b|\bwant to die\b/,
  /\bself[- ]harm\w*\b/,
];

/**
 * Somebody else is in danger, and the shopper is the one who can call for help.
 *
 * Every pattern above is written in the first person — "I have", "kill myself"
 * — so "My friend just jumped out of the balcony" matched none of them and was
 * answered with "That one's outside my world, I'm afraid." A person reporting
 * someone else's emergency needs the same answer as a person in one, aimed at
 * the right patient.
 */
const RELATION =
  "(?:friend|mum|mother|dad|father|son|daughter|wife|husband|brother|sister|baby|child|kid|neighbou?r|colleague|partner|nan|grandmother|grandfather|granddad|cousin)";

const BYSTANDER = [
  // From a height. "my hair fell out" must not match, so a fall needs somewhere
  // to have fallen from.
  /\bjump(?:ed|ing)?\s+(?:out of|off|from|over)\b/,
  /\bfell\s+(?:out of|off|from)\s+(?:a |the |my |his |her |their )?(?:balcony|window|roof|ladder|stairs|staircase|building|bridge|scaffold)/,
  /\b(?:balcony|window|roof|bridge|building)\b[^.]{0,20}\bjump/,
  new RegExp(`\\b(?:someone|somebody|he|she|they|my ${RELATION})\\b[^.]{0,40}\\b(?:jumped|collapsed|unconscious|not breathing|stopped breathing|overdosed|drowning|is bleeding|been stabbed|been shot|was hit by)\\b`),
  new RegExp(`\\bmy ${RELATION}\\b[^.]{0,30}\\b(?:fell|is hurt|is injured|had an accident|had a fall)\\b`),
  /\b(?:he|she|they|someone|somebody)\s+(?:has |just |is )?collapsed\b/,
];

export type Distress = "emergency" | "urgent-care" | "crisis" | "bystander";

/**
 * Something that needs a person, not a product. Returns null for everything
 * else, including ordinary skin complaints — the safety triage already covers
 * the clinical ones and runs before this.
 */
export function classifyDistress(input: string): Distress | null {
  const text = normaliseTranscript(input);
  if (!text) return null;
  if (CRISIS.some((pattern) => pattern.test(text))) return "crisis";
  // Before the first-person tiers: "my friend was shot" is about the friend.
  if (BYSTANDER.some((pattern) => pattern.test(text))) return "bystander";
  if (EMERGENCY.some((pattern) => pattern.test(text))) return "emergency";
  if (URGENT_CARE.some((pattern) => pattern.test(text))) return "urgent-care";
  return null;
}

/**
 * Bad news that is not an emergency and is not about skin.
 *
 * "My dog died" was answered "That one's outside my world, I'm afraid — skin
 * and hair are what I know." Nothing about that is wrong and all of it is
 * horrible. This is not a referral and does not end the conversation; it is the
 * sentence a person says before carrying on.
 */
export type Sorrow = "grief" | "misfortune";

/**
 * Written so speech-to-text cannot manufacture it. "I dyed my hair" transcribes
 * as "I died my hair" constantly, so a bare "died" is not enough — the thing
 * that died has to be somebody.
 */
const GRIEF = new RegExp(
  `\\b(?:passed away|passed on|funeral|lost my ${RELATION}|lost my (?:dog|cat|pet))\\b` +
    `|\\bmy (?:${RELATION}|dog|cat|pet)\\b[^.]{0,20}\\b(?:died|dying|passed)\\b`,
);

const MISFORTUNE =
  /\b(?:after the accident|had an accident|car crash|in hospital|in the hospital|got (?:mugged|robbed|attacked)|house (?:fire|burned)|lost my job|going through a divorce|really tough time)\b/;

export function readsSorrow(input: string): Sorrow | null {
  const text = normaliseTranscript(input);
  if (!text) return null;
  if (GRIEF.test(text)) return "grief";
  if (MISFORTUNE.test(text)) return "misfortune";
  return null;
}

const SORROW_COPY: Record<AgentLang, Record<Sorrow, string>> = {
  en: {
    grief:
      "Oh no — I'm so sorry. That's a horrible thing to happen, and I'm sorry you're carrying it. I'm only a shop's skin advisor so I'm no use for that part, but I'm here whenever you want to talk about your skin or hair.",
    misfortune:
      "I'm sorry — that sounds like a lot to be dealing with. I can't help with the bigger part of it, but I'm here for the skin and hair side whenever you want.",
  },
  ar: {
    grief:
      "يؤسفني ذلك حقاً. هذا أمر مؤلم، وآسف لأنك تمرّ به. أنا مجرد مستشار بشرة في متجر ولا أفيدك في هذا الجانب، لكنني هنا متى أردت الحديث عن بشرتك أو شعرك.",
    misfortune:
      "يؤسفني ذلك — يبدو أنك تتحمّل الكثير. لا أستطيع المساعدة في الجزء الأكبر، لكنني هنا لما يخص البشرة والشعر متى شئت.",
  },
};

export function sorrowCopy(kind: Sorrow, lang: AgentLang): string {
  return SORROW_COPY[lang][kind];
}

/**
 * The short version, for when the shopper mentioned the bad thing AND what they
 * want help with in the same breath — "I have scars after the accident".
 *
 * The full line above says "I can't help with the bigger part of it", which is
 * the wrong answer to somebody who has just asked a question we can answer. So
 * this acknowledges it and gets on with helping.
 */
const SORROW_LEAD: Record<AgentLang, Record<Sorrow, string>> = {
  en: {
    grief: "I'm so sorry.",
    misfortune: "I'm sorry you've been through that.",
  },
  ar: {
    grief: "يؤسفني ذلك حقاً.",
    misfortune: "يؤسفني ما مررت به.",
  },
};

export function sorrowLead(kind: Sorrow, lang: AgentLang): string {
  return SORROW_LEAD[lang][kind];
}

/**
 * What to dial, when the operator knows.
 *
 * 999 is right in the UAE and wrong nearly everywhere else, and this is sold as
 * a SaaS — a merchant in Berlin whose shopper is told to call 999 is worse off
 * than one who was told nothing. So the number is a setting, the copy works
 * without it, and the default names no digits at all.
 *
 * Set the whole phrase, not just the digits: ADVISOR_EMERGENCY_NUMBER="999 in
 * the UAE" or "112" or "911". It is appended as its own short sentence.
 */
function emergencyDial(): string {
  const configured = (process.env.ADVISOR_EMERGENCY_NUMBER ?? "").trim();
  return configured ? ` ${configured.replace(/\.$/, "")}.` : "";
}

const DISTRESS_COPY_BASE: Record<AgentLang, Record<Distress, string>> = {
  en: {
    // Shock first, then the instruction. Somebody reading this is frightened,
    // and a sentence that opens by explaining our scope reads as indifference.
    bystander:
      "Oh no — please call emergency services right now, before anything else.{DIAL} I'm only a shop's skin advisor and I'm not who you need for this. If you can, stay with them until help gets there.",
    emergency:
      "Oh no — I'm so sorry, that sounds serious. Please call emergency services now, or get to the nearest hospital.{DIAL} This is well past anything I can help with, and it shouldn't wait on me.",
    "urgent-care":
      "Oh no — I'm really sorry to hear that. That's not something I can help with, I'm afraid. The best thing you can do is call emergency services, or get to a hospital or a clinic near you and have it looked at properly.",
    crisis:
      "I'm really glad you said something, and I'm sorry you're carrying that. I'm only a shop's skin advisor, so I'm not the right help here — but please talk to someone who is, today: a doctor, a crisis line, or someone close to you. You shouldn't have to sit with it on your own.",
  },
  ar: {
    bystander:
      "يا إلهي — اتصل بالطوارئ الآن قبل أي شيء آخر.{DIAL} أنا مجرد مستشار بشرة في متجر ولستُ من تحتاجه هنا. وإن استطعت، ابقَ معه حتى تصل المساعدة.",
    emergency:
      "يؤسفني ذلك حقاً — ما تصفه خطير. اتصل بالطوارئ الآن أو توجّه إلى أقرب مستشفى.{DIAL} هذا يتجاوز ما يمكنني المساعدة فيه، ولا يجب أن ينتظرني.",
    "urgent-care":
      "يؤسفني سماع ذلك حقاً. للأسف هذا ليس شيئاً أستطيع مساعدتك فيه. الأفضل أن تتصل بالطوارئ أو تزور مستشفى أو عيادة قريبة ليفحصه مختص.",
    crisis:
      "سعيد لأنك قلت ذلك، ويؤسفني ما تمرّ به. أنا مجرد مستشار بشرة في متجر ولست الجهة المناسبة هنا — لكن أرجو أن تتحدث اليوم مع من يستطيع المساعدة: طبيب، أو خط دعم، أو شخص قريب منك. لا يجب أن تواجه هذا وحدك.",
  },
};

export function distressCopy(kind: Distress, lang: AgentLang): string {
  return DISTRESS_COPY_BASE[lang][kind].replace("{DIAL}", emergencyDial());
}

/**
 * The emotional weight of what the shopper just said.
 *
 * Only what the words actually carry. Reading "worried" into "I want a glow
 * routine" so that every turn opens with sympathy is how an assistant starts
 * sounding like a greetings card.
 */
export type Feeling = "sore" | "frustrated" | "self-conscious" | "worried" | "amused";

const SORE = /\b(hurts?|painful|stings?|stinging|burns?|burning|sore|raw|itch\w*|agony|uncomfortable|unbearable)\b/;
const FRUSTRATED =
  /\b(tried everything|nothing works|nothing helps|nothing worked|for years|for months|so tired of|sick of|fed up|giving up|desperate|frustrat\w*|driving me (mad|crazy)|no idea what to do)\b/;
const SELF_CONSCIOUS =
  /\b(embarrass\w*|ashamed|self ?conscious|hide it|hiding it|don'?t want to go out|too shy|awkward to ask|weird question|sorry to ask|is this gross)\b/;
const WORRIED = /\b(worried|worries me|scared|frightened|anxious|nervous|is it serious|should i be concerned|freaking out)\b/;
const AMUSED = /\b(ha ?ha+|lol|haha+|😂|🤣|just kidding|joking|kidding)\b/;
/**
 * Complaints that are uncomfortable by definition, whether or not the shopper
 * said so. "I have a rashes" carries no feeling word and was answered "Got it."
 * — nobody has ever been pleased about a rash, and it costs nothing to say so.
 * Deliberately excludes the flat ones: "I have acne" is a statement of fact and
 * being commiserated with over it is patronising.
 */
const UNPLEASANT =
  /\b(rash\w*|hives?|itch\w*|itchy|flare ?ups?|flaring|peeling|cracked|cracking|blister\w*|inflamed|swollen|chaf\w*|ingrown|eczema|psoriasis|dermatitis)\b/;

export function readFeeling(input: string): Feeling | null {
  const text = normaliseTranscript(input);
  if (!text) return null;
  if (AMUSED.test(text) || /😂|🤣/.test(input)) return "amused";
  if (SELF_CONSCIOUS.test(text)) return "self-conscious";
  if (WORRIED.test(text)) return "worried";
  if (FRUSTRATED.test(text)) return "frustrated";
  if (SORE.test(text) || UNPLEASANT.test(text)) return "sore";
  return null;
}

const FEELING_COPY: Record<AgentLang, Record<Feeling, string>> = {
  en: {
    sore: "Ah, that sounds really uncomfortable — sorry you're dealing with it.",
    frustrated: "That's exhausting, and I'm sorry — it's miserable when nothing seems to shift it.",
    "self-conscious": "Nothing to be shy about — I get asked this more than you'd think.",
    worried: "That's a reasonable thing to worry about, and I'd rather you asked than sat on it.",
    amused: "Ha — alright, noted.",
  },
  ar: {
    sore: "يبدو هذا مزعجاً فعلاً — يؤسفني أنك تمرّ به.",
    frustrated: "هذا مُرهق، ويؤسفني ذلك — من الصعب ألا يتحسّن شيء رغم المحاولات.",
    "self-conscious": "لا داعي للحرج — يُسألني هذا كثيراً أكثر مما تتصوّر.",
    worried: "قلقك في محلّه، وأفضّل أن تسأل بدل أن تُبقيه في نفسك.",
    amused: "ها — حسناً، فهمت.",
  },
};

export function feelingCopy(feeling: Feeling, lang: AgentLang): string {
  return FEELING_COPY[lang][feeling];
}

/**
 * The sentence that goes in front of the next question.
 *
 * Returns "" rather than filler when the utterance carries no feeling, so the
 * caller can fall back to its own plain acknowledgement.
 */
export function reactionTo(input: string, lang: AgentLang): string {
  const feeling = readFeeling(input);
  return feeling ? feelingCopy(feeling, lang) : "";
}

/**
 * Guard for a model-written reaction.
 *
 * The model is asked for one human sentence and nothing else, but a model asked
 * for one sentence will sometimes hand back a question, a product, or a
 * diagnosis. Anything that isn't plainly a reaction is dropped and the
 * deterministic line is used instead — the reaction is a nicety, and a nicety
 * is never worth a compliance risk.
 */
const NOT_A_REACTION =
  /\?|\b(recommend|suggest|try |use |apply|serum|cleanser|moisturi[sz]er|sunscreen|product|routine|you (have|might have|may have)|sounds like (eczema|psoriasis|rosacea|an infection))\b/i;

export function usableReaction(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ").replace(/^["'“]|["'”]$/g, "");
  if (!clean || clean.length > 140) return "";
  if (NOT_A_REACTION.test(clean)) return "";
  // One or two sentences. Anything longer is the model writing an answer.
  if (clean.split(/[.!]\s/).length > 2) return "";
  return clean;
}

export const REACTION_PROMPT =
  "You are a warm, human shop assistant. The shopper has just told you something. " +
  "Reply with ONE short sentence reacting to it as a person would — sympathy, concern, " +
  "warmth, or light humour if they were joking. Do not ask a question. Do not give advice. " +
  "Do not mention any product, ingredient or routine. Do not name any medical condition. " +
  "Do not repeat their words back. Reply with the sentence only.";
