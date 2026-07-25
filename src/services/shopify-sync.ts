import type { ProductCatalogItem } from "@/domain/skincare";
import type { ShopifyProduct } from "@/lib/shopify";

export type { ShopifyProduct };

/**
 * Maps a Shopify product onto our catalogue shape.
 *
 * Shopify carries no structured ingredient data, so the fields the safety
 * filters depend on are derived from the product's own text. Without this a
 * synced "Retinol Serum" would have empty actives and UNKNOWN pregnancy
 * status, and would sail straight past the pregnancy gate.
 */
const ACTIVES: { term: string; match: RegExp }[] = [
  { term: "retinol", match: /retinol/i },
  { term: "retinal", match: /retinal\b/i },
  { term: "retinoid", match: /retinoid/i },
  { term: "tretinoin", match: /tretinoin/i },
  { term: "adapalene", match: /adapalene/i },
  { term: "salicylic acid", match: /salicylic|\bbha\b/i },
  { term: "glycolic acid", match: /glycolic/i },
  { term: "lactic acid", match: /lactic acid/i },
  { term: "mandelic acid", match: /mandelic/i },
  { term: "benzoyl peroxide", match: /benzoyl/i },
  { term: "azelaic acid", match: /azelaic/i },
  { term: "hydroquinone", match: /hydroquinone/i },
  { term: "niacinamide", match: /niacinamide/i },
  { term: "vitamin c", match: /vitamin c|ascorbic/i },
  { term: "hyaluronic acid", match: /hyaluronic/i },
  { term: "ceramides", match: /ceramide/i },
  { term: "panthenol", match: /panthenol/i },
  { term: "centella", match: /centella|\bcica\b/i },
  { term: "zinc oxide", match: /zinc oxide/i },
  { term: "titanium dioxide", match: /titanium dioxide/i },
  { term: "peptides", match: /peptide/i },
];

const CONCERNS: { term: string; match: RegExp }[] = [
  { term: "acne", match: /acne|blemish|pimple|breakout/i },
  { term: "dark spots", match: /dark spot|hyperpigment|pigmentation|melasma|brighten/i },
  { term: "dullness", match: /dull|glow|radian/i },
  { term: "fine lines", match: /wrinkle|fine line|anti-?ag|firm/i },
  { term: "pores", match: /pore|blackhead/i },
  { term: "redness", match: /redness|irritat|soothe|calm/i },
  { term: "dryness", match: /dry|dehydrat|hydrat|moistur/i },
  { term: "barrier", match: /barrier|repair/i },
  { term: "texture", match: /texture|smooth|exfoliat/i },
  { term: "sun protection", match: /\bspf\b|sunscreen|\buv\b/i },
  { term: "dandruff", match: /dandruff|scalp/i },
  { term: "hair fall", match: /hair fall|hair loss|thinning/i },
  { term: "hair", match: /\bhair\b|shampoo|conditioner/i },
];

const SKIN_TYPES: { term: string; match: RegExp }[] = [
  { term: "oily", match: /oily|oil control|sebum/i },
  { term: "dry", match: /\bdry\b|dehydrat/i },
  { term: "combination", match: /combination/i },
  { term: "sensitive", match: /sensitive|soothing|calming/i },
  { term: "normal", match: /all skin types/i },
];

const PREGNANCY_AVOID = /retinol|retinal|retinoid|tretinoin|adapalene|hydroquinone/i;
const PREGNANCY_CAUTION = /salicylic|glycolic|benzoyl|mandelic|lactic acid|azelaic/i;
const GENTLE = /gentle|sensitive|soothing|calming|centella|\bcica\b|panthenol|ceramide|barrier|fragrance[- ]?free/i;
const STRONG = /retinol|retinal|retinoid|tretinoin|adapalene|benzoyl|glycolic|salicylic/i;

function stripHtml(value: string | null | undefined): string {
  return (value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export function mapShopifyProduct(
  product: ShopifyProduct,
  tenantId: string,
  shopDomain: string,
): ProductCatalogItem | null {
  const variant = product.variants?.[0];
  const price = Number.parseFloat(variant?.price ?? "");
  if (!product.title || !Number.isFinite(price)) return null;

  const description = stripHtml(product.body_html).slice(0, 900);
  const text = `${product.title} ${description} ${product.product_type ?? ""} ${product.tags ?? ""}`;

  const inventory = variant?.inventory_quantity;
  return {
    id: `shopify-${shopDomain}-${product.id}`,
    tenantId,
    sku: variant?.sku || String(product.id),
    name: product.title.slice(0, 300),
    brand: product.vendor || shopDomain.replace(".myshopify.com", ""),
    category: (product.product_type || "skincare").toLowerCase(),
    description: description || product.title,
    url: `https://${shopDomain.replace(".myshopify.com", "")}.myshopify.com/products/${product.handle}`,
    imageUrl: product.images?.[0]?.src ?? null,
    price,
    currency: "AED",
    // Draft/archived products are never sellable; treat unknown inventory as available.
    inStock: product.status === "active" && (inventory === undefined || inventory === null || inventory > 0),
    ingredientsJson: [],
    activeIngredientsJson: ACTIVES.filter((a) => a.match.test(text)).map((a) => a.term),
    skinTypesJson: SKIN_TYPES.filter((s) => s.match.test(text)).map((s) => s.term),
    concernsJson: CONCERNS.filter((c) => c.match.test(text)).map((c) => c.term),
    avoidIfJson: PREGNANCY_AVOID.test(text) ? ["pregnancy"] : [],
    pregnancySafety: PREGNANCY_AVOID.test(text) ? "AVOID" : PREGNANCY_CAUTION.test(text) ? "CAUTION" : "UNKNOWN",
    fragranceFree: /fragrance[- ]?free|unscented/i.test(text),
    nonComedogenic: /non[- ]?comedogenic/i.test(text),
    sensitiveSkinSuitable: GENTLE.test(text) && !STRONG.test(text),
    claimsJson: [],
    approvedClaimsJson: [],
    merchantPriority: 50,
    sponsoredBidCpc: 0,
  };
}
