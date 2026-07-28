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
  productFamily,
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
  // Labelled "serum", not "treatment": DermaGuru is a cosmetic advisor under
  // UAE Federal Decree-Law No. 38 of 2024, and "treatment" is medical framing.
  // "Serum" is also what the catalogue calls these — its largest category.
  { step: "treatment", label: "serum" },
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
  /**
   * Products the caller has since found the storefront will not sell. Passed as
   * a rebuild rather than filtered out of the result, so a sold-out cleanser is
   * replaced by the next-best cleanser instead of leaving the routine without
   * one.
   */
  excludeProductIds?: Set<string>;
}): RoutineRecommendation {
  if (!input.safety.recommendationAllowed) {
    return {
      summary: input.safety.referralMessage ?? ESCALATION_MESSAGE,
      disclosureText: "Commercial recommendations are paused because safety triage detected a red flag.",
      items: [],
      safety: input.safety,
    };
  }

  const excluded = input.excludeProductIds ?? new Set<string>();
  const safeProducts = input.products.filter(
    (product) =>
      // A face routine is built from face products only. Nothing else is a
      // near miss worth ranking — a shampoo is not a weaker serum.
      productKind(product) === "face" &&
      !excluded.has(product.id) &&
      passesHardFilters(product, input.profile, input.tenantId, input.safety),
  );

  const ranked = safeProducts
    .map((product) => createCandidate(product, input.profile, input.safety, Boolean(input.sponsoredEnabled)))
    .filter((candidate) => candidate.score.finalScore > 0.18)
    .sort((a, b) => b.score.finalScore - a.score.finalScore);

  // One product per routine, not one row per routine. Two sizes of the same
  // shampoo are two legitimate catalogue rows and one product to a shopper;
  // offering both as separate steps reads as a broken recommendation. Ranked
  // order is already best-first, so the first of a family is the one to keep.
  const seenFamilies = new Set<string>();
  const candidates = ranked.filter((candidate) => {
    const family = productFamily(candidate.product.name);
    if (!family) return true;
    if (seenFamilies.has(family)) return false;
    seenFamilies.add(family);
    return true;
  });

  const items = flagIngredientConflicts(chooseRoutine(candidates, input.profile), input.profile);

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
    expectedResults: expectedResultsFor(product, step),
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

  // Merchant catalogues carry the same product more than once — a re-import
  // that inserts instead of updating leaves two rows with different ids and
  // SKUs but the same product. Matching on id alone let both through, so a
  // routine could list one bottle of sunscreen twice. Identity is the name.
  const identity = (item: RecommendationCandidate) => normalize(item.product.name);

  const chosen: RecommendationCandidate[] = [];
  for (const entry of wanted) {
    const candidate = candidates.find(
      (item) =>
        item.step === entry.step &&
        !chosen.some((picked) => picked.product.id === item.product.id || identity(picked) === identity(item)),
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

const RETINOID = /retinol|retinoid|retinal|tretinoin|adapalene|granactive/i;
const EXFOLIATING_ACID = /glycolic|lactic|mandelic|salicylic|azelaic|\baha\b|\bbha\b|\bpha\b/i;
const POTENT = /vitamin c|ascorbic|benzoyl peroxide/i;

const activesOf = (item: RecommendationCandidate) => item.product.activeIngredientsJson.join(" ");

/**
 * Cautions that depend on the routine as a whole rather than on one product.
 *
 * A retinoid and an exfoliating acid are each fine alone and irritating
 * together, so the conflict is invisible while every product is judged on its
 * own — which is how the engine used to judge them. The pairing is the single
 * most common self-inflicted irritation in an over-the-counter routine, so both
 * halves of it say so, on the card where the shopper is looking.
 */
function flagIngredientConflicts(items: RecommendationCandidate[], profile: IntakeProfileInput) {
  const retinoids = items.filter((item) => RETINOID.test(activesOf(item)));
  const acids = items.filter((item) => EXFOLIATING_ACID.test(activesOf(item)));
  const sensitive =
    normalize(profile.sensitivity).includes("sensitive") ||
    normalize(profile.skinType).includes("sensitive") ||
    normalize(profile.previousIrritationHistory).length > 0;

  return items.map((item) => {
    // These go in front of "Patch test before first use.", not after it. The
    // routine card shows the first caution only, so a conflict warning appended
    // to the end is a warning nobody ever reads.
    const leading: string[] = [];
    const isRetinoid = RETINOID.test(activesOf(item));
    const isAcid = EXFOLIATING_ACID.test(activesOf(item));

    if (retinoids.length && acids.length && (isRetinoid || isAcid)) {
      const other = (isRetinoid ? acids : retinoids)[0];
      leading.push(
        `Use this on different nights from ${other.product.name} — an exfoliating acid and a retinoid in the same session is the usual cause of stinging and peeling.`,
      );
    }
    if (sensitive && (isRetinoid || isAcid || POTENT.test(activesOf(item)))) {
      leading.push("Start twice a week and build up, since you told me your skin reacts easily.");
    }
    return leading.length ? { ...item, cautions: [...leading, ...item.cautions] } : item;
  });
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

/**
 * When a shopper can reasonably expect to notice something.
 *
 * The routine panel gave four products and no sense of what any of them would
 * do or when, which is the question a shopper actually has. Worded as what
 * people typically notice, never as a promise, and never as treating anything.
 */
function expectedResultsFor(product: ProductCatalogItem, step: RoutineStep): string {
  const actives = product.activeIngredientsJson.map(normalize).join(" ");
  const slow = /retino|azelaic|kojic|arbutin|vitamin c|ascorbic|niacinamide|hydroquinone|peptide/.test(actives);

  if (step === "sunscreen") {
    return "Works from day one, but as prevention — you feel nothing change, which is the point.";
  }
  if (step === "cleanser") {
    return "Comfort and less tightness usually show within the first week or two.";
  }
  if (step === "moisturizer") {
    return "Hydration and less tightness are usually noticeable within days.";
  }
  if (slow) {
    return "Tone and texture shift slowly — most people look for a change around 8 to 12 weeks of steady use.";
  }
  return "Most people give a new step 4 to 6 weeks of consistent use before judging it.";
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

  const shape = profile.routinePreference === "simple" ? "simple" : "balanced";
  // A shopper who skipped the question, or picked "none of the above", used to
  // be told "Here is a balanced OTC routine for ." — naming the concern only
  // works when there is one.
  const concern = (profile.mainConcern ?? "").trim();
  const named = concern && !/^(none|none of the above|n\/?a|nothing)$/i.test(concern);

  return named
    ? `Here is a ${shape} OTC routine for ${concern}. It uses only approved merchant catalog products and keeps safety level ${safety.level}.`
    : `Here is a ${shape} OTC routine built from what you told me. It uses only approved merchant catalog products and keeps safety level ${safety.level}.`;
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
