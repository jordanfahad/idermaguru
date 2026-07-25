import type { Metadata } from "next";
import { ConciergeConsultation } from "@/components/concierge-consultation";
import { getLiveConsultationConfig } from "@/services/live-consultations";

export const metadata: Metadata = {
  title: "Live skin consultation | AI Derma Guru",
  description:
    "Talk to the AI skin advisor by voice or chat and get a safety-checked OTC routine built from the store's own catalogue.",
};

export const dynamic = "force-dynamic";

export default async function LiveConsultationOnePage() {
  const config = await getLiveConsultationConfig("live-consultation-1");
  const curatedProducts = config.products.map((product) => ({
    ...product,
    trust: "Selected from an approved retail catalog after suitability checks.",
  }));
  return <ConciergeConsultation curatedProducts={curatedProducts} vendorShares={config.vendors} />;
}
