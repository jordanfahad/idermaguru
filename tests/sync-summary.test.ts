import { describe, expect, it } from "vitest";
import { syncSummary } from "@/components/shopify-panel";

/**
 * What the merchant reads after pressing Sync.
 *
 * The route has always returned more than the panel showed, and two of the
 * numbers are the difference between a sync you can trust and one you cannot
 * see into.
 */

const shop = "a1ce04.myshopify.com";

describe("the line a merchant reads after a sync", () => {
  it("says what came in", () => {
    expect(syncSummary(shop, { imported: 497, fetched: 497, withIngredients: 300 })).toContain(
      "Imported 497 of 497 products",
    );
  });

  it("says what it took off the shelf", () => {
    // A write, not a statistic. Somebody who cannot see this number cannot
    // tell a healthy sync from one that quietly emptied their catalogue.
    expect(syncSummary(shop, { imported: 497, fetched: 497, retired: 12, withIngredients: 1 })).toContain(
      "12 no longer in the store, marked out of stock",
    );
  });

  it("says how to fix it when no ingredient list was found", () => {
    // The failure is otherwise invisible: the sync reports success, and the
    // ingredient chip is simply never there.
    const line = syncSummary(shop, { imported: 497, fetched: 497, withIngredients: 0 });
    expect(line).toContain("no ingredient lists found");
    expect(line).toContain("custom.ingredients");
  });

  it("does not claim anything was retired on a partial sync", () => {
    // Retiring runs only against a complete fetch, so saying nothing here
    // would leave a merchant expecting a cleanup that deliberately did not run.
    const line = syncSummary(shop, { imported: 250, fetched: 250, truncated: true, withIngredients: 5 });
    expect(line).toContain("only part of the store, so nothing was retired");
  });

  it("stays quiet about the counts that are zero", () => {
    const line = syncSummary(shop, { imported: 497, fetched: 497, withIngredients: 497 });
    expect(line).not.toContain("skipped");
    expect(line).not.toContain("out of stock");
  });
});
