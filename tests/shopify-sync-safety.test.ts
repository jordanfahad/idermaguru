import { afterEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { fetchShopProfile, fetchShopifyProducts } from "@/lib/shopify";
import { mapShopifyProduct, writeCatalogue, type ShopifyProduct } from "@/services/shopify-sync";
import { existingSkuIndex, markMissingOutOfStockForTenantId } from "@/services/catalog";

/**
 * What has to be true before a sync is allowed to run against a live shop.
 *
 * Cicabelle's catalogue — 461 rows, 444 products, all of it imported from a CSV
 * a month ago — has never been synced. Running the sync as it was written would
 * have done three things at once, and each one is tested here:
 *
 *   1. written a second copy of the whole catalogue, because the conflict key
 *      is (tenantId, sku) and a CSV SKU is `csv-<timestamp>-<row>`, which no
 *      Shopify variant will ever match;
 *   2. repointed every product link at a1ce04.myshopify.com, a domain no
 *      shopper has seen and none of the existing rows use;
 *   3. left the stale generation in stock beside the fresh one, so a shopper
 *      would be shown the same product twice with two different prices.
 *
 * And a fourth, quieter one: the ingredient list the mapper had just learned to
 * read was never written to the database at all.
 */

const stubTx = {
  rows: [] as { id: string; sku: string; url: string | null }[],
  updated: 0,
  product: {
    findMany: async () => stubTx.rows,
    updateMany: async () => ({ count: stubTx.updated }),
  },
};

vi.mock("@/lib/tenant-context", () => ({
  withTenant: vi.fn(async (_tenantId: string, fn: (tx: unknown) => Promise<unknown>) => fn(stubTx)),
}));

const { withTenant } = await import("@/lib/tenant-context");

function product(overrides: Partial<ShopifyProduct> = {}): ShopifyProduct {
  return {
    id: 900,
    title: "Snail 92 Repair Cream",
    body_html: "<p>A barrier cream.</p>",
    vendor: "Cicabelle",
    product_type: "moisturiser",
    handle: "snail-92-repair-cream",
    tags: "",
    status: "active",
    images: [{ src: "https://cdn.example/a.jpg" }],
    variants: [{ id: 1, price: "89.00", sku: "SNAIL-92", inventory_quantity: 3 }],
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(withTenant).mockClear();
  stubTx.rows = [];
  stubTx.updated = 0;
});

describe("the link a synced product carries", () => {
  it("uses the domain the shop actually trades on", () => {
    const mapped = mapShopifyProduct(product(), "t", "a1ce04.myshopify.com", { storefrontHost: "cicabelle.com" });
    expect(mapped?.url).toBe("https://cicabelle.com/products/snail-92-repair-cream");
  });

  it("falls back to the myshopify host rather than inventing one", () => {
    // A store with no custom domain, or a shop.json call that failed. The old
    // link is still a working link; a guessed one would not be.
    const mapped = mapShopifyProduct(product(), "t", "a1ce04.myshopify.com");
    expect(mapped?.url).toBe("https://a1ce04.myshopify.com/products/snail-92-repair-cream");
  });
});

describe("which row a synced product lands on", () => {
  it("takes the SKU of the row already holding this product", () => {
    // The whole point: (tenantId, sku) is the conflict key, so reusing the SKU
    // is what turns an INSERT beside the existing row into an UPDATE of it.
    const mapped = mapShopifyProduct(product(), "t", "shop.myshopify.com", { sku: "csv-1779892727413-238" });
    expect(mapped?.sku).toBe("csv-1779892727413-238");
  });

  it("uses the Shopify SKU for a product the catalogue has never seen", () => {
    expect(mapShopifyProduct(product(), "t", "shop.myshopify.com")?.sku).toBe("SNAIL-92");
  });

  it("indexes existing rows by handle and by sync id, so either can match", async () => {
    stubTx.rows = [
      { id: "cuid-1", sku: "csv-1-1", url: "https://cicabelle.com/products/snail-92-repair-cream" },
      { id: "shopify-a1ce04.myshopify.com-900", sku: "SNAIL-OLD", url: null },
    ];
    const index = await existingSkuIndex("tenant-1");
    expect(index.byHandle.get("snail-92-repair-cream")).toBe("csv-1-1");
    expect(index.byId.get("shopify-a1ce04.myshopify.com-900")).toBe("SNAIL-OLD");
  });

  it("keeps one row per handle when a product is carried on two domains", async () => {
    // Both spellings of the same product page exist in this catalogue. One row
    // gets adopted; the other falls out of stock, which is the right outcome
    // whichever of the two is picked.
    stubTx.rows = [
      { id: "a", sku: "sku-a", url: "https://cicabelle.com/products/snail-92-repair-cream" },
      { id: "b", sku: "sku-b", url: "https://a1ce04.myshopify.com/products/snail-92-repair-cream" },
    ];
    const index = await existingSkuIndex("tenant-1");
    expect(index.byHandle.size).toBe(1);
    expect(index.byHandle.get("snail-92-repair-cream")).toBe("sku-a");
  });
});

describe("retiring what the store no longer sells", () => {
  it("refuses to act on an empty list", async () => {
    // `notIn: []` matches every row in Postgres, so this is the difference
    // between "nothing to retire" and "retire the entire catalogue".
    expect(await markMissingOutOfStockForTenantId("tenant-1", [])).toBe(0);
    expect(withTenant).not.toHaveBeenCalled();
  });

  it("retires the rows the sync did not see", async () => {
    stubTx.updated = 17;
    expect(await markMissingOutOfStockForTenantId("tenant-1", ["https://cicabelle.com/products/a"])).toBe(17);
    expect(withTenant).toHaveBeenCalledOnce();
  });
});

describe("knowing whether we saw the whole store", () => {
  function respond(pages: { ok: boolean; products?: unknown[]; next?: string }[]) {
    let call = 0;
    vi.stubGlobal("fetch", async () => {
      const page = pages[Math.min(call++, pages.length - 1)];
      return {
        ok: page.ok,
        headers: { get: () => (page.next ? `<${page.next}>; rel="next"` : "") },
        json: async () => ({ products: page.products ?? [] }),
      } as unknown as Response;
    });
  }

  it("reports a single complete page as complete", async () => {
    respond([{ ok: true, products: [product()] }]);
    const result = await fetchShopifyProducts("shop.myshopify.com", "token");
    expect(result.products).toHaveLength(1);
    expect(result.complete).toBe(true);
  });

  it("reports a failed page as incomplete, so nothing is retired against a slice", async () => {
    // A rate limit on page two of four used to be indistinguishable from a
    // store that had discontinued three quarters of its catalogue.
    respond([
      { ok: true, products: [product()], next: "https://shop.myshopify.com/page2" },
      { ok: false },
    ]);
    const result = await fetchShopifyProducts("shop.myshopify.com", "token");
    expect(result.products).toHaveLength(1);
    expect(result.complete).toBe(false);
  });

  it("reports a run cut short by the cap as incomplete", async () => {
    respond([{ ok: true, products: [product(), product({ id: 901 })], next: "https://shop.myshopify.com/page2" }]);
    const result = await fetchShopifyProducts("shop.myshopify.com", "token", 2);
    expect(result.complete).toBe(false);
  });
});

describe("reading the shop's own settings", () => {
  it("reads the currency and the primary domain", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({ shop: { currency: "aed", domain: "cicabelle.com" } }),
    }) as unknown as Response);
    expect(await fetchShopProfile("a1ce04.myshopify.com", "token")).toEqual({
      currency: "AED",
      primaryDomain: "cicabelle.com",
    });
  });

  it("returns nulls rather than guesses when the call fails", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false }) as unknown as Response);
    expect(await fetchShopProfile("a1ce04.myshopify.com", "token")).toEqual({
      currency: null,
      primaryDomain: null,
    });
  });

  it("rejects a domain that is not a hostname", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({ shop: { currency: "AED", domain: "not a domain" } }),
    }) as unknown as Response);
    expect((await fetchShopProfile("a1ce04.myshopify.com", "token")).primaryDomain).toBeNull();
  });
});

describe("what actually reaches the database", () => {
  function statementFor(ingredients: string[]) {
    let captured: Prisma.Sql | null = null;
    const prisma = {
      $executeRaw: async (query: Prisma.Sql) => {
        captured = query;
        return 1;
      },
    };
    const item = mapShopifyProduct(product(), "t", "shop.myshopify.com", {
      ingredients: ingredients.join(", "),
    })!;
    return writeCatalogue(prisma as never, [item]).then(() => captured!);
  }

  it("writes the ingredient list", async () => {
    // It did not. The mapper computed ingredientsJson and the INSERT never
    // named the column, so the metafield reader shipped inert: the sync could
    // read a merchant's INCI list and then drop it on the floor.
    const statement = await statementFor(["Aqua", "Glycerin", "Niacinamide"]);
    expect(statement.sql).toContain('"ingredientsJson"');
    expect(statement.values).toContain('["Aqua","Glycerin","Niacinamide"]');
  });

  it("keeps a list already on the row when this sync found none", async () => {
    // A merchant part-way through filling 444 metafields must not have the sync
    // blank the rows they have not reached yet.
    const statement = await statementFor([]);
    expect(statement.sql).toContain("jsonb_array_length");
    expect(statement.sql).toContain('"Product"."ingredientsJson"');
  });
});
