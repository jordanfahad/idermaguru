import {
  ESCALATION_MESSAGE,
  OUTPUT_GATE_FALLBACK_MESSAGE,
  type IntakeProfileInput,
  type SafetyLevel,
  type SafetyTriage,
} from "@/domain/skincare";
import { expandSearchText } from "@/data/search-keywords";

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
];

const referPatterns = [
  /changing mole|mole changed|bleeding mole|irregular mole|mole.*multiple colors|asymmetric mole/i,
  /rapidly growing.*(pigmented|spot|lesion|mole)/i,
  /pus|abscess|open wound/i,
  /painful cystic acne|painful cysts|nodular acne|severe acne/i,
  /acne.*causing scarring|active acne.*scarring/i,
  /worsening rash|widespread rash|rash.*widespread/i,
  /suspected infection|looks infected|skin infection/i,
  /fungal infection|skin cancer|melanoma/i,
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

  for (const pattern of referPatterns) {
    if (pattern.test(text)) {
      reasons.push(`Matched clinician referral red flag: ${pattern.source}`);
    }
  }

  if (profile.ageRange && isUnder18(profile.ageRange)) {
    reasons.push("User appears under 18 and guardian flow is not implemented.");
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

function isUnder18(ageRange: string) {
  return /under\s*18|underage|child|teen|13|14|15|16|17/.test(ageRange.toLowerCase());
}

function severityRank(level: SafetyLevel) {
  return {
    LOW: 0,
    CAUTION: 1,
    REFER_CLINIC: 2,
    URGENT: 3,
  }[level];
}
