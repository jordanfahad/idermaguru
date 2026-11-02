import type { Metadata } from "next";
import { ConciergeConsultation } from "@/components/concierge-consultation";
import { headers } from "next/headers";
import { getLiveConsultationConfig } from "@/services/live-consultations";
import { resolveMarket } from "@/lib/cicabelle-market";

export const metadata: Metadata = {
  title: "Live skin consultation | AI Derma Guru",
  description:
    "Talk to the AI skin advisor by voice or chat and get a safety-checked OTC routine built from the store's own catalogue.",
};

export const dynamic = "force-dynamic";

export default async function LiveConsultationOnePage({
  searchParams,
}: {
  searchParams: Promise<{ src?: string; lang?: string; country?: string }>;
}) {
  const params = await searchParams;
  // The app's chosen country when it sends one, else where the visitor is (Vercel's
  // edge geolocation): a shopper in Saudi Arabia or Kuwait sees that store, not the UAE's.
  const market = resolveMarket(params.country, (await headers()).get("x-vercel-ip-country"));
  const config = await getLiveConsultationConfig("live-consultation-1");
  const curatedProducts = config.products.map((product) => ({
    ...product,
    trust: "Selected from an approved retail catalog after suitability checks.",
  }));
  // Known on the server so the app's first paint already has the right header and language.
  return (
    <ConciergeConsultation
      curatedProducts={curatedProducts}
      vendorShares={config.vendors}
      inApp={params.src === "cicabelle-app"}
      initialLang={params.lang === "ar" ? "ar" : "en"}
      market={market}
    />
  );
}
