import { Prisma } from "@prisma/client";
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
  // The shop's own currency, read from the Shopify shop endpoint at sync time.
  // This used to be hardcoded to AED, which is right for one merchant in Dubai
  // and wrong for every other store this is sold to — their prices would have
  // been relabelled into a currency they do not trade in.
  currency = "AED",
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
    currency,
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

/**
 * Writes a mapped catalogue into the Product table in batches.
 *
 * A row-at-a-time upsert of a real catalogue is one database round trip per
 * product; at ~900 products that ran past the serverless time limit and the
 * whole sync 504'd. One statement per chunk turns that into a handful of round
 * trips.
 *
 * Conflicts resolve on (tenantId, sku) — the same SKU in the same store is the
 * same product however it first arrived — and the primary key is deliberately
 * left untouched so recommendations and events already pointing at a row keep
 * pointing at it. If a chunk still fails (a merchant can reuse a Shopify id
 * under a new SKU) it is retried row by row, so one bad product costs one
 * product rather than two hundred.
 */
export async function writeCatalogue(
  prisma: PrismaLike,
  items: ProductCatalogItem[],
  chunkSize = 200,
): Promise<number> {
  // Two rows with the same conflict key in one statement is a Postgres error
  // ("cannot affect row a second time"), so the last one wins here instead.
  const deduped = [...new Map(items.map((item) => [`${item.tenantId}:${item.sku}`, item])).values()];

  let written = 0;
  for (let index = 0; index < deduped.length; index += chunkSize) {
    const chunk = deduped.slice(index, index + chunkSize);
    try {
      await prisma.$executeRaw(upsertSql(chunk));
      written += chunk.length;
    } catch {
      for (const item of chunk) {
        try {
          await prisma.$executeRaw(upsertSql([item]));
          written += 1;
        } catch {
          // One malformed product must not abort the whole catalogue.
        }
      }
    }
  }
  return written;
}

type PrismaLike = { $executeRaw: (query: Prisma.Sql) => Promise<number> };

function upsertSql(items: ProductCatalogItem[]): Prisma.Sql {
  const rows = items.map(
    (item) => Prisma.sql`(
      ${item.id}, ${item.tenantId}, ${item.sku}, ${item.name}, ${item.brand}, ${item.category},
      ${item.description}, ${item.url}, ${item.imageUrl}, ${item.price}, ${item.currency}, ${item.inStock},
      ${JSON.stringify(item.activeIngredientsJson)}::jsonb, ${JSON.stringify(item.skinTypesJson)}::jsonb,
      ${JSON.stringify(item.concernsJson)}::jsonb, ${JSON.stringify(item.avoidIfJson)}::jsonb,
      ${item.pregnancySafety}::"PregnancySafety", ${item.fragranceFree}, ${item.nonComedogenic},
      ${item.sensitiveSkinSuitable}, ${item.merchantPriority}, NOW()
    )`,
  );

  return Prisma.sql`
    INSERT INTO "Product" (
      "id", "tenantId", "sku", "name", "brand", "category",
      "description", "url", "imageUrl", "price", "currency", "inStock",
      "activeIngredientsJson", "skinTypesJson",
      "concernsJson", "avoidIfJson",
      "pregnancySafety", "fragranceFree", "nonComedogenic",
      "sensitiveSkinSuitable", "merchantPriority", "updatedAt"
    )
    VALUES ${Prisma.join(rows)}
    ON CONFLICT ("tenantId", "sku") DO UPDATE SET
      "name" = EXCLUDED."name",
      "brand" = EXCLUDED."brand",
      "category" = EXCLUDED."category",
      "description" = EXCLUDED."description",
      "url" = EXCLUDED."url",
      "imageUrl" = EXCLUDED."imageUrl",
      "price" = EXCLUDED."price",
      "currency" = EXCLUDED."currency",
      "inStock" = EXCLUDED."inStock",
      "activeIngredientsJson" = EXCLUDED."activeIngredientsJson",
      "skinTypesJson" = EXCLUDED."skinTypesJson",
      "concernsJson" = EXCLUDED."concernsJson",
      "avoidIfJson" = EXCLUDED."avoidIfJson",
      "pregnancySafety" = EXCLUDED."pregnancySafety",
      "fragranceFree" = EXCLUDED."fragranceFree",
      "nonComedogenic" = EXCLUDED."nonComedogenic",
      "sensitiveSkinSuitable" = EXCLUDED."sensitiveSkinSuitable",
      "updatedAt" = NOW()
  `;
}
