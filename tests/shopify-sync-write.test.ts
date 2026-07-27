import { describe, expect, it } from "vitest";
import type { ProductCatalogItem } from "../src/domain/skincare";
import { writeCatalogue } from "../src/services/shopify-sync";

function product(sku: string, name = sku): ProductCatalogItem {
  return {
    id: `shopify-demo-${sku}`,
    tenantId: "tenant_demo",
    sku,
    name,
    brand: "Demo",
    category: "serum",
    description: "d",
    url: "https://example.test/p",
    imageUrl: null,
    price: 10,
    currency: "AED",
    inStock: true,
    ingredientsJson: [],
    activeIngredientsJson: [],
    skinTypesJson: [],
    concernsJson: [],
    avoidIfJson: [],
    pregnancySafety: "UNKNOWN",
    fragranceFree: false,
    nonComedogenic: false,
    sensitiveSkinSuitable: false,
    claimsJson: [],
    approvedClaimsJson: [],
    merchantPriority: 50,
    sponsoredBidCpc: 0,
  } as ProductCatalogItem;
}

function recorder(failOn?: (values: unknown[]) => boolean) {
  const statements: unknown[][] = [];
  return {
    statements,
    prisma: {
      $executeRaw: async (query: { values: unknown[] }) => {
        if (failOn?.(query.values)) throw new Error("conflict");
        statements.push(query.values);
        return query.values.length;
      },
    },
  };
}

describe("catalogue writes", () => {
  it("writes a catalogue in batches, not one round trip per product", () => {
    // 900 products used to be 900 sequential upserts, which ran past the
    // serverless timeout and failed the whole sync.
    const { statements, prisma } = recorder();
    const items = Array.from({ length: 450 }, (_, i) => product(`SKU-${i}`));
    return writeCatalogue(prisma as never, items).then((written) => {
      expect(written).toBe(450);
      expect(statements).toHaveLength(3); // 200 + 200 + 50
    });
  });

  it("collapses duplicate SKUs so one statement can't conflict with itself", async () => {
    const { statements, prisma } = recorder();
    const written = await writeCatalogue(prisma as never, [
      product("SAME", "first"),
      product("SAME", "second"),
      product("OTHER"),
    ]);
    expect(written).toBe(2);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain("second"); // last one wins
    expect(statements[0]).not.toContain("first");
  });

  it("retries a failed batch product by product", async () => {
    // A whole chunk must not be lost because one row in it is unwritable.
    // Any statement carrying the bad row fails — first the whole batch, then
    // that row on its own.
    const { statements, prisma } = recorder((values) => values.includes("BAD"));
    const written = await writeCatalogue(
      prisma as never,
      [product("GOOD-1"), product("BAD"), product("GOOD-2")],
      3,
    );
    expect(written).toBe(2);
    expect(statements).toHaveLength(2); // the two good rows, individually
  });
});
