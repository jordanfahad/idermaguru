export type SafetyLevel = "LOW" | "CAUTION" | "REFER_CLINIC" | "URGENT";

export type PregnancySafety = "UNKNOWN" | "AVOID" | "CAUTION" | "GENERALLY_ACCEPTED";

export type EventType =
  | "SESSION_STARTED"
  | "CONSENT_ACCEPTED"
  | "IMAGE_UPLOADED"
  | "INTAKE_COMPLETED"
  | "RED_FLAG_DETECTED"
  | "RECOMMENDATION_VIEWED"
  | "PRODUCT_IMPRESSION"
  | "PRODUCT_CLICK"
  | "ADD_TO_CART"
  | "CHECKOUT_STARTED"
  | "PURCHASE_COMPLETED";

export type TenantConfig = {
  id: string;
  slug: string;
  name: string;
  domain: string;
  disclosureText: string;
  brandVoice?: string | null;
};

export type IntakeProfileInput = {
  sessionId?: string;
  ageRange?: string;
  country?: string;
  mainConcern: string;
  secondaryConcerns?: string[];
  skinType?: string;
  sensitivity?: string;
  pregnantOrBreastfeeding?: boolean;
  allergies?: string[];
  currentProducts?: string[];
  currentActives?: string[];
  prescriptionUse?: boolean;
  severitySelfRated?: number;
  duration?: string;
  symptoms?: string[];
  budgetMin?: number;
  budgetMax?: number;
  routinePreference?: string;
  fragrancePreference?: string;
  texturePreference?: string;
  sunscreenUse?: string;
  previousIrritationHistory?: string;
  freeText?: string;
};

export type ProductCatalogItem = {
  id: string;
  tenantId: string;
  sku: string;
  name: string;
  brand: string;
  category: string;
  description: string;
  url: string;
  imageUrl?: string | null;
  price: number;
  currency: string;
  inStock: boolean;
  ingredientsJson: string[];
  activeIngredientsJson: string[];
  skinTypesJson: string[];
  concernsJson: string[];
  avoidIfJson: string[];
  pregnancySafety: PregnancySafety;
  fragranceFree: boolean;
  nonComedogenic: boolean;
  sensitiveSkinSuitable: boolean;
  claimsJson: string[];
  approvedClaimsJson: string[];
  merchantPriority: number;
  sponsoredBidCpc: number;
  /** From the merchant's brand registry, when one exists for this catalogue. */
  originBucket?: "korean" | "french" | "other" | "unknown";
};

export type SafetyTriage = {
  level: SafetyLevel;
  reasons: string[];
  recommendationAllowed: boolean;
  referralMessage?: string;
};

export type ScoreBreakdown = {
  concernMatch: number;
  ingredientEvidence: number;
  skinTypeFit: number;
  sensitivityFit: number;
  priceFit: number;
  availability: number;
  commercialBoost: number;
  finalScore: number;
};

export type RecommendationCandidate = {
  product: ProductCatalogItem;
  /** Machine-readable routine position; `slot` is its shopper-facing label. */
  step: string;
  slot: string;
  score: ScoreBreakdown;
  reason: string;
  /** Roughly when this step tends to show, and what "showing" looks like. */
  expectedResults: string;
  usageGuidance: string;
  cautions: string[];
  sponsored: boolean;
};

export type RoutineRecommendation = {
  summary: string;
  disclosureText: string;
  items: RecommendationCandidate[];
  safety: SafetyTriage;
};

export const CUSTOMER_DISCLAIMER =
  "AI Derma Guru can help with general over-the-counter skincare guidance and product discovery. It does not diagnose medical conditions, prescribe medication, or replace a dermatologist or doctor. If symptoms are severe, painful, infected, bleeding, rapidly worsening, or involve swelling, breathing difficulty, fever, or the eyes, please seek medical care.";

export const IMAGE_CONSENT_TEXT =
  "You may upload a skin photo to help personalize general OTC skincare suggestions. This is optional. The photo will not be used to diagnose medical conditions and will not be used to train AI models. You can continue without uploading a photo.";

export const SPONSORED_DISCLOSURE =
  "Some recommendations may include sponsored partner products. They are shown only after passing safety and suitability checks.";

// Written to sound like a person who was listening. The old version opened
// "Based on what you shared, this may need a clinician's review" — accurate, and
// a cold thing to read when you have just described something frightening.
export const ESCALATION_MESSAGE =
  "Thanks for telling me — and I'd rather be straight with you: what you're describing is one for a real clinician, not a shop's advisor. I can help with everyday over-the-counter skincare, but I can't diagnose this or work out what's behind it, and guessing wouldn't be fair to you. Please get it looked at by a dermatologist or doctor. If there's trouble breathing, swelling of the lips, tongue or face, a fever, redness spreading quickly, severe pain, or anything involving your eyes, don't wait for an appointment — go to urgent care.";

// The same words, authored in Arabic rather than machine-translated: safety
// copy is spoken at the most frightening moment of a session, and its wording
// must be as deliberate in Arabic as it is in English.
export const ESCALATION_MESSAGE_AR =
  "شكراً لأنك أخبرتني — وأفضّل أن أكون صريحاً معك: ما تصفه يحتاج طبيباً حقيقياً، لا مستشار متجر. أستطيع مساعدتك في العناية اليومية بالبشرة بمنتجات لا تحتاج وصفة، لكن لا يمكنني تشخيص حالتك أو معرفة ما وراءها، والتخمين ليس إنصافاً لك. من فضلك اعرض الأمر على طبيب جلدية أو طبيب. وإن كان هناك صعوبة في التنفس، أو تورّم في الشفتين أو اللسان أو الوجه، أو حمّى، أو احمرار ينتشر بسرعة، أو ألم شديد، أو أي شيء يخص العينين — فلا تنتظر موعداً، وتوجّه إلى الطوارئ فوراً.";

/** The clinician referral in the conversation's authored language. */
export function escalationMessage(lang: "en" | "ar"): string {
  return lang === "ar" ? ESCALATION_MESSAGE_AR : ESCALATION_MESSAGE;
}

// Replaces assistant output that slips a diagnostic conclusion, a treat/cure/prevent
// claim, or a guaranteed-result claim through the model (output gate, spec §3.3).
export const OUTPUT_GATE_FALLBACK_MESSAGE =
  "Let me keep this to general cosmetic guidance: a gentle routine (cleanse, moisturize, and use sunscreen during the day), introduce one new product at a time, and always follow each product's label. AI Derma Guru can't diagnose or promise to treat, cure, or prevent any condition — for a medical concern, please see a dermatologist or doctor.";
