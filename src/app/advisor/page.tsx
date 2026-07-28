import type { Metadata } from "next";
import { VoiceAgent } from "@/components/voice-agent";
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
  searchParams: Promise<{ lang?: string }>;
};

export default async function AdvisorPage({ searchParams }: AdvisorPageProps) {
  const params = await searchParams;
  const initialLang = params.lang === "ar" ? "ar" : "en";

  return (
    <main className="advisor-embed" dir={initialLang === "ar" ? "rtl" : "ltr"}>
      <VoiceAgent initialLang={initialLang} variant="full" />
    </main>
  );
}
