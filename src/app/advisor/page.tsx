import type { Metadata } from "next";
import { headers } from "next/headers";
import { VoiceAgent } from "@/components/voice-agent";
import { tenantSlugForHost } from "@/lib/advisor-hosts";
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
  searchParams: Promise<{ lang?: string; tenant?: string }>;
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
  const tenantSlug = tenantSlugForHost((await headers()).get("host")) ?? asSlug(params.tenant);

  return (
    <main className="advisor-embed" dir={initialLang === "ar" ? "rtl" : "ltr"}>
      <VoiceAgent initialLang={initialLang} variant="full" tenantSlug={tenantSlug} />
    </main>
  );
}
