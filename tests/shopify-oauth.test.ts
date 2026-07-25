import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { isValidShopDomain, normaliseShopDomain, verifyShopifyHmac } from "../src/lib/shopify";
import { mapShopifyProduct, type ShopifyProduct } from "../src/services/shopify-sync";

const SECRET = "test-shopify-secret";

function signParams(params: Record<string, string>): URLSearchParams {
  const message = Object.entries(params)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const hmac = createHmac("sha256", SECRET).update(message).digest("hex");
  return new URLSearchParams({ ...params, hmac });
}

describe("shop domain validation", () => {
  it("accepts real myshopify domains", () => {
    expect(isValidShopDomain("cicabelle.myshopify.com")).toBe(true);
    expect(normaliseShopDomain("https://Cicabelle.myshopify.com/admin")).toBe("cicabelle.myshopify.com");
  });

  it("rejects look-alikes and injection attempts", () => {
    for (const shop of [
      "evil.com",
      "cicabelle.myshopify.com.evil.com",
      "cicabelle.myshopify.co",
      "cicabelle myshopify.com",
      "../cicabelle.myshopify.com",
      "",
    ]) {
      expect(isValidShopDomain(shop)).toBe(false);
      expect(normaliseShopDomain(shop)).toBeNull();
    }
  });
});

describe("Shopify OAuth HMAC", () => {
  it("accepts a correctly signed callback", async () => {
    const params = signParams({
      code: "abc123",
      shop: "cicabelle.myshopify.com",
      state: "nonce",
      timestamp: "1700000000",
    });
    expect(await verifyShopifyHmac(params, SECRET)).toBe(true);
  });

  it("rejects a tampered parameter", async () => {
    const params = signParams({ code: "abc123", shop: "cicabelle.myshopify.com", state: "nonce" });
    params.set("shop", "evil.myshopify.com");
    expect(await verifyShopifyHmac(params, SECRET)).toBe(false);
  });

  it("rejects a missing or wrong-secret signature", async () => {
    const params = signParams({ code: "abc", shop: "cicabelle.myshopify.com" });
    expect(await verifyShopifyHmac(params, "wrong-secret")).toBe(false);
    params.delete("hmac");
    expect(await verifyShopifyHmac(params, SECRET)).toBe(false);
  });
});

describe("Shopify product mapping keeps the safety fields populated", () => {
  const base: ShopifyProduct = {
    id: 12345,
    title: "Retinol Renewal Night Serum",
    body_html: "<p>A <b>retinol</b> serum for fine lines.</p>",
    vendor: "Test Brand",
    product_type: "Serum",
    handle: "retinol-renewal",
    status: "active",
    images: [{ src: "https://cdn.example/img.jpg" }],
    variants: [{ id: 1, price: "129.00", sku: "RET-1", inventory_quantity: 4 }],
  };

  it("flags a retinoid so the pregnancy filter can see it", () => {
    const mapped = mapShopifyProduct(base, "tenant_x", "store.myshopify.com");
    expect(mapped?.activeIngredientsJson).toContain("retinol");
    expect(mapped?.pregnancySafety).toBe("AVOID");
    expect(mapped?.avoidIfJson).toContain("pregnancy");
    expect(mapped?.sensitiveSkinSuitable).toBe(false);
  });

  it("marks draft and out-of-stock products unsellable", () => {
    expect(mapShopifyProduct({ ...base, status: "draft" }, "t", "s.myshopify.com")?.inStock).toBe(false);
    expect(
      mapShopifyProduct(
        { ...base, variants: [{ id: 1, price: "10.00", inventory_quantity: 0 }] },
        "t",
        "s.myshopify.com",
      )?.inStock,
    ).toBe(false);
  });

  it("skips products with no usable price", () => {
    expect(mapShopifyProduct({ ...base, variants: [] }, "t", "s.myshopify.com")).toBeNull();
  });

  it("keeps a gentle product marked sensitive-safe", () => {
    const gentle = mapShopifyProduct(
      { ...base, title: "Centella Barrier Cream", body_html: "<p>Fragrance-free soothing ceramide cream.</p>" },
      "t",
      "s.myshopify.com",
    );
    expect(gentle?.sensitiveSkinSuitable).toBe(true);
    expect(gentle?.pregnancySafety).toBe("UNKNOWN");
  });
});
