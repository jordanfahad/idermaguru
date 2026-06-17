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

const routineSlots = [
  "morning cleanser",
  "morning serum/treatment",
  "moisturizer",
  "sunscreen",
  "evening cleanser",
  "evening treatment",
  "evening moisturizer",
  "optional spot treatment",
  "optional exfoliant",
];

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

  const safeProducts = input.products.filter((product) =>
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

  return {
    product,
    slot: inferSlot(product, profile),
    score,
    reason: reasonFor(product, profile),
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
  const concernMatch = matchScore(product.concernsJson, concernTokens);
  const ingredientEvidence = matchScore(product.activeIngredientsJson, concernTokens) || baselineEvidence(product);
  const skinTypeFit = profile.skinType
    ? product.skinTypesJson.map(normalize).includes(normalize(profile.skinType))
      ? 1
      : 0.25
    : 0.5;
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

function chooseRoutine(candidates: RecommendationCandidate[], profile: IntakeProfileInput) {
  const chosen: RecommendationCandidate[] = [];
  const required = ["morning cleanser", "moisturizer", "sunscreen"];
  const wantedSlots = profile.routinePreference === "simple" ? required : routineSlots;

  for (const slot of wantedSlots) {
    const candidate = candidates.find(
      (item) => item.slot === slot && !chosen.some((chosenItem) => chosenItem.product.id === item.product.id),
    );
    if (candidate) chosen.push(candidate);
    if (profile.routinePreference === "simple" && chosen.length >= 4) break;
  }

  for (const candidate of candidates) {
    if (chosen.length >= 6) break;
    if (!chosen.some((item) => item.product.id === candidate.product.id)) chosen.push(candidate);
  }

  const sponsoredCount = chosen.filter((item) => item.sponsored).length;
  if (chosen.length > 1 && sponsoredCount === chosen.length) {
    const organic = candidates.find(
      (item) => !item.sponsored && !chosen.some((chosenItem) => chosenItem.product.id === item.product.id),
    );
    if (organic) chosen[chosen.length - 1] = organic;
  }

  return chosen.slice(0, 6);
}

function inferSlot(product: ProductCatalogItem, profile: IntakeProfileInput) {
  const category = normalize(product.category);
  const activeText = product.activeIngredientsJson.join(" ").toLowerCase();

  if (category.includes("sunscreen")) return "sunscreen";
  if (category.includes("cleanser")) return product.concernsJson.includes("oily skin") ? "evening cleanser" : "morning cleanser";
  if (category.includes("moisturizer")) return profile.skinType === "dry" ? "evening moisturizer" : "moisturizer";
  if (category.includes("spot")) return "optional spot treatment";
  if (category.includes("exfoliant") || /acid|aha|bha/.test(activeText)) return "optional exfoliant";
  if (category.includes("serum")) return "morning serum/treatment";
  return "evening treatment";
}

function reasonFor(product: ProductCatalogItem, profile: IntakeProfileInput) {
  const matching = product.concernsJson.filter((concern) => profileText(profile).includes(normalize(concern)));
  if (matching.length > 0) {
    return `${product.name} fits your ${matching.slice(0, 2).join(" and ")} concern based on approved catalog tags.`;
  }
  return `${product.name} fits this routine slot and passed the safety and suitability filters.`;
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
