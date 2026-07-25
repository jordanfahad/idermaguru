"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ShieldCheck, Sparkles, Star } from "lucide-react";
import type { LiveConsultationProduct, LiveConsultationVendor } from "@/data/live-consultations";
import { LiveConsultationSearch } from "./live-consultation-search";
import { VoiceAgent } from "./voice-agent";
import "./concierge-consultation.css";

/**
 * The shopper-facing consultation: the voice/chat concierge is the product, and
 * the original form-driven widget stays available underneath for anyone who
 * prefers filling in fields (or whose browser blocks the microphone).
 */
export function ConciergeConsultation({
  curatedProducts,
  vendorShares,
}: {
  curatedProducts: LiveConsultationProduct[];
  vendorShares: LiveConsultationVendor[];
}) {
  const [showForm, setShowForm] = useState(false);
  const [lang, setLang] = useState<"en" | "ar">("en");
  const isAr = lang === "ar";
  const tr = (en: string, ar: string) => (isAr ? ar : en);

  return (
    <div className={`cc${isAr ? " cc-rtl" : ""}`} dir={isAr ? "rtl" : "ltr"}>
      <header className="cc-bar">
        <Link className="cc-brand" href="/">
          <span className="cc-brand-mark">D</span>
          <span>
            DermaGuru
            <small>{tr("AI skin advisor", "مستشار البشرة الذكي")}</small>
          </span>
        </Link>
        <div className="cc-bar-right">
          <button type="button" className="cc-lang" onClick={() => setLang(isAr ? "en" : "ar")}>
            {isAr ? "EN" : "عربي"}
          </button>
          <Link className="cc-bar-cta" href="/pricing">
            {tr("Add to your store", "أضِفه إلى متجرك")}
          </Link>
        </div>
      </header>

      <main className="cc-stage">
        <span className="cc-glow cc-glow-1" aria-hidden="true" />
        <span className="cc-glow cc-glow-2" aria-hidden="true" />

        {/* floating trust cards, desktop only */}
        <aside className="cc-float cc-float-tl" aria-hidden="true">
          <Star size={13} /> {tr("4.9 shopper rating", "تقييم ٤٫٩")}
        </aside>
        <aside className="cc-float cc-float-bl" aria-hidden="true">
          <Sparkles size={13} /> {tr("828 products matched live", "٨٢٨ منتجاً مطابقاً")}
        </aside>
        <aside className="cc-float cc-float-tr" aria-hidden="true">
          <ShieldCheck size={13} /> {tr("Safety-checked, never a diagnosis", "مفحوص للسلامة — ليس تشخيصاً")}
        </aside>
        <aside className="cc-float cc-float-br" aria-hidden="true">
          🇦🇪 {tr("Arabic & English", "بالعربية والإنجليزية")}
        </aside>

        <p className="cc-kicker">
          <span className="cc-dot" />
          {tr("Live skin consultation", "استشارة بشرة مباشرة")}
        </p>
        <h1 className="cc-title">{tr("What's bothering your skin?", "ما الذي يزعج بشرتك؟")}</h1>
        <p className="cc-lead">
          {tr(
            "Speak or type. The advisor asks the safety questions a good pharmacist would, then builds a routine from products this store actually stocks.",
            "تحدّث أو اكتب. يسأل المستشار أسئلة السلامة التي يسألها الصيدلي الجيد، ثم يبني روتيناً من منتجات متوفرة فعلاً في المتجر.",
          )}
        </p>

        <VoiceAgent key={lang} initialLang={lang} />

        <p className="cc-disclaimer">
          {tr(
            "Cosmetic, over-the-counter guidance only — not a diagnosis or a substitute for medical care.",
            "إرشاد تجميلي بدون وصفة فقط — ليس تشخيصاً ولا بديلاً عن الرعاية الطبية.",
          )}
        </p>
      </main>

      <section className="cc-alt">
        <button type="button" className="cc-alt-toggle" onClick={() => setShowForm((open) => !open)}>
          <ChevronDown size={16} className={showForm ? "cc-rot" : ""} />
          {showForm
            ? tr("Hide the detailed form", "إخفاء النموذج التفصيلي")
            : tr("Prefer a detailed form? Open the full intake", "تفضّل نموذجاً تفصيلياً؟ افتح الاستبيان الكامل")}
        </button>
      </section>

      {showForm ? (
        <div className="cc-form-host">
          <LiveConsultationSearch curatedProducts={curatedProducts} vendorShares={vendorShares} />
        </div>
      ) : null}
    </div>
  );
}
