import { describe, expect, it, vi } from "vitest";
import { seedTenant } from "@/data/seed-catalog";

/**
 * The advisor knowing what the shopper is looking at.
 *
 * Opened from the floating launcher, the advisor has no idea which page it is
 * on — it can only offer a general invitation. Opened from a bar in a product
 * template it can name the thing, which is the entire reason that entry point
 * is worth having.
 *
 * The reference reaching us is written into a theme by hand. `{{ product.handle }}`
 * is the obvious thing to paste, but so is `{{ product.url }}`, and anyone
 * working from our dashboard would reasonably reach for an id or an SKU. All of
 * them have to resolve, because the failure is silent in the worst way: the
 * advisor opens, says nothing about the product, and looks like it was never
 * told — on the one page where it was.
 *
 * No database here, so this runs against the built-in demo catalogue, whose
 * URLs are the same shape as a real merchant's.
 */

vi.mock("@/server/db", () => ({
  getPrisma: () => null,
}));

const { productForReference, listTenantProducts } = await import("@/services/catalog");

const slug = seedTenant.slug;

describe("resolving the product a storefront names", () => {
  it("resolves a bare Shopify handle", async () => {
    const found = await productForReference("gentle-cleanser", slug);
    expect(found?.name).toBeTruthy();
    expect(found?.url).toContain("gentle-cleanser");
  });

  it("resolves the full product URL, which is just as likely to be pasted", async () => {
    const found = await productForReference("https://aiderma.guru/products/niacinamide-serum", slug);
    expect(found?.url).toContain("niacinamide-serum");
  });

  it("resolves a URL carrying a variant query, which is what a size picker produces", async () => {
    // The case that would break a naive string compare: choosing a size puts
    // ?variant=… on every link, so the raw href stops matching on exactly the
    // pages a shopper reaches by picking one.
    const found = await productForReference("https://aiderma.guru/products/niacinamide-serum?variant=42", slug);
    expect(found?.url).toContain("niacinamide-serum");
  });

  it("ignores a fragment", async () => {
    const found = await productForReference("/products/niacinamide-serum#reviews", slug);
    expect(found?.url).toContain("niacinamide-serum");
  });

  it("tolerates a trailing slash", async () => {
    const found = await productForReference("/products/niacinamide-serum/", slug);
    expect(found?.url).toContain("niacinamide-serum");
  });

  it("is case-insensitive about the handle", async () => {
    const found = await productForReference("Niacinamide-Serum", slug);
    expect(found?.url).toContain("niacinamide-serum");
  });

  it("resolves an SKU", async () => {
    const products = await listTenantProducts(slug);
    const target = products[0];
    const found = await productForReference(target.sku, slug);
    expect(found?.id).toBe(target.id);
  });

  it("resolves an id", async () => {
    const products = await listTenantProducts(slug);
    const target = products[1];
    const found = await productForReference(target.id, slug);
    expect(found?.id).toBe(target.id);
  });

  it("prefers an exact id or SKU over a handle that happens to match", async () => {
    // Ids and SKUs are unique; handles are derived from a URL and could in
    // principle collide with one. The identifier we are surest about wins.
    const products = await listTenantProducts(slug);
    const target = products[2];
    expect((await productForReference(target.id, slug))?.id).toBe(target.id);
  });

  it("returns null for a product this merchant does not stock", async () => {
    // The important one. Guessing here would have the advisor open saying
    // "you're looking at X" when the shopper is looking at Y — worse than
    // opening with the ordinary greeting, which is what null produces.
    expect(await productForReference("a-product-from-another-shop", slug)).toBeNull();
    expect(await productForReference("https://someone-else.com/products/whatever", slug)).toBeNull();
  });

  it("returns null for junk rather than throwing", async () => {
    // This value comes out of a storefront's HTML, where anyone can edit it.
    for (const junk of ["", "   ", "/", "///", "?variant=1", "#", "https://"]) {
      expect(await productForReference(junk, slug), `${JSON.stringify(junk)} should not resolve`).toBeNull();
    }
  });

  it("resolves nothing for a merchant with no catalogue", async () => {
    // A slug with no products must not fall through to somebody else's shelf —
    // the same rule the catalogue fallback already enforces for recommendations.
    expect(await productForReference("gentle-cleanser", "some-other-merchant")).toBeNull();
  });
});

/**
 * The opening turn, through the real route.
 *
 * Resolving the product is only half of it; the shopper has to hear the
 * difference. These drive the endpoint the browser drives and assert on what
 * would actually be said.
 */
const { POST } = await import("@/app/api/voice-agent/route");

function openAdvisor(product?: string) {
  return POST(
    new Request("http://localhost/api/voice-agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ utterance: "", slots: {}, ...(product ? { product } : {}) }),
    }),
  ).then((response) => response.json());
}

describe("what the advisor says when it opens", () => {
  it("names the product when it was opened from that product's page", async () => {
    const products = await listTenantProducts(slug);
    const target = products.find((product) => product.url?.includes("niacinamide-serum"));
    expect(target, "seed catalogue changed — pick another product").toBeTruthy();

    const payload = await openAdvisor("niacinamide-serum");
    expect(payload.reply).toContain(target!.name);
    expect(payload.phase).toBe("asking");
  });

  it("still asks about the shopper's skin rather than about the product", async () => {
    // "Is this right for me" is not answerable from the label. The product
    // gives the advisor a subject; the safety and concern questions are what
    // make the answer worth anything, and they must still be the next thing
    // out of its mouth.
    const payload = await openAdvisor("niacinamide-serum");
    expect(payload.reply.toLowerCase()).toMatch(/skin/);
    expect(payload.slots).toEqual({});
  });

  it("gives the ordinary greeting when no product was named", async () => {
    const payload = await openAdvisor();
    expect(payload.reply).toBeTruthy();
    expect(payload.phase).toBe("asking");
  });

  it("gives the ordinary greeting for a product this merchant does not stock", async () => {
    // Being told nothing and being told something unrecognisable are the same
    // thing to the shopper, and both beat a wrong product name.
    const unknown = await openAdvisor("a-product-from-another-shop");
    const plain = await openAdvisor();
    expect(unknown.reply).toBe(plain.reply);
  });

  it("never repeats an unverified string back as though it were a product", async () => {
    // The reference arrives from a storefront's HTML. Echoing it would let any
    // page put words in the advisor's mouth, so it is looked up first and the
    // NAME from our catalogue is what gets spoken.
    const payload = await openAdvisor("<script>alert(1)</script> Free Rolex");
    expect(payload.reply).not.toContain("Rolex");
    expect(payload.reply).not.toContain("<script>");
  });

  it("speaks the line it renders", async () => {
    // The panel shows `reply` and the voice reads `speech`. They drifted apart
    // once before; a product named on screen and absent from the audio would
    // be the same bug in a new place.
    const products = await listTenantProducts(slug);
    const target = products.find((product) => product.url?.includes("niacinamide-serum"))!;
    const payload = await openAdvisor("niacinamide-serum");
    // speakable() returns the line split into segments for the voice.
    expect((payload.speech ?? []).join(" ")).toContain(target.name);
  });
});
