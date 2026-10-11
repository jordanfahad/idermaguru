import type { Prisma } from "@prisma/client";
import { fetchIngredientLists, fetchShopProfile, fetchShopifyProducts } from "@/lib/shopify";
import { existingSkuIndex, invalidateCatalogue, markMissingOutOfStockForTenantId } from "@/services/catalog";
import { mapShopifyProduct, writeCatalogue } from "@/services/shopify-sync";

/**
 * One store's catalogue, pulled in.
 *
 * Lifted out of the admin route so the scheduled run and the dashboard button
 * are the same code rather than two copies that drift. The drift is the whole
 * risk: this function decides what a shopper is recommended, and a second
 * implementation of it would be a second place for the handle reconciliation,
 * the retire guard and the zero-price rule to be subtly wrong.
 *
 * Knows nothing about how it was authorised. The caller decides who is allowed
 * to run it — an admin session for the button, a shared secret for the cron —
 * and neither answer belongs down here.
 */

export type SyncConnection = {
  shop_domain: string;
  tenant_id: string;
  access_token: string;
};

export type SyncOutcome = {
  shop: string;
  fetched: number;
  imported: number;
  skipped: number;
  withIngredients: number;
  retired: number;
  truncated: boolean;
};

type PrismaLike = { $executeRaw: (query: Prisma.Sql) => Promise<number> };

const MAX_PRODUCTS = 1000;

export async function syncConnectedShop(connection: SyncConnection, prisma: PrismaLike): Promise<SyncOutcome> {
  const shop = connection.shop_domain;

  const [catalogue, profile] = await Promise.all([
    fetchShopifyProducts(shop, connection.access_token, MAX_PRODUCTS),
    fetchShopProfile(shop, connection.access_token),
  ]);
  const products = catalogue.products;

  // Fetched after the products, because it is keyed by their ids. A shop with
  // no custom.ingredients definition gets an empty map back and a catalogue
  // identical to the one it has today — see fetchIngredientLists.
  const ingredients = await fetchIngredientLists(
    shop,
    connection.access_token,
    products.map((product) => product.id),
  );

  // Which rows are already here for these products. Without this the first sync
  // of a catalogue that arrived by CSV writes a second copy of all of it.
  const existing = await existingSkuIndex(connection.tenant_id);

  const mapped = products
    .map((product) =>
      mapShopifyProduct(product, connection.tenant_id, shop, {
        currency: profile.currency ?? undefined,
        ingredients: ingredients.get(product.id),
        storefrontHost: profile.primaryDomain ?? undefined,
        sku:
          existing.byId.get(`shopify-${shop}-${product.id}`) ??
          existing.byHandle.get(product.handle.trim().toLowerCase()),
      }),
    )
    .filter((product): product is NonNullable<typeof product> => product !== null);

  const written = await writeCatalogue(prisma, mapped);

  // Everything the store no longer sells stops being recommendable — but only
  // when we know we saw the whole store. A rate limit part-way through the
  // pagination returns a slice, and retiring against a slice would take the
  // rest of the catalogue off the shelf. On a schedule this matters more than
  // it did on a button: nobody is watching the number afterwards.
  const retired = catalogue.complete
    ? await markMissingOutOfStockForTenantId(
        connection.tenant_id,
        mapped.map((product) => product.url),
      )
    : 0;

  // The advisor holds the catalogue in memory for a moment; a sync is exactly
  // the event that should make it read again.
  invalidateCatalogue();

  return {
    shop,
    fetched: products.length,
    imported: written,
    skipped: products.length - mapped.length,
    withIngredients: mapped.filter((product) => product.ingredientsJson.length > 0).length,
    retired,
    // Say so rather than quietly stopping at the cap: a merchant who cannot see
    // that half their catalogue was left out will not know to ask.
    truncated: !catalogue.complete,
  };
}
