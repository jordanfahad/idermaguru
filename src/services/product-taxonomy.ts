import type { ProductCatalogItem } from "@/domain/skincare";

/**
 * What kind of product this is, and where it belongs in a routine.
 *
 * The recommendation engine used to decide both from a handful of substring
 * tests against `category`. Against a real merchant catalogue that failed
 * badly: shampoo, conditioner, hair oil, lip balm, bar soap and eau de parfum
 * all missed every test and fell through to a single catch-all "evening
 * treatment" bucket — so a face routine could be padded out with perfume.
 *
 * Kind is decided first and is a hard gate: a face routine only ever contains
 * face products, a hair answer only ever contains hair products, and body,
 * fragrance, makeup and devices are never recommended as skincare at all.
 */
export type ProductKind = "face" | "hair" | "body" | "fragrance" | "makeup" | "lip" | "other";

export type RoutineStep =
  | "cleanser"
  | "toner"
  | "treatment"
  | "eye"
  | "moisturizer"
  | "sunscreen"
  | "exfoliant"
  | "mask"
  | "shampoo"
  | "conditioner"
  | "oil"
  | "scalp";

/**
 * Every noun here is written to tolerate the plural, because merchant
 * categories are almost always plural ("toners", "eye creams", "lotions &
 * moisturizers"). Matching only the singular silently dropped 61 face products
 * of 876 into the reject bucket — they were never recommended at all.
 */
const DEVICE = /\b(devices?|tools?|machines?|applicators?|epilators?|ipl|hair removal|floss)\b/;
const FRAGRANCE = /\b(parfum|perfume|cologne|eaux? de|body mists?|fragrance mists?)\b/;
const HAIR = /\b(shampoos?|conditioners?|hair|scalp|dandruff|keratin treatments?)\b/;
const MAKEUP =
  /\b(primers?|foundations?|concealers?|mascaras?|lipsticks?|lip gloss|makeup|make-up|setting sprays?|finishing sprays?|bb cream|cc cream|eye shadows?|face powder|self tanner)\b/;
const LIP = /\b(lip balms?|lip treatments?|lip care|lip masks?|lip scrubs?|lip oils?)\b/;
const BODY = /\b(body|hand creams?|hand wash|foot|feet|shower|bath|deodorants?|bar soap|soap bar)\b/;
const FACE =
  /\b(face|facial|serums?|ampoules?|cleansers?|cleansing|toners?|astringents?|essences?|moisturi[sz](?:er|ers|ing)|sunscreens?|spf|sunblock|eye creams?|eye serums?|masks?|peels?|exfoliants?|acne|blemish|skincare|skin care|anti-aging|anti-ageing)\b/;

/**
 * The merchant's own labels. Kind is decided from these before the description
 * is consulted, because a face cream whose blurb says "for face and body" is
 * still a face cream — reading the description first would demote it.
 */
function labelOf(product: Pick<ProductCatalogItem, "category" | "name">) {
  return `${product.category} ${product.name}`.toLowerCase();
}

function textOf(product: Pick<ProductCatalogItem, "category" | "name" | "description">) {
  return `${product.category} ${product.name} ${product.description ?? ""}`.toLowerCase();
}

/**
 * Order matters. Devices go first — an "IPL hair removal device" names hair but
 * is not hair care, and a "skin care tool" is not a step in a routine. Body
 * goes before face so that a body lotion filed under the catalogue's generic
 * "lotions & moisturizers" is not read as a face moisturiser.
 */
function classify(text: string): ProductKind | null {
  if (DEVICE.test(text)) return "other";
  if (FRAGRANCE.test(text)) return "fragrance";
  if (HAIR.test(text)) return "hair";
  if (LIP.test(text)) return "lip";
  if (MAKEUP.test(text)) return "makeup";
  if (BODY.test(text)) return "body";
  if (FACE.test(text)) return "face";
  return null;
}

export function productKind(product: Pick<ProductCatalogItem, "category" | "name" | "description">): ProductKind {
  return classify(labelOf(product)) ?? classify(textOf(product)) ?? "other";
}

/**
 * Which step of a routine a product occupies. Only meaningful for face and hair
 * products; everything else is filtered out before this is asked.
 */
function faceStepIn(text: string): RoutineStep | null {
  // Sunscreen first: an "SPF 50 moisturiser" is a sunscreen as far as the
  // routine is concerned, and putting it in the moisturiser slot loses the
  // one step nobody should skip.
  if (/\b(sunscreens?|sunblock|spf\s?\d+|spf)\b/.test(text)) return "sunscreen";
  if (/\b(cleansers?|cleansing|face wash|facial wash|micellar|cleansing balm)\b/.test(text)) return "cleanser";
  if (/\b(eye creams?|eye serums?|eye gels?|eye contour|under[- ]eye)\b/.test(text)) return "eye";
  if (/\b(toners?|astringents?|essences?)\b/.test(text)) return "toner";
  if (/\b(masks?|peel[- ]off|sheet masks?)\b/.test(text)) return "mask";
  if (/\b(exfoliants?|exfoliating|scrubs?|peeling|glycolic|lactic acid|mandelic)\b/.test(text)) return "exfoliant";
  if (/\b(moisturi[sz](?:er|ers|ing)|face creams?|day creams?|night creams?|lotions?|emulsions?|hydrating gels?)\b/.test(text)) {
    return "moisturizer";
  }
  return null;
}

/**
 * Which step of a hair routine a product occupies.
 *
 * A mask is not a conditioner and an oil is not a scalp tonic — a shopper with
 * dandruff wants a shampoo, something to leave on, and something for the scalp,
 * not four bottles of shampoo.
 */
function hairStepIn(text: string): RoutineStep | null {
  if (/\b(shampoos?|anti[- ]?dandruff wash)\b/.test(text)) return "shampoo";
  if (/\b(conditioners?|deep conditioning|leave[- ]?in|detangl\w*)\b/.test(text)) return "conditioner";
  if (/\b(hair masks?|scalp masks?|hair treatments? masks?)\b/.test(text)) return "mask";
  if (/\b(hair oils?|scalp oils?|argan oil|castor oil|coconut oil|hair serums?)\b/.test(text)) return "oil";
  if (/\b(scalp|tonics?|lotions?|ampoules?|serums?|anti[- ]?hair ?loss|growth)\b/.test(text)) return "scalp";
  return null;
}

/**
 * Which step of a routine a product occupies. Only meaningful for face and hair
 * products; everything else is filtered out before this is asked.
 *
 * The merchant's label decides before the blurb does. Reading the description
 * first promoted every moisturiser whose copy said "always wear SPF" into the
 * sunscreen slot — which is how one product came back as both the moisturiser
 * and the sunscreen in the same routine.
 */
export function routineStep(product: Pick<ProductCatalogItem, "category" | "name" | "description">): RoutineStep {
  const label = labelOf(product);
  const text = textOf(product);

  // Hair care has as many steps as face care does. Collapsing all of it into
  // three — and folding masks in with conditioners — left the routine builder
  // nothing to build a varied routine out of, so a dandruff answer came back as
  // four shampoos.
  if (productKind(product) === "hair") {
    return hairStepIn(label) ?? hairStepIn(text) ?? "scalp";
  }

  // Serums, ampoules and spot treatments all land in "treatment", as does any
  // face product none of the steps claimed.
  return faceStepIn(label) ?? faceStepIn(text) ?? "treatment";
}

/**
 * Concerns and skin types implied by the merchant's own category.
 *
 * The Shopify importer derives these from product text, and on a real
 * catalogue of 876 products it tagged no skin type for 64% of them and no
 * active ingredient for 63% — which zeroes the terms that make up most of the
 * ranking score, so the order was close to arbitrary. The category is a weaker
 * signal than the ingredient list but it is nearly always present.
 */
const CATEGORY_CONCERNS: { match: RegExp; concerns: string[] }[] = [
  { match: /acne|blemish|spot treatment/, concerns: ["acne", "blemishes", "oily skin"] },
  { match: /anti-aging|anti-ageing|wrinkle|firming|lifting/, concerns: ["fine lines", "wrinkles", "ageing"] },
  { match: /eye cream|eye serum/, concerns: ["dark circles", "puffiness", "fine lines"] },
  { match: /sunscreen|sunblock|spf/, concerns: ["sun protection", "dark spots", "ageing"] },
  { match: /brighten|whitening|dark spot|pigment|glow|radiance/, concerns: ["dark spots", "dullness", "uneven tone"] },
  { match: /hydrat|moistur|lotion/, concerns: ["dryness", "dehydration"] },
  { match: /mask|peel/, concerns: ["dullness", "texture"] },
  { match: /toner|astringent/, concerns: ["oily skin", "pores"] },
  { match: /cleanser|cleansing|face wash/, concerns: ["oily skin", "blackheads"] },
  { match: /soothing|calming|redness|barrier|cica|centella/, concerns: ["redness", "sensitivity", "irritation"] },
  { match: /pore|blackhead/, concerns: ["pores", "blackheads"] },
  { match: /hair loss|thinning|hair fall/, concerns: ["hair loss", "hair thinning"] },
  { match: /dandruff|scalp/, concerns: ["dandruff", "scalp"] },
];

export function derivedConcerns(
  product: Pick<ProductCatalogItem, "category" | "name" | "description">,
): string[] {
  const text = textOf(product);
  const found = new Set<string>();
  for (const rule of CATEGORY_CONCERNS) {
    if (rule.match.test(text)) rule.concerns.forEach((concern) => found.add(concern));
  }
  return [...found];
}

/**
 * Skin types a product is plausibly for, when nothing was tagged explicitly.
 *
 * Returns nothing rather than guessing when the text says nothing. An earlier
 * version defaulted to "normal and combination", which quietly handed every
 * untagged product a perfect skin-type score for those two shoppers and a poor
 * one for everybody else. Unknown is scored as unknown by the caller.
 */
export function derivedSkinTypes(
  product: Pick<ProductCatalogItem, "category" | "name" | "description">,
): string[] {
  const text = textOf(product);
  const found = new Set<string>();
  if (/\b(oily|oil[- ]control|mattif|sebum)\b/.test(text)) found.add("oily");
  if (/\b(dry|dryness|nourishing|rich cream|intense moisture)\b/.test(text)) found.add("dry");
  if (/\b(sensitive|gentle|soothing|calming|fragrance[- ]free)\b/.test(text)) found.add("sensitive");
  if (/\bcombination\b/.test(text)) found.add("combination");
  if (/\bnormal\b/.test(text)) found.add("normal");
  return [...found];
}

/**
 * The stable identity of a storefront product: the handle in its page URL.
 *
 * Returns "" when the URL is not a product page, so callers fall back to
 * matching the whole string rather than treating an arbitrary path as a handle.
 */
export function productHandle(url: string): string {
  const match = url.toLowerCase().match(/\/products\/([^/?#]+)/);
  return match?.[1] ?? "";
}

/** Last-resort stable key when a row carries no product-page URL. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * A product without its size, so two sizes of one product read as one thing.
 *
 * A routine that offered the same anti-dandruff shampoo in 200ML and 390ML as
 * two of its four steps looked broken, and it was: they are separate catalogue
 * rows with separate handles, correctly, but a shopper is being shown one
 * product twice.
 */
export function productFamily(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:ml|mls|g|gm|gr|grams?|kg|l|oz|fl\s?oz)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
