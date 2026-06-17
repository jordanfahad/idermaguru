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
  slot: string;
  score: ScoreBreakdown;
  reason: string;
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

export const ESCALATION_MESSAGE =
  "Based on what you shared, this may need a clinician's review. AI Derma Guru can help with general OTC skincare guidance, but it can't diagnose or treat this here. Please contact a dermatologist or doctor. If you have trouble breathing, swelling of the lips, tongue, or face, fever, rapidly spreading redness, severe pain, or eye involvement, seek urgent care.";
