import type { Metadata } from "next";
import { QuietLuxePricing } from "@/components/quiet-luxe-pricing";

export const metadata: Metadata = {
  title: "Pricing — Add the AI skin advisor widget to your store | AI Derma Guru",
  description:
    "Embed the AI skin consultation widget on Shopify and any store. Turn browsers into personalized routines and matched products. Simple monthly plans.",
};

export default function PricingPage() {
  return <QuietLuxePricing />;
}
