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

/**
 * An INCI list as typed into a Shopify metafield, as an array.
 *
 * Commas are the separator on every carton in the world, and semicolons and
 * newlines are what a spreadsheet paste produces, so all three split. HTML is
 * stripped because a merchant pasting from a rich-text field brings tags with
 * them.
 *
 * Bounded on both axes. This value is typed by hand into 444 rows and then
 * read back on every catalogue load: one pathological cell should not be able
 * to bloat the cache or the payload.
 */
const MAX_INGREDIENTS = 80;
const MAX_INGREDIENT_LENGTH = 80;

export function parseIngredients(value: string | null | undefined): string[] {
  if (!value) return [];
  /*
   * Line breaks become commas BEFORE the HTML is stripped, and the order is
   * not incidental: stripHtml flattens every run of whitespace to a single
   * space, so a newline that survived until then would stop being a boundary
   * and two ingredients would be glued into one.
   *
   * Three forms of the same thing: a real newline from a spreadsheet paste,
   * and <br> or a closed block from a rich-text field.
   */
  const separated = String(value)
    .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/div>/gi, ",")
    .replace(/[\n\r]+/g, ",");
  return Array.from(
    new Set(
      stripHtml(separated)
        .split(/[,;]+/)
        .map((part) => part.replace(/\s+/g, " ").trim())
        // Drop the punctuation-only fragments a trailing "." or "()" leaves
        // behind, and anything too long to be an ingredient name.
        .filter((part) => part.length > 1 && part.length <= MAX_INGREDIENT_LENGTH && /[a-z]/i.test(part)),
    ),
  ).slice(0, MAX_INGREDIENTS);
}

function stripHtml(value: string | null | undefined): string {
  return (value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The same text, but with the block structure kept as newlines.
 *
 * stripHtml flattens a description to one line, which is the right shape for
 * regex matching and the wrong one for finding where a section starts and
 * stops. This keeps the paragraph and list breaks that tell "Ingredients:" from
 * the "How to use" heading three lines below it.
 */
function blockText(html: string | null | undefined): string {
  return String(html ?? "")
    .replace(/<\s*(br|\/p|\/li|\/div|\/h[1-6]|\/tr|\/td)\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/[^\S\n]+/g, " ")
    .trim();
}

/**
 * The ingredient list a merchant only ever wrote into the description.
 *
 * A fallback for the metafield, not a replacement: filling custom.ingredients
 * across a catalogue takes an afternoon, and until it is done most products
 * have their INCI list sitting in the description under a heading, where
 * nothing could read it.
 *
 * Deliberately hard to satisfy, because the failure mode is showing a shopper
 * "How to use: apply two pumps morning and evening" under the word
 * Ingredients. Two gates, both required: the list has to be long enough to be
 * an INCI list at all, and it has to contain at least one of the handful of
 * things that appear in nearly every cosmetic formula. Prose passes neither.
 */
const INGREDIENT_HEADING = /(?:^|\n)[^\S\n]*(?:full[^\S\n]+)?(?:ingredients?|inci|composition)\b[^\S\n]*[:：\-–]?[^\S\n]*/i;
const INCI_BEDROCK =
  /\b(aqua|water|glycerin|glycerine|butylene glycol|propylene glycol|phenoxyethanol|dimethicone|cetearyl|caprylic|sodium hydroxide|tocopherol|citric acid|xanthan|parfum|fragrance)\b/i;
const MIN_INCI_PARTS = 5;
/** Where an ingredient list ends: the next thing a product page talks about. */
const SECTION_LABEL =
  /^(?:how to use|how to apply|directions?|usage|application|benefits?|key benefits|description|about|details|size|volume|net wt|weight|warnings?|caution|precautions?|storage|suitable for|skin type|made in|shelf life|expiry)\b/i;

export function ingredientsFromDescription(bodyHtml: string | null | undefined): string[] {
  const text = blockText(bodyHtml);
  if (!text) return [];

  const heading = INGREDIENT_HEADING.exec(text);
  if (!heading) return [];

  const lines: string[] = [];
  for (const line of text.slice(heading.index + heading[0].length).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (lines.length) break;
      continue;
    }
    if (SECTION_LABEL.test(trimmed)) break;
    lines.push(trimmed);
  }

  const parsed = parseIngredients(lines.join(", "));
  if (parsed.length < MIN_INCI_PARTS) return [];
  return INCI_BEDROCK.test(parsed.join(" ")) ? parsed : [];
}

export type MapOptions = {
  /**
   * The shop's own currency, read from the Shopify shop endpoint at sync time.
   * This used to be hardcoded to AED, which is right for one merchant in Dubai
   * and wrong for every other store this is sold to — their prices would have
   * been relabelled into a currency they do not trade in.
   */
  currency?: string;
  /**
   * The custom.ingredients metafield, when the merchant keeps one. Passed in
   * rather than fetched here because it arrives from a separate GraphQL call —
   * REST's products.json carries no metafields, which is why this field was
   * empty for as long as it has existed.
   */
  ingredients?: string | null;
  /**
   * The host to build product links from. Without it the link points at the
   * raw myshopify domain, which is not where the shop's own catalogue rows
   * point and not a domain a shopper recognises.
   */
  storefrontHost?: string;
  /**
   * The SKU an existing row already holds for this product, when the catalogue
   * has one. Reusing it makes the write an update of that row instead of an
   * insert beside it — see the sync route, which resolves it.
   */
  sku?: string;
};

export function mapShopifyProduct(
  product: ShopifyProduct,
  tenantId: string,
  shopDomain: string,
  options: MapOptions = {},
): ProductCatalogItem | null {
  const variant = product.variants?.[0];
  const price = Number.parseFloat(variant?.price ?? "");
  if (!product.title || !Number.isFinite(price)) return null;

  const currency = options.currency ?? "AED";
  const description = stripHtml(product.body_html).slice(0, 900);
  const fromMetafield = parseIngredients(options.ingredients);
  const ingredientsJson = fromMetafield.length ? fromMetafield : ingredientsFromDescription(product.body_html);
  /*
   * Everything below is derived from this string, and the ingredient list is
   * now part of it.
   *
   * That is the real value of the metafield, and it is not the chip. Actives
   * were being matched against a marketing title and a description — so a
   * retinol cream sold as "Overnight Renewal Treatment" had no actives, an
   * UNKNOWN pregnancy status, and sailed past the pregnancy gate. An INCI list
   * names what is actually in the bottle.
   *
   * Capped: an ingredient list can run to hundreds of terms, and the
   * description is already capped for the same reason.
   */
  const text = `${product.title} ${description} ${product.product_type ?? ""} ${product.tags ?? ""} ${ingredientsJson
    .join(" ")
    .slice(0, 1200)}`;

  const inventory = variant?.inventory_quantity;
  return {
    id: `shopify-${shopDomain}-${product.id}`,
    tenantId,
    sku: options.sku || variant?.sku || String(product.id),
    name: product.title.slice(0, 300),
    brand: product.vendor || shopDomain.replace(".myshopify.com", ""),
    category: (product.product_type || "skincare").toLowerCase(),
    description: description || product.title,
    url: `https://${options.storefrontHost || shopDomain}/products/${product.handle}`,
    imageUrl: product.images?.[0]?.src ?? null,
    price,
    currency,
    // Draft/archived products are never sellable; treat unknown inventory as available.
    inStock: product.status === "active" && (inventory === undefined || inventory === null || inventory > 0),
    ingredientsJson,
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
      ${JSON.stringify(item.ingredientsJson)}::jsonb,
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
      "ingredientsJson",
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
      -- Only when this sync actually found a list. A merchant part-way through
      -- filling custom.ingredients would otherwise have the sync blank every
      -- row they had not reached yet, wiping lists that arrived by CSV.
      "ingredientsJson" = CASE
        WHEN jsonb_array_length(EXCLUDED."ingredientsJson") > 0 THEN EXCLUDED."ingredientsJson"
        ELSE "Product"."ingredientsJson"
      END,
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
