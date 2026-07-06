import type { Metadata } from "next";
import { QuietLuxeFaq } from "@/components/quiet-luxe-faq";

export const metadata: Metadata = {
  title: "FAQ — the AI skincare advisor | AI Derma Guru",
  description:
    "Answers for shoppers and merchants about OTC skincare guidance, sponsored results, photo consent, safety escalation, and billing.",
};

export default function FaqPage() {
  return <QuietLuxeFaq />;
}
