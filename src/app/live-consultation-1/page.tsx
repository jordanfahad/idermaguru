import type { Metadata } from "next";
import { LiveConsultationSearch } from "@/components/live-consultation-search";
import { getLiveConsultationConfig } from "@/services/live-consultations";

export const metadata: Metadata = {
  title: "Live Consultation 1 | AI Derma Guru",
  description:
    "Start an AI skincare consultation for OTC skincare routines and curated product discovery.",
};

export const dynamic = "force-dynamic";

export default async function LiveConsultationOnePage() {
  const config = await getLiveConsultationConfig("live-consultation-1");
  const curatedProducts = config.products.map((product) => ({
    ...product,
    trust: "Selected from an approved retail catalog after suitability checks.",
  }));
  return <LiveConsultationSearch curatedProducts={curatedProducts} vendorShares={config.vendors} />;
}
