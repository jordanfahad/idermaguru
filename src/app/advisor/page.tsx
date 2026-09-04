import type { Metadata } from "next";
import { headers } from "next/headers";
import { VoiceAgent } from "@/components/voice-agent";
import { tenantSlugForRequestHost } from "@/services/merchant-domains";
import "./advisor-embed.css";

/**
 * The advisor on its own, with no site chrome around it.
 *
 * This is the surface a merchant embeds. `/live-consultation-1` is the same
 * advisor inside DermaGuru's own page — header, language switch, curated shelf,
 * fallback form — all of which is ours and none of which belongs inside
 * somebody else's storefront.
 *
 * Framed rather than injected on purpose. The advisor is a React application
 * that asks for a microphone, streams audio and holds a conversation; the
 * script-tag widget speaks to a store's page through a Shadow DOM and would
 * have to reimplement all of it. An iframe carries the real thing, and the
 * host page grants the microphone with allow="microphone" — see docs/EMBED.md.
 */
export const metadata: Metadata = {
  title: "Skin advisor",
  description: "Talk to the AI skin advisor and get a routine built from this store's own catalogue.",
  // A framed surface should never be the thing a search engine indexes; the
  // merchant's own page is what should rank.
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type AdvisorPageProps = {
  searchParams: Promise<{ lang?: string; tenant?: string; product?: string; q?: string }>;
};

/**
 * Slugs are lowercase words joined by dashes. The value reaching this function
 * came out of a storefront's HTML, so it is rejected on shape rather than
 * passed along to be looked up — an unrecognised slug resolves to no catalogue
 * and an advisor with nothing to recommend, which is a worse failure than
 * ignoring the junk and serving the default.
 */
function asSlug(value: string | undefined): string | undefined {
  const slug = value?.trim().toLowerCase();
  return slug && /^[a-z0-9][a-z0-9-]{0,63}$/.test(slug) ? slug : undefined;
}

export default async function AdvisorPage({ searchParams }: AdvisorPageProps) {
  const params = await searchParams;
  const initialLang = params.lang === "ar" ? "ar" : "en";

  // Whose catalogue this advisor recommends from. A merchant who has pointed a
  // subdomain at us is answered by the hostname, which nobody looking at the
  // page can edit; the shared bubble on idermaguru.com has no such hostname, so
  // it says who it is in the frame's URL. Host first, so pointing the DNS also
  // takes the decision away from the storefront's HTML.
  const tenantSlug = (await tenantSlugForRequestHost((await headers()).get("host"))) ?? asSlug(params.tenant);

  // What the shopper is looking at, when the advisor was opened from a product
  // page. Carried through untouched rather than resolved here: the turn route
  // looks it up against the tenant's catalogue, and doing it in one place
  // means the page cannot disagree with the conversation about which product
  // is being discussed. Trimmed and capped only so a runaway value cannot ride
  // along in every request of the session.
  const focusProduct = params.product?.trim().slice(0, 200) || undefined;

  // A question the storefront asked on the shopper's behalf — Cicabelle's
  // product page has buttons ("Ask DermaGuru if this suits your skin") that
  // open this panel with the question already chosen.
  //
  // Capped and stripped of line breaks, then treated as though the shopper had
  // typed it. It is not trusted beyond that: it goes in as an utterance, and an
  // utterance is the one thing this system has never taken instruction from —
  // the safety triage and the deterministic dialogue decide what happens next,
  // and the LLM only ever phrases what they decided.
  const initialQuestion = params.q?.replace(/\s+/g, " ").trim().slice(0, 300) || undefined;

  return (
    <main className="advisor-embed" dir={initialLang === "ar" ? "rtl" : "ltr"}>
      <VoiceAgent
        initialLang={initialLang}
        variant="full"
        tenantSlug={tenantSlug}
        focusProduct={focusProduct}
        initialQuestion={initialQuestion}
      />
    </main>
  );
}
