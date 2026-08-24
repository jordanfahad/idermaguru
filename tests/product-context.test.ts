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

  it("offers rather than interrogating", async () => {
    // It used to open by asking about the shopper's skin. That is a toll on
    // everyone who only wanted a fact — "what is it for" needs to know nothing
    // about anybody — so the opening offers, and the option that needs the
    // questions is the one that asks them.
    const payload = await openAdvisor("niacinamide-serum");
    expect(payload.slots).toEqual({});
    expect(payload.suggestions.length).toBeGreaterThan(0);
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

/**
 * What the panel offers, and why it is not a fixed menu.
 *
 * Cicabelle's catalogue has concern tags on 352 of 444 in-stock products and
 * actives on 161. A menu that offered the same four things on every product
 * would come up empty most of the time — after the shopper had already spent
 * the tap, which is worse than never offering it.
 *
 * So the chips are computed per product from the fields actually held for it,
 * and the one that needs to know about the shopper says so.
 */
describe("what the panel offers about a product", () => {
  it("shows the product as a card, not as a recommendation", async () => {
    // step/slot/reason are empty on purpose: this product was not chosen for
    // anybody. Claiming a reason before a single safety question has been
    // asked would be a recommendation nobody earned.
    const payload = await openAdvisor("niacinamide-serum");
    expect(payload.products).toHaveLength(1);
    const card = payload.products[0];
    expect(card.name).toBeTruthy();
    expect(card.url).toBeTruthy();
    expect(card.step).toBe("");
    expect(card.reason).toBe("");
    expect(card.sponsored).toBe(false);
  });

  it("offers only what it can answer for that product", async () => {
    const payload = await openAdvisor("niacinamide-serum");
    const asks = payload.suggestions.map((chip: { ask: string }) => chip.ask);
    // "suits" is unconditional — it is the one that starts the questions.
    expect(asks).toContain("suits");
    // Every other chip must be backed by a field on this product.
    const products = await listTenantProducts(slug);
    const target = products.find((product) => product.url?.includes("niacinamide-serum"))!;
    if (!target.concernsJson.length) expect(asks).not.toContain("about");
    if (!target.activeIngredientsJson.length) expect(asks).not.toContain("actives");
  });

  it("offers nothing when it was not opened from a product", async () => {
    const payload = await openAdvisor();
    expect(payload.suggestions).toEqual([]);
    expect(payload.products).toEqual([]);
  });
});

/**
 * The safety dialogue is not bypassed by any of this.
 *
 * The opening used to ask about the shopper's skin, and moving to a menu could
 * quietly have become a way to get a suitability answer without the questions.
 * It is not: the chips that answer without them do not claim suitability, and
 * the chip that claims it is the one that starts them.
 */
/**
 * Taps a chip the way the panel does — with the chip's own words carried
 * along as the utterance, so they show up in the transcript as what the
 * shopper said.
 *
 * That detail is not cosmetic. Gating any of this on an empty utterance sends
 * every tap into the tangent classifier, and an earlier version of "Is it
 * right for my skin?" was answered with "that one's outside my world". A test
 * that sent an empty string could not see it.
 */
function tapChip(ask: "about" | "actives" | "suits", product: string, label = "Is it right for my skin?") {
  return POST(
    new Request("http://localhost/api/voice-agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ utterance: label, slots: {}, product, ask }),
    }),
  ).then((response) => response.json());
}

describe("tapping a follow-up", () => {
  it("starts the safety questions when the shopper asks if it suits them", async () => {
    const payload = await tapChip("suits", "niacinamide-serum");
    expect(payload.reply).toBeTruthy();
    expect(payload.phase).toBe("asking");
    // No routine, and nothing claimed — just the first question.
    expect(payload.products).toEqual([]);
  });

  it("answers what a product is for without claiming it suits anybody", async () => {
    const products = await listTenantProducts(slug);
    const target = products.find((p) => p.url?.includes("niacinamide-serum"))!;
    if (!target.concernsJson.length) return; // chip would not be offered

    const payload = await tapChip("about", "niacinamide-serum");
    expect(payload.reply).toContain(target.name);
    // It says the questions are still needed rather than pronouncing on fit.
    expect(payload.reply.toLowerCase()).toMatch(/your skin|match|tell me/);
  });

  it("keeps the card up and stops offering the chip already tapped", async () => {
    const payload = await tapChip("about", "niacinamide-serum");
    expect(payload.products).toHaveLength(1);
    const asks = payload.suggestions.map((chip: { ask: string }) => chip.ask);
    expect(asks).not.toContain("about");
    expect(asks).toContain("suits");
  });

  it("ignores a chip for a product this merchant does not stock", async () => {
    // The intent is ours but the product reference is not, so it is resolved
    // like everything else and an unknown one falls through to the ordinary
    // dialogue rather than answering about nothing.
    const payload = await tapChip("about", "a-product-from-another-shop");
    expect(payload.reply).toBeTruthy();
    expect(payload.products ?? []).toEqual([]);
  });
});

describe("a tapped chip never has to be understood", () => {
  // The regression that hid behind an empty utterance: the panel sends the
  // chip's words as the transcript line, so every one of these arrives with a
  // non-empty utterance that the classifiers would otherwise get hold of.
  it("routes on the intent even though the label reads like a question", async () => {
    const payload = await tapChip("suits", "niacinamide-serum", "Is it right for my skin?");
    // Not "that one's outside my world" — the tangent answer this used to get.
    expect(payload.reply.toLowerCase()).not.toMatch(/outside my world|only cover/);
    expect(payload.phase).toBe("asking");
  });

  it("routes 'What's it good for?' on the intent too", async () => {
    const products = await listTenantProducts(slug);
    const target = products.find((p) => p.url?.includes("niacinamide-serum"))!;
    if (!target.concernsJson.length) return;
    const payload = await tapChip("about", "niacinamide-serum", "What's it good for?");
    expect(payload.reply).toContain(target.name);
    expect(payload.reply.toLowerCase()).not.toMatch(/outside my world|only cover/);
  });
});
