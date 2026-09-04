import { Prisma } from "@prisma/client";
import type { ProductCatalogItem } from "@/domain/skincare";
import type { ShopifyProduct } from "@/lib/shopify";
import { BRAND_BY_HANDLE } from "@/data/brand-registry";

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
  // The four `ingredient:` tags the store curates that this list had no word
  // for. None of them changes a safety derivation — they match no pregnancy or
  // strength pattern — but "what's in it" is unanswerable without them, and on
  // a snail mucin essence the snail is the entire answer.
  { term: "collagen", match: /collagen/i },
  { term: "snail mucin", match: /snail/i },
  { term: "rice", match: /\brice\b/i },
  { term: "mugwort", match: /mugwort|artemisia/i },
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

/**
 * The store's own tag vocabulary, which is better than anything we can infer.
 *
 * Cicabelle's catalogue was restructured into four tag namespaces — `brand:`,
 * `type:`, `concern:`, `ingredient:` — and this is curated data about what a
 * product is and what it treats, sitting in the REST payload we already fetch.
 * Everything below it in this file guesses the same facts by running regexes
 * over marketing copy. A tag beats a guess every time.
 *
 * Read as an addition, never a replacement. Only 68% of the catalogue carries a
 * concern tag, so switching to tags alone would strip the other third of
 * everything they have; and a shop with no tag scheme at all — every other
 * merchant this is sold to — has to keep syncing exactly as it does now.
 *
 * The tags string is attacker-adjacent only in the sense that it is free text a
 * merchant types, so the loop is bounded and the values are matched against a
 * fixed vocabulary rather than trusted.
 */
const MAX_TAGS = 250;
const MAX_TAG_VALUES = 40;

/**
 * `concern:` values, mapped onto the vocabulary the recommender speaks.
 *
 * Four of the nine do not survive a round trip through the regexes below —
 * "ageing" does not match /anti-?ag/, "sensitivity" does not match /sensitive/,
 * "sun-protection" matches none of /spf|sunscreen|uv/ — so this map is what
 * makes them count rather than a nicety.
 */
const TAGGED_CONCERN: Record<string, string> = {
  acne: "acne",
  pigmentation: "dark spots",
  ageing: "fine lines",
  aging: "fine lines",
  dryness: "dryness",
  sensitivity: "redness",
  pores: "pores",
  "hair-loss": "hair fall",
  "hair-fall": "hair fall",
  // 31 active products, and the value this map was missing when it was written
  // from a summary rather than from the store. There is no "damaged hair" in
  // the recommender's vocabulary, so it lands in the general hair bucket —
  // which is where a shopper asking about it would be answered from anyway.
  "damaged-hair": "hair",
  dandruff: "dandruff",
  "sun-protection": "sun protection",
};

type ProductTags = { brand: string | null; concerns: string[]; actives: string[] };

export function readProductTags(tags: string | null | undefined): ProductTags {
  let brand: string | null = null;
  const concerns: string[] = [];
  const actives: string[] = [];

  for (const raw of String(tags ?? "").split(",").slice(0, MAX_TAGS)) {
    const tag = raw.trim().toLowerCase();
    const colon = tag.indexOf(":");
    if (colon < 1) continue;

    const value = tag.slice(colon + 1).trim();
    if (!value) continue;

    switch (tag.slice(0, colon)) {
      case "brand":
        // First one wins; a product belongs to one brand.
        if (!brand) brand = brandName(value);
        break;
      case "concern": {
        const mapped = TAGGED_CONCERN[value];
        if (mapped && !concerns.includes(mapped) && concerns.length < MAX_TAG_VALUES) concerns.push(mapped);
        break;
      }
      case "ingredient": {
        // Kept as words rather than a slug, because these are then matched
        // against the ACTIVES vocabulary: "vitamin-c" misses /vitamin c/.
        const term = deslug(value);
        if (term && !actives.includes(term) && actives.length < MAX_TAG_VALUES) actives.push(term);
        break;
      }
    }
  }

  return { brand, concerns, actives };
}

function deslug(value: string): string {
  return value.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

/**
 * How a brand actually spells itself, when we already know.
 *
 * A tag is a slug, and de-slugging one guesses at the capitalisation: `cosrx`
 * becomes "Cosrx", which is not how COSRX writes it, and `la-roche-posay`
 * becomes "La Roche Posay" rather than "La Roche-Posay". A shopper who asked
 * for a brand by name and is shown a misspelling of it has been given a reason
 * to doubt the whole answer.
 *
 * The brand registry is a hand-classified export that already carries the
 * right spelling for 425 products, so it is used here as a dictionary rather
 * than as a second guess. Anything it does not know keeps the title-cased
 * de-slug, which is still better than the vendor column — that says
 * "Cicabelle" on every product in the store.
 */
const BRAND_SPELLING: Map<string, string> = (() => {
  const spelling = new Map<string, string>();
  for (const entry of Object.values(BRAND_BY_HANDLE)) {
    const slug = entry.brand.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (slug && !spelling.has(slug)) spelling.set(slug, entry.brand);
  }
  return spelling;
})();

function brandName(slug: string): string {
  return BRAND_SPELLING.get(slug) ?? titleCase(deslug(slug));
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

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

/**
 * A Shopify object id. Never an ingredient, and the thing a reference-type
 * metafield stores instead of one.
 */
const GID = /^gid:\/\/shopify\//i;

/**
 * The shape a metafield's value arrives in depends on the type the merchant
 * picked when they created the definition, and only one of those types is a
 * plain string.
 *
 * The guide says multi-line text, but the definition screen offers a dozen
 * types and the value comes back as an opaque string whatever they chose:
 *
 *   multi-line text     "Aqua, Glycerin, Niacinamide"
 *   list of text        "[\"Aqua\",\"Glycerin\",\"Niacinamide\"]"
 *   rich text           "{\"type\":\"root\",\"children\":[…]}"
 *   metaobject list     "[\"gid://shopify/Metaobject/123\", …]"
 *
 * Reading all four is not politeness. A merchant who picked "list of single
 * line text" — a perfectly reasonable reading of "put the ingredients here" —
 * would otherwise have had `["Aqua"` and `"Glycerin"` shown to their shoppers
 * as ingredients, on 444 products, with nothing in the sync to say so.
 */
function jsonList(trimmed: string): string[] | null {
  if (trimmed.charAt(0) !== "[") return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return null;
  }
}

/** Every text run in a rich-text tree, with a separator where a line ended. */
function richTextRuns(node: unknown, into: string[]): void {
  if (Array.isArray(node)) {
    for (const child of node) richTextRuns(child, into);
    return;
  }
  if (!node || typeof node !== "object") return;

  const record = node as Record<string, unknown>;
  if (typeof record.value === "string") into.push(record.value);
  if (record.children) {
    richTextRuns(record.children, into);
    // Runs inside one paragraph are pieces of one line — bold on part of it is
    // enough to split them — so they join with nothing. The end of a paragraph
    // or a bullet is a real boundary.
    if (record.type === "paragraph" || record.type === "list-item") into.push(", ");
  }
}

export function parseIngredients(value: string | null | undefined): string[] {
  if (!value) return [];

  const trimmed = String(value).trim();

  const list = jsonList(trimmed);
  if (list) {
    // A reference list holds ids. We could resolve them with another GraphQL
    // hop, but showing a shopper "gid://shopify/Metaobject/123" is worse than
    // showing them nothing, and nothing lets the description fallback try.
    if (list.some((entry) => GID.test(entry.trim()))) return [];
    return splitIngredients(list.join(", "));
  }

  if (trimmed.charAt(0) === "{") {
    try {
      const runs: string[] = [];
      richTextRuns(JSON.parse(trimmed), runs);
      if (runs.length) return splitIngredients(runs.join(""));
    } catch {
      // Not rich text after all. Fall through and read it as plain text.
    }
  }

  return splitIngredients(trimmed);
}

function splitIngredients(value: string): string[] {
  /*
   * Line breaks become commas BEFORE the HTML is stripped, and the order is
   * not incidental: stripHtml flattens every run of whitespace to a single
   * space, so a newline that survived until then would stop being a boundary
   * and two ingredients would be glued into one.
   *
   * Three forms of the same thing: a real newline from a spreadsheet paste,
   * and <br> or a closed block from a rich-text field.
   */
  const separated = value
    .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/div>/gi, ",")
    .replace(/[\n\r]+/g, ",");
  return Array.from(
    new Set(
      stripHtml(separated)
        .split(/[,;]+/)
        .map((part) => part.replace(/\s+/g, " ").trim())
        // Drop the punctuation-only fragments a trailing "." or "()" leaves
        // behind, anything too long to be an ingredient name, and any object id
        // that reached this path as a single reference rather than a list.
        .filter(
          (part) =>
            part.length > 1 && part.length <= MAX_INGREDIENT_LENGTH && /[a-z]/i.test(part) && !GID.test(part),
        ),
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
  const tagged = readProductTags(product.tags);
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
   * The raw tags are here too, and the de-slugged ingredient tags alongside
   * them, which is not redundant: the raw string carries "ingredient:vitamin-c"
   * and the ACTIVES entry looks for /vitamin c/, so without the second copy the
   * store's own curated answer misses on the hyphen.
   *
   * Capped: an ingredient list can run to hundreds of terms, and the
   * description is already capped for the same reason.
   */
  const text = `${product.title} ${description} ${product.product_type ?? ""} ${product.tags ?? ""} ${tagged.actives.join(
    " ",
  )} ${ingredientsJson.join(" ").slice(0, 1200)}`;

  const inventory = variant?.inventory_quantity;
  return {
    id: `shopify-${shopDomain}-${product.id}`,
    tenantId,
    sku: options.sku || variant?.sku || String(product.id),
    name: product.title.slice(0, 300),
    // The brand tag first, because it only exists where somebody curated it —
    // and where it does, vendor is the store's own name on every product.
    brand: tagged.brand || product.vendor || shopDomain.replace(".myshopify.com", ""),
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
    // Union, not replacement: a third of the catalogue carries no concern tag
    // and would lose everything the copy says about it.
    concernsJson: unique([...CONCERNS.filter((c) => c.match.test(text)).map((c) => c.term), ...tagged.concerns]),
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
