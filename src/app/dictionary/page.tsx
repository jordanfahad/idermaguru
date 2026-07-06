import type { Metadata } from "next";
import { QuietLuxeDictionary } from "@/components/quiet-luxe-dictionary";

export const metadata: Metadata = {
  title: "Skin dictionary — non-diagnostic skincare definitions | AI Derma Guru",
  description:
    "Short, non-diagnostic definitions that help shoppers understand routine language before choosing OTC products. English and Arabic.",
};

export default function DictionaryPage() {
  return <QuietLuxeDictionary />;
}
