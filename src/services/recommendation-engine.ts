import {
  ESCALATION_MESSAGE,
  SPONSORED_DISCLOSURE,
  type IntakeProfileInput,
  type ProductCatalogItem,
  type RecommendationCandidate,
  type RoutineRecommendation,
  type SafetyTriage,
  type ScoreBreakdown,
} from "@/domain/skincare";
import { expandSearchText } from "@/data/search-keywords";
import {
  derivedConcerns,
  derivedSkinTypes,
  productKind,
  routineStep,
  type RoutineStep,
} from "./product-taxonomy";

/**
 * A face routine, in the order it is used. Every step is optional: a routine
 * that skips a step the catalogue cannot fill is honest, whereas one padded to
 * a fixed length with whatever scored highest is how eau de parfum ended up
 * being recommended for dark spots.
 */
const FACE_ROUTINE: { step: RoutineStep; label: string; optional?: boolean }[] = [
  { step: "cleanser", label: "cleanser" },
  { step: "toner", label: "toner", optional: true },
  { step: "treatment", label: "treatment" },
  { step: "eye", label: "eye care", optional: true },
  { step: "moisturizer", label: "moisturiser" },
  { step: "sunscreen", label: "sunscreen" },
  { step: "exfoliant", label: "weekly exfoliant", optional: true },
];

const SIMPLE_ROUTINE: RoutineStep[] = ["cleanser", "treatment", "moisturizer", "sunscreen"];

const MAX_ROUTINE_ITEMS = 6;

export function buildRecommendations(input: {
  tenantId: string;
  profile: IntakeProfileInput;
  safety: SafetyTriage;
  products: ProductCatalogItem[];
  sponsoredEnabled?: boolean;
}): RoutineRecommendation {
  if (!input.safety.recommendationAllowed) {
    return {
      summary: input.safety.referralMessage ?? ESCALATION_MESSAGE,
      disclosureText: "Commercial recommendations are paused because safety triage detected a red flag.",
      items: [],
      safety: input.safety,
    };
  }

  const safeProducts = input.products.filter(
    (product) =>
      // A face routine is built from face products only. Nothing else is a
      // near miss worth ranking — a shampoo is not a weaker serum.
      productKind(product) === "face" &&
      passesHardFilters(product, input.profile, input.tenantId, input.safety),
  );

  const candidates = safeProducts
    .map((product) => createCandidate(product, input.profile, input.safety, Boolean(input.sponsoredEnabled)))
    .filter((candidate) => candidate.score.finalScore > 0.18)
    .sort((a, b) => b.score.finalScore - a.score.finalScore);

  const items = chooseRoutine(candidates, input.profile);

  return {
    summary: buildSummary(input.profile, input.safety, items),
    disclosureText: items.some((item) => item.sponsored)
      ? SPONSORED_DISCLOSURE
      : "Recommendations are based on OTC suitability signals, catalog metadata, and the intake you provided.",
    items,
    safety: input.safety,
  };
}

export function passesHardFilters(
  product: ProductCatalogItem,
  profile: IntakeProfileInput,
  tenantId: string,
  safety: SafetyTriage,
) {
  if (product.tenantId !== tenantId) return false;
  if (!product.inStock) return false;
  if (!safety.recommendationAllowed) return false;

  const allergyTerms = (profile.allergies ?? []).map(normalize);
  const avoidTerms = product.avoidIfJson.map(normalize);
  const ingredients = [...product.ingredientsJson, ...product.activeIngredientsJson].map(normalize);

  if (allergyTerms.some((allergy) => ingredients.some((ingredient) => ingredient.includes(allergy)))) {
    return false;
  }
  if (allergyTerms.some((allergy) => avoidTerms.some((term) => term.includes(allergy)))) {
    return false;
  }

  const activeText = product.activeIngredientsJson.join(" ").toLowerCase();
  const wantsOrUsesRetinoid = /retinol|retinoid|retinal|tretinoin|adapalene/.test(activeText);
  const strongAcids = /glycolic|lactic|mandelic|salicylic|aha|bha|acid/.test(activeText);
  const verySensitive =
    normalize(profile.sensitivity).includes("very") ||
    normalize(profile.skinType).includes("sensitive") ||
    normalize(profile.previousIrritationHistory).includes("burn");

  if (profile.pregnantOrBreastfeeding && (wantsOrUsesRetinoid || product.pregnancySafety === "AVOID")) {
    return false;
  }

  if (verySensitive && strongAcids && !product.sensitiveSkinSuitable) {
    return false;
  }

  if (product.avoidIfJson.some((rule) => profileText(profile).includes(normalize(rule)))) {
    return false;
  }

  if (/prescription|rx only|tretinoin|isotretinoin|antibiotic|steroid/.test(activeText)) {
    return false;
  }

  return true;
}

function createCandidate(
  product: ProductCatalogItem,
  profile: IntakeProfileInput,
  safety: SafetyTriage,
  sponsoredEnabled: boolean,
): RecommendationCandidate {
  const score = scoreProduct(product, profile, safety, sponsoredEnabled);
  const sponsored = sponsoredEnabled && product.sponsoredBidCpc > 0 && score.commercialBoost > 0;
  const step = routineStep(product);

  return {
    product,
    step,
    slot: slotLabel(step),
    score,
    reason: reasonFor(product, profile, step),
    usageGuidance: usageFor(product),
    cautions: cautionsFor(product, profile, safety),
    sponsored,
  };
}

function scoreProduct(
  product: ProductCatalogItem,
  profile: IntakeProfileInput,
  safety: SafetyTriage,
  sponsoredEnabled: boolean,
): ScoreBreakdown {
  const text = profileText(profile);
  const concernTokens = tokenize(text);
  // On a real merchant catalogue of 876 products, 63% carry no active
  // ingredient and 64% no skin type, so scoring on tags alone left the terms
  // that encode relevance — 70% of the weight — flat across most of the shelf
  // and the order close to arbitrary. Falling back to what the merchant's own
  // category implies restores a real ordering.
  const concerns = product.concernsJson.length ? product.concernsJson : derivedConcerns(product);
  const skinTypes = product.skinTypesJson.length ? product.skinTypesJson : derivedSkinTypes(product);

  const concernMatch = matchScore(concerns, concernTokens);
  const ingredientEvidence = matchScore(product.activeIngredientsJson, concernTokens) || baselineEvidence(product);
  // Three outcomes, not two: a product that names no skin type is unknown, not
  // unsuitable. Scoring unknown as a mismatch buried every untagged product
  // beneath worse-matched but better-labelled ones.
  const skinTypeFit = !profile.skinType || !skinTypes.length
    ? 0.5
    : skinTypes.map(normalize).includes(normalize(profile.skinType))
      ? 1
      : 0.25;
  const sensitivityFit =
    normalize(profile.sensitivity).includes("high") || normalize(profile.skinType).includes("sensitive")
      ? product.sensitiveSkinSuitable
        ? 1
        : 0.1
      : 0.75;
  const priceFit = priceScore(product.price, profile.budgetMin, profile.budgetMax);
  const availability = product.inStock ? 1 : 0;
  const commercialBoost =
    sponsoredEnabled && product.sponsoredBidCpc > 0 && safety.recommendationAllowed
      ? Math.min(1, product.sponsoredBidCpc / 1.5)
      : 0;

  const finalScore =
    0.35 * concernMatch +
    0.2 * ingredientEvidence +
    0.15 * skinTypeFit +
    0.1 * sensitivityFit +
    0.1 * priceFit +
    0.05 * availability +
    0.05 * commercialBoost;

  return {
    concernMatch,
    ingredientEvidence,
    skinTypeFit,
    sensitivityFit,
    priceFit,
    availability,
    commercialBoost,
    finalScore,
  };
}

/**
 * Picks the best product for each step of the routine, and nothing else.
 *
 * There is deliberately no padding pass. The previous version topped the list
 * up to six with whatever scored highest regardless of step, which is what put
 * a second cleanser — or a bottle of perfume — into a routine that already had
 * one. A four-step routine the shopper can actually follow beats six items.
 */
function chooseRoutine(candidates: RecommendationCandidate[], profile: IntakeProfileInput) {
  const simple = profile.routinePreference === "simple";
  const wanted = simple
    ? FACE_ROUTINE.filter((entry) => SIMPLE_ROUTINE.includes(entry.step))
    : FACE_ROUTINE;

  const chosen: RecommendationCandidate[] = [];
  for (const entry of wanted) {
    const candidate = candidates.find(
      (item) => item.step === entry.step && !chosen.some((picked) => picked.product.id === item.product.id),
    );
    if (candidate) chosen.push(candidate);
  }

  // A routine where every single item is paid-for reads as an advert. Swap the
  // last one for the best organic product *for that same step* — swapping in
  // whatever ranked next regardless of step is how a routine ended up with two
  // cleansers and no sunscreen.
  if (chosen.length > 1 && chosen.every((item) => item.sponsored)) {
    const last = chosen[chosen.length - 1];
    const organic = candidates.find(
      (item) =>
        !item.sponsored &&
        item.step === last.step &&
        !chosen.some((picked) => picked.product.id === item.product.id),
    );
    if (organic) chosen[chosen.length - 1] = organic;
  }

  // Trim to a routine a shopper will actually keep up with, dropping the steps
  // marked optional before any of the ones that carry the result.
  const optional = new Set<string>(FACE_ROUTINE.filter((entry) => entry.optional).map((entry) => entry.step));
  while (chosen.length > MAX_ROUTINE_ITEMS) {
    const cut = chosen.map((item, index) => ({ item, index })).reverse().find(({ item }) => optional.has(item.step));
    chosen.splice(cut ? cut.index : chosen.length - 1, 1);
  }

  return chosen;
}

/** The shopper-facing label for a step. */
function slotLabel(step: RoutineStep) {
  return FACE_ROUTINE.find((entry) => entry.step === step)?.label ?? step;
}

/**
 * Why this product, in a sentence a shopper would accept from a person.
 *
 * The old fallback — "fits this routine slot and passed the safety and
 * suitability filters" — appeared on most cards, because most products match no
 * concern tag. It reads like a machine apologising. Name the ingredient doing
 * the work, or the concern it targets, or say plainly what the step is for.
 */
function reasonFor(product: ProductCatalogItem, profile: IntakeProfileInput, step: RoutineStep) {
  const text = profileText(profile);
  const concerns = [...product.concernsJson, ...derivedConcerns(product)];
  const matching = [...new Set(concerns.filter((concern) => text.includes(normalize(concern))))];
  const actives = product.activeIngredientsJson.slice(0, 2);

  if (matching.length && actives.length) {
    return `${actives.join(" and ")} — that's what's working on your ${matching.slice(0, 2).join(" and ")}.`;
  }
  if (matching.length) {
    return `Chosen for your ${matching.slice(0, 2).join(" and ")}.`;
  }
  if (actives.length) {
    return `Your ${slotLabel(step)} step, built around ${actives.join(" and ")}.`;
  }
  return `Your ${slotLabel(step)} step${profile.skinType ? `, suited to ${normalize(profile.skinType)} skin` : ""}.`;
}

function usageFor(product: ProductCatalogItem) {
  if (product.category === "sunscreen") return "Use every morning as directed on the label and reapply when needed.";
  if (product.category === "exfoliant") return "Start 1 night weekly, avoid stacking with other strong actives, and follow label directions.";
  if (product.category === "spot treatment") return "Use only on small areas as directed on the label.";
  if (product.category === "cleanser") return "Use with lukewarm water and avoid scrubbing.";
  return "Introduce slowly, patch test first, and follow label directions.";
}

function cautionsFor(product: ProductCatalogItem, profile: IntakeProfileInput, safety: SafetyTriage) {
  const cautions = ["Patch test before first use.", "Stop use if severe irritation occurs."];
  if (safety.level === "CAUTION") cautions.push("Because caution signals were detected, introduce one product at a time.");
  if (profile.pregnantOrBreastfeeding && product.pregnancySafety === "CAUTION") {
    cautions.push("Ask a clinician before using while pregnant or breastfeeding.");
  }
  if (product.sponsoredBidCpc > 0) cautions.push("Sponsored placement does not change safety filtering.");
  return cautions;
}

function buildSummary(profile: IntakeProfileInput, safety: SafetyTriage, items: RecommendationCandidate[]) {
  if (items.length === 0) {
    return safety.referralMessage ?? "No suitable OTC products were found after safety filtering.";
  }

  return `Here is a ${profile.routinePreference === "simple" ? "simple" : "balanced"} OTC routine for ${profile.mainConcern}. It uses only approved merchant catalog products and keeps safety level ${safety.level}.`;
}

function baselineEvidence(product: ProductCatalogItem) {
  if (product.activeIngredientsJson.some((ingredient) => /sunscreen|zinc oxide|titanium dioxide/i.test(ingredient))) return 0.9;
  if (product.activeIngredientsJson.some((ingredient) => /ceramide|glycerin|panthenol|hyaluronic/i.test(ingredient))) return 0.75;
  if (product.activeIngredientsJson.some((ingredient) => /niacinamide|salicylic|benzoyl|lactic|mandelic/i.test(ingredient))) return 0.8;
  return 0.45;
}

function matchScore(values: string[], tokens: string[]) {
  const normalizedValues = values.map(normalize).join(" ");
  const hits = tokens.filter((token) => normalizedValues.includes(token)).length;
  return Math.min(1, hits / Math.max(2, tokens.length * 0.35));
}

function priceScore(price: number, min?: number, max?: number) {
  if (!min && !max) return 0.75;
  if (min && price < min) return 0.65;
  if (max && price > max) return Math.max(0.1, 1 - (price - max) / Math.max(max, 1));
  return 1;
}

function tokenize(value: string) {
  return normalize(expandSearchText(value))
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !["skin", "want", "with", "have"].includes(token));
}

function profileText(profile: IntakeProfileInput) {
  return [
    expandSearchText(profile.mainConcern),
    profile.freeText,
    profile.skinType,
    profile.sensitivity,
    profile.routinePreference,
    profile.fragrancePreference,
    profile.texturePreference,
    profile.previousIrritationHistory,
    ...(profile.secondaryConcerns ?? []),
    ...(profile.symptoms ?? []),
    ...(profile.currentActives ?? []),
  ]
    .map(normalize)
    .join(" ");
}

function normalize(value?: string | null) {
  return (value ?? "").toLowerCase().trim();
}
