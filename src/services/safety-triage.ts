import {
  ESCALATION_MESSAGE,
  OUTPUT_GATE_FALLBACK_MESSAGE,
  type IntakeProfileInput,
  type SafetyLevel,
  type SafetyTriage,
} from "@/domain/skincare";
import { expandSearchText } from "@/data/search-keywords";
import { MIN_ADVICE_AGE } from "@/services/audience";

const urgentPatterns = [
  /trouble breathing|cannot breathe|can't breathe|difficulty breathing|breathing difficulty/i,
  /swelling.*(lips|tongue|face|throat|eyes)|(?:lips|tongue|face|throat|eyes).*swelling/i,
  /fainting|anaphylaxis|severe allergic reaction/i,
  /fever.*rash|rash.*fever/i,
  /rapidly spreading redness|redness.*rapidly spreading/i,
  /severe pain|unbearable pain/i,
  /eye.*(pain|swelling)|(?:pain|swelling).*eye/i,
  /chemical burn|severe burn/i,
  /serious infection|spreading infection/i,
  // Cyanosis: blue lips, fingers or nails is a circulation/oxygen emergency,
  // not a complexion concern.
  /(lips?|fingers?|nails?|tongue|hands?|feet)\b[^.]{0,25}\b(blue|bluish|purple)\b/i,
  /\b(turning|going|gone)\s+blue\b/i,
];

// Discolouration and bruising. These can be trauma, a bleeding or circulatory
// problem, or a medication effect - none of which a shopping assistant should
// answer with a serum. "blue patching skin" reached a product routine before
// this existed. Known cosmetic uses of the word blue are excluded below.
const bruisingPatterns = [
  /\bbruis(?:e|es|ed|ing)\b/i,
  /\b(blue|purple|violet|blackish)\b[^.]{0,25}\b(patch|patches|patching|blotch|blotches|mark|marks|spot|spots|area|areas|skin)\b/i,
  /\b(patch|patches|blotch|blotches|mark|marks|spot|spots)\b[^.]{0,25}\b(blue|purple|violet)\b/i,
  /\bblack and blue\b/i,
  /\bwelts?\b/i,
  /\bunexplained (?:marks?|bruis|spots?)/i,
];

// Cosmetic ingredients and product names that legitimately contain "blue".
const cosmeticBlue = /blue\s?(?:berry|tansy|light|clay|lagoon|agave|chamomile)|butterfly pea/i;

const referPatterns = [
  // Moles: match conversational phrasing, not just adjacent words. People say
  // "a mole that changed colour and is bleeding", which rigid pairs like
  // "mole changed" miss entirely. Allow filler words on either side.
  /\bmoles?\b[\s\S]{0,60}?(chang|bleed|grow|irregular|asymmetric|itch|scab|multiple colou?rs|new colou?r)/i,
  /(chang|bleed|grow|irregular|asymmetric|suspicious)[\s\S]{0,60}?\bmoles?\b/i,
  // Bleeding or non-healing skin is a referral regardless of the word order.
  /\bbleed(?:s|ing)?\b/i,
  /(won'?t|does ?n'?t|not)\s+heal|non[- ]healing|never heals/i,
  /rapidly growing.*(pigmented|spot|lesion|mole)/i,
  /pus|abscess|open wound/i,
  /painful cystic acne|painful cysts|nodular acne|severe acne/i,
  /acne.*causing scarring|active acne.*scarring/i,
  /worsening rash|widespread rash|rash.*widespread/i,
  /suspected infection|looks infected|skin infection/i,
  // "I have a cancerous pigment" matched nothing while this demanded the exact
  // phrase "skin cancer", and the shopper was asked whether their skin is oily.
  // Any mention of malignancy is a referral, however it is worded.
  /\b(cancer|cancerous|carcinoma|melanoma|malignan\w*|tumou?r|biopsy|precancerous|pre-cancerous)\b/i,
  /fungal infection/i,
  // Systemic symptoms are not cosmetic and are not tangents either. Feeling
  // nauseous used to be answered with "I only cover skin and hair here".
  /\b(nause\w*|vomit\w*|throwing up|dizz\w*|faint\w*|light[- ]headed|short of breath|chest pain|palpitation\w*)\b/i,
  /\b(numb\w*|tingling|weakness)\b[^.]{0,30}\b(arm|leg|face|hand|foot|side)\b/i,
  /diagnos(?:e|is).*(eczema|psoriasis|rosacea|melasma|fungal acne|infection|rash)|(?:eczema|psoriasis|rosacea|melasma|fungal acne|infection|rash).*diagnos(?:e|is)/i,
  /diagnos(?:e|is)|what disease|what condition/i,
  /prescription|antibiotic|steroid|isotretinoin|accutane|hydroquinone|oral medication|injection|tretinoin/i,
];

const cautionPatterns = [
  /allergic reaction|allergy|allergic/i,
  /strong active|retinol|retinoid|retinal|adapalene|acid|peel|bleaching/i,
  /prescription skin treatment|using prescription/i,
  /severe irritation|burns after products|skin burns|compromised barrier|barrier damage/i,
  /pregnant|pregnancy|breastfeeding|nursing/i,
  /eczema|eczma|psoriasis|psoriosis|rosacea|fungal acne|itchy skin|dry rash|skin peeling|flaky skin|skin reaction|rash after|burning after|stinging/i,
];

export function runSafetyTriage(profile: IntakeProfileInput): SafetyTriage {
  const text = normalizeProfileText(profile);
  const reasons: string[] = [];

  for (const pattern of urgentPatterns) {
    if (pattern.test(text)) {
      reasons.push(`Matched urgent red flag: ${pattern.source}`);
    }
  }

  if (reasons.length > 0) {
    return buildResult("URGENT", reasons, false);
  }

  if (!cosmeticBlue.test(text)) {
    for (const pattern of bruisingPatterns) {
      if (pattern.test(text)) {
        reasons.push(`Matched discolouration/bruising red flag: ${pattern.source}`);
      }
    }
  }

  for (const pattern of referPatterns) {
    if (pattern.test(text)) {
      reasons.push(`Matched clinician referral red flag: ${pattern.source}`);
    }
  }

  if (profile.ageRange && belowAdviceAge(profile.ageRange)) {
    reasons.push(`User appears to be under ${MIN_ADVICE_AGE}; products here are formulated for older skin.`);
  }

  if (reasons.length > 0) {
    return buildResult("REFER_CLINIC", reasons, false);
  }

  for (const pattern of cautionPatterns) {
    if (pattern.test(text)) {
      reasons.push(`Matched caution signal: ${pattern.source}`);
    }
  }

  if (profile.prescriptionUse) reasons.push("User reports prescription skin treatment use.");
  if (profile.pregnantOrBreastfeeding) reasons.push("Pregnancy or breastfeeding reported.");
  if ((profile.allergies ?? []).length > 0) reasons.push("Known allergy information provided.");
  if (Number(profile.severitySelfRated ?? 0) >= 7) reasons.push("High self-rated severity.");

  if (reasons.length > 0) {
    return buildResult("CAUTION", reasons, true);
  }

  return {
    level: "LOW",
    reasons: ["No red flags detected in the provided OTC skincare intake."],
    recommendationAllowed: true,
  };
}

// Prohibited assistant-output claims (spec §3.3). Disease names asserted as a
// conclusion ("you have rosacea") are already caught by re-running the triage on
// the output; these patterns add the cases triage misses: cure claims, guaranteed
// results, and treat/prevent/heal promises tied to a condition. They target claim
// *constructions* — e.g. "\btreat(s|ing|ed)?\b" does not match the noun
// "treatment", so a legitimate "evening treatment" routine line passes through.
const prohibitedOutputClaimPatterns = [
  /\bcure[sd]?\b|\bcuring\b/i,
  /\bguarantee[sd]?\b|\bguaranteeing\b/i,
  /\bwill\s+(treat|prevent|heal|reverse|eliminate|stop|clear up)\b\s+(your\s+)?(acne|breakouts?|eczema|psoriasis|rosacea|melasma|dermatitis|infection|disease|condition)\b/i,
  /\b(treats?|treating|prevents?|preventing|heals?|healing|reverses?|eliminates?)\b\s+(your\s+)?(eczema|psoriasis|rosacea|melasma|dermatitis|fungal acne|infection|disease)\b/i,
];

export function outputContainsProhibitedClaim(text: string): boolean {
  return prohibitedOutputClaimPatterns.some((pattern) => pattern.test(text));
}

export function validateAssistantTextForSafety(text: string, initial: SafetyTriage): SafetyTriage {
  const responseProfile: IntakeProfileInput = { mainConcern: text };
  const responseTriage = runSafetyTriage(responseProfile);

  const escalated = severityRank(responseTriage.level) > severityRank(initial.level) ? responseTriage : initial;

  if (outputContainsProhibitedClaim(text)) {
    const level: SafetyLevel = severityRank(escalated.level) >= severityRank("REFER_CLINIC") ? escalated.level : "REFER_CLINIC";
    return {
      level,
      reasons: [
        ...escalated.reasons,
        "Output gate blocked a prohibited diagnose/treat/cure/guarantee claim; replaced with safe cosmetic guidance.",
      ],
      recommendationAllowed: false,
      referralMessage: escalated.recommendationAllowed ? OUTPUT_GATE_FALLBACK_MESSAGE : escalated.referralMessage ?? OUTPUT_GATE_FALLBACK_MESSAGE,
    };
  }

  return escalated;
}

function buildResult(level: SafetyLevel, reasons: string[], recommendationAllowed: boolean): SafetyTriage {
  return {
    level,
    reasons,
    recommendationAllowed,
    referralMessage: recommendationAllowed ? undefined : ESCALATION_MESSAGE,
  };
}

function normalizeProfileText(profile: IntakeProfileInput) {
  const rawText = [
    profile.mainConcern,
    profile.freeText,
    profile.ageRange,
    profile.country,
    profile.skinType,
    profile.sensitivity,
    profile.duration,
    profile.previousIrritationHistory,
    ...(profile.secondaryConcerns ?? []),
    ...(profile.allergies ?? []),
    ...(profile.currentProducts ?? []),
    ...(profile.currentActives ?? []),
    ...(profile.symptoms ?? []),
  ]
    .filter(Boolean)
    .join(" ");
  const rawLower = rawText.toLowerCase();
  let expanded = expandSearchText(rawText).toLowerCase();

  if (!/salicylic|salycilic|bha|acid/.test(rawLower)) {
    expanded = expanded.replace(/salicylic acid|bha/g, "");
  }

  if (!/retinol|retino|retinoid|retinal|adapalene|tretinoin/.test(rawLower)) {
    expanded = expanded.replace(/retinol/g, "");
  }

  return expanded;
}

/**
 * Is the person this is for below the age this advisor will help?
 *
 * The old version matched "13|14|15|16|17" as bare substrings, so any age range
 * containing those digits refused — and it could never fire anyway, because
 * nothing populated ageRange from a conversation until the dialogue learned to
 * read one. Now it parses the number and compares it to the configured line.
 */
function belowAdviceAge(ageRange: string) {
  const text = ageRange.toLowerCase();
  // Words that name a small child whatever number sits beside them.
  if (/\b(?:toddler|infant|newborn|underage|baby)\b/.test(text)) return true;
  const stated = text.match(/\d{1,2}/);
  return stated ? Number(stated[0]) < MIN_ADVICE_AGE : false;
}

function severityRank(level: SafetyLevel) {
  return {
    LOW: 0,
    CAUTION: 1,
    REFER_CLINIC: 2,
    URGENT: 3,
  }[level];
}
