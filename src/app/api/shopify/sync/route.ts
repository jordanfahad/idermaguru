import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAdminSessionCookieName, verifyAdminSession } from "@/lib/admin-auth";
import { fetchShopifyProducts, normaliseShopDomain } from "@/lib/shopify";
import { mapShopifyProduct } from "@/services/shopify-sync";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getPrisma } from "@/server/db";
import { jsonError } from "../../_shared";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Pulls a connected store's catalogue into the recommendation engine.
 *
 * Admin-only: syncing writes the catalogue every shopper is then recommended
 * from, so it must not be triggerable by an anonymous request.
 * POST /api/shopify/sync { shop }
 */
export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = await verifyAdminSession(cookieStore.get(getAdminSessionCookieName())?.value);
  if (!session) return jsonError("Admin login required.", 401);

  let shopInput = "";
  try {
    shopInput = ((await request.json()) as { shop?: string }).shop ?? "";
  } catch {
    return jsonError("Provide a shop domain.", 400);
  }

  const shop = normaliseShopDomain(shopInput);
  if (!shop) return jsonError("Provide a valid *.myshopify.com domain.", 400);

  const supabase = getSupabaseAdmin();
  if (!supabase) return jsonError("Storage is not configured.", 503);

  const { data: connection, error } = await supabase
    .from("shopify_shops")
    .select("shop_domain,tenant_id,access_token")
    .eq("shop_domain", shop)
    .maybeSingle();

  if (error) return jsonError(error.message, 500);
  if (!connection) return jsonError("That store is not connected. Run the install first.", 404);

  const prisma = getPrisma();
  if (!prisma) return jsonError("Database is not configured.", 503);

  const products = await fetchShopifyProducts(shop, connection.access_token);
  const mapped = products
    .map((product) => mapShopifyProduct(product, connection.tenant_id, shop))
    .filter((product): product is NonNullable<typeof product> => product !== null);

  let written = 0;
  for (const product of mapped) {
    try {
      await prisma.product.upsert({
        where: { id: product.id },
        create: product,
        update: {
          name: product.name,
          brand: product.brand,
          category: product.category,
          description: product.description,
          url: product.url,
          imageUrl: product.imageUrl,
          price: product.price,
          inStock: product.inStock,
          activeIngredientsJson: product.activeIngredientsJson,
          skinTypesJson: product.skinTypesJson,
          concernsJson: product.concernsJson,
          avoidIfJson: product.avoidIfJson,
          pregnancySafety: product.pregnancySafety,
          fragranceFree: product.fragranceFree,
          nonComedogenic: product.nonComedogenic,
          sensitiveSkinSuitable: product.sensitiveSkinSuitable,
        },
      });
      written += 1;
    } catch {
      // One malformed product must not abort the whole catalogue.
    }
  }

  await supabase
    .from("shopify_shops")
    .update({ last_sync_at: new Date().toISOString(), last_sync_count: written, updated_at: new Date().toISOString() })
    .eq("shop_domain", shop);

  return NextResponse.json({
    shop,
    fetched: products.length,
    imported: written,
    skipped: products.length - mapped.length,
  });
}
