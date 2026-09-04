import { describe, expect, it } from "vitest";
import { ingredientsFromDescription, mapShopifyProduct, type ShopifyProduct } from "@/services/shopify-sync";

/**
 * The description matcher against real merchant copy.
 *
 * Two products that had nothing but their titles now carry ~190 words each,
 * written to be cosmetic-claims-only. That is exactly the input the ingredient
 * extractor is most likely to get wrong: long, structured, headed prose with no
 * INCI list anywhere in it. A false positive here puts marketing sentences on a
 * product page under the word "Ingredients", which is worse than the empty
 * chip it replaced.
 *
 * The copy below is representative rather than verbatim — the live text has
 * not reached our catalogue yet. It is written to the shape Command Center
 * described: claims, a how-to, and a closing section, one with an ingredient
 * list and one without, because those are the two cases and they must behave
 * differently.
 */

const DEVICE = `<p>The G15 Light Therapy Silicone Mask brings salon-style light care into an
evening routine that takes fifteen minutes. The flexible medical-grade silicone shell moulds
to the contours of the face, so the light sits close to the skin across the cheeks, forehead
and chin rather than hovering above them.</p>
<p>Three modes are built in. Red light is the one most people start with, used to support the
look of firmness and a smoother appearance over time. Blue light is aimed at skin that looks
congested and uneven. The combined mode alternates the two across a single session.</p>
<p>Benefits: helps skin look calmer and more even; supports a smoother, firmer appearance;
comfortable enough to wear while reading or winding down.</p>
<p>How to use: cleanse and dry the face, fit the mask, and choose a mode. Fifteen minutes,
three to five evenings a week. Follow with a serum and moisturiser.</p>
<p>Good to know: cordless and rechargeable, with eye shielding built into the shell. Not a
medical device and not intended to treat any condition.</p>`;

const BODY_WASH = `<p>A rich, foaming body wash built around traditional West African black soap,
made with shea butter and plantain ash in the way it has been prepared for generations.</p>
<p>The lather is generous and rinses clean, leaving skin feeling comfortable rather than
tight. Formulated for skin that looks congested across the back, shoulders and chest, it
cleanses thoroughly without the stripped feeling that harsher washes can leave behind.</p>
<p>Benefits: deeply cleansing; helps skin look clearer and more even; suitable for daily use
on body skin.</p>
<p>How to use: massage over damp skin in the shower, working into a lather, then rinse
thoroughly. Follow with a body moisturiser while skin is still damp.</p>
<p>Ingredients: Water (Aqua), Sodium Palm Kernelate, Sodium Palmate, Glycerin, Butyrospermum
Parkii (Shea) Butter, Cocos Nucifera (Coconut) Oil, Musa Sapientum (Plantain) Peel Ash,
Citric Acid, Tocopherol, Parfum.</p>`;

function product(overrides: Partial<ShopifyProduct> = {}): ShopifyProduct {
  return {
    id: 11,
    title: "SGROW G15 Light Therapy Silicone Mask",
    body_html: DEVICE,
    vendor: "Cicabelle",
    product_type: "beauty device",
    handle: "sgrow-g15-light-therapy-silicone-mask",
    tags: "",
    status: "active",
    images: [{ src: "https://cdn.example/a.jpg" }],
    variants: [{ id: 1, price: "575.00", sku: "SGROW-G15", inventory_quantity: 2 }],
    ...overrides,
  };
}

describe("long marketing copy with no ingredient list", () => {
  it("extracts nothing from it", () => {
    // The failure this guards against is a shopper being shown "cleanse and
    // dry the face, fit the mask, and choose a mode" as an ingredient list.
    expect(ingredientsFromDescription(DEVICE)).toEqual([]);
  });

  it("is not fooled by the word Benefits or a How to use heading", () => {
    expect(mapShopifyProduct(product(), "t", "shop.myshopify.com")?.ingredientsJson).toEqual([]);
  });

  it("refuses a heading whose list is the parts of a device", () => {
    // The test above passes for a weak reason — that copy has no heading at
    // all, so it never reaches the gates. This one does reach them: a real
    // heading, a real comma-separated list, and nothing in it that has ever
    // been in a bottle.
    const withHeading = DEVICE.replace(
      "<p>Good to know:",
      "<p>Ingredients: medical-grade silicone, LED array, lithium battery, magnetic strap, USB-C cable, eye shield.</p><p>Good to know:",
    );
    expect(ingredientsFromDescription(withHeading)).toEqual([]);
  });

  it("refuses a heading followed by claims rather than a formula", () => {
    const claims = DEVICE.replace(
      "<p>Good to know:",
      "<p>Ingredients: cruelty free, vegan, dermatologist tested, hypoallergenic, non-comedogenic, unscented.</p><p>Good to know:",
    );
    expect(ingredientsFromDescription(claims)).toEqual([]);
  });

  it("still reads the claims for concerns, which is what copy is for", () => {
    // The description is matched for concerns whether or not it yields an
    // ingredient list — that has always been true and must stay true.
    const mapped = mapShopifyProduct(product(), "t", "shop.myshopify.com");
    expect(mapped?.concernsJson.length).toBeGreaterThan(0);
  });
});

describe("long marketing copy that ends in an ingredient list", () => {
  const wash = () =>
    mapShopifyProduct(
      product({
        title: "Nubian Heritage African Black Soap Body Wash",
        body_html: BODY_WASH,
        product_type: "body care",
        handle: "nubian-heritage-african-black-soap-body-wash-13-fl-oz-384-ml",
      }),
      "t",
      "shop.myshopify.com",
    );

  it("takes the list and none of the prose above it", () => {
    const found = wash()?.ingredientsJson ?? [];
    expect(found[0]).toMatch(/water|aqua/i);
    expect(found.join(" ")).toContain("Glycerin");
    for (const claim of ["massage", "lather", "Benefits", "deeply cleansing", "How to use"]) {
      expect(found.join(" | "), `"${claim}" is copy, not an ingredient`).not.toContain(claim);
    }
  });

  it("stops at the end rather than running into the next section", () => {
    const found = wash()?.ingredientsJson ?? [];
    expect(found.length).toBeGreaterThanOrEqual(5);
    expect(found.length).toBeLessThanOrEqual(20);
  });
});

describe("a concern tag outranks anything read from the copy", () => {
  it("uses the tag the merchant set", () => {
    // Both products now carry concern tags, so the tag is the answer and the
    // regexes only add to it.
    const mapped = mapShopifyProduct(
      product({ tags: "concern:acne, concern:ageing" }),
      "t",
      "shop.myshopify.com",
    );
    expect(mapped?.concernsJson).toContain("acne");
    expect(mapped?.concernsJson).toContain("fine lines");
  });
});
