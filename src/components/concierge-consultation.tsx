"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, ShieldCheck, Sparkles, Star } from "lucide-react";
import type { LiveConsultationProduct, LiveConsultationVendor } from "@/data/live-consultations";
import { LiveConsultationSearch } from "./live-consultation-search";
import { VoiceAgent } from "./voice-agent";
import type { CicabelleMarket } from "@/lib/cicabelle-market";
import "./concierge-consultation.css";

const AI_CONSENT_KEY = "dg_ai_consent_v1";

/**
 * The shopper-facing consultation: the voice/chat concierge is the product, and
 * the original form-driven widget stays available underneath for anyone who
 * prefers filling in fields (or whose browser blocks the microphone).
 */
export function ConciergeConsultation({
  curatedProducts,
  vendorShares,
  inApp = false,
  initialLang = "en",
  market = "AE",
}: {
  curatedProducts: LiveConsultationProduct[];
  vendorShares: LiveConsultationVendor[];
  inApp?: boolean;
  initialLang?: "en" | "ar";
  /** Cicabelle's Saudi/Kuwait store: local prices and links, nothing that cannot ship there. */
  market?: CicabelleMarket;
}) {
  const [showForm, setShowForm] = useState(false);
  /*
   * Whether this page is sitting inside somebody else's.
   *
   * It is ours, and on idermaguru.com the header below is exactly right: our
   * name, linked to our homepage, next to "Add to your store". A merchant
   * framed it in their storefront, so a Cicabelle shopper opening the advisor
   * was shown a link out to our site and an advert selling our product to
   * them, on the shop they came to buy from.
   *
   * Decided after mount, never during render: the server has no window, and
   * branching on it in the markup would hand React two different trees.
   * Reading window.top across origins can throw, and a throw IS the framed
   * answer.
   */
  /*
   * The Cicabelle iOS app shows this page in a WebView (src=cicabelle-app), which
   * is the same situation as a merchant's frame: their shoppers, their app. It
   * also matters for App Review, where a link to buy our subscription from
   * inside someone's iPhone app reads as an outside purchase (guideline 3.1.1).
   */
  const [framed, setFramed] = useState(inApp);
  useEffect(() => {
    try {
      setFramed(window.self !== window.top);
    } catch {
      setFramed(true);
    }
  }, []);
  const [lang, setLang] = useState<"en" | "ar">(initialLang);
  // Runs after the frame check above, so the app flag always wins.
  useEffect(() => {
    if (inApp) setFramed(true);
  }, [inApp]);
  const isAr = lang === "ar";
  const tr = (en: string, ar: string) => (isAr ? ar : en);
  /*
   * Nothing reaches the AI until the shopper says yes.
   *
   * App Store guideline 5.1.2(i) requires telling people, before it happens,
   * that their personal data goes to a third-party AI, and getting explicit
   * permission. The voice agent and the detailed form are not rendered at all
   * until then, so no microphone prompt and no upload can come first. Read
   * after mount (no window on the server); storage can throw in private
   * browsing or a locked-down WebView, which just means asking again.
   */
  const [aiConsent, setAiConsent] = useState(false);
  useEffect(() => {
    try {
      setAiConsent(window.localStorage.getItem(AI_CONSENT_KEY) === "yes");
    } catch {
      /* ask again */
    }
  }, []);
  const giveConsent = () => {
    setAiConsent(true);
    try {
      window.localStorage.setItem(AI_CONSENT_KEY, "yes");
    } catch {
      /* consent still holds for this visit */
    }
  };

  return (
    <div className={`cc${isAr ? " cc-rtl" : ""}`} dir={isAr ? "rtl" : "ltr"}>
      <header className="cc-bar">
        {/* The identity stays wherever this runs; the link out does not.
            Framed, tapping it would navigate the merchant's panel to our
            homepage and strand the shopper there. */}
        {framed ? (
          <span className="cc-brand">
            <span className="cc-brand-mark">D</span>
            <span>
              DermaGuru
              <small>{tr("AI skin advisor", "مستشار البشرة الذكي")}</small>
            </span>
          </span>
        ) : (
          <Link className="cc-brand" href="/">
            <span className="cc-brand-mark">D</span>
            <span>
              DermaGuru
              <small>{tr("AI skin advisor", "مستشار البشرة الذكي")}</small>
            </span>
          </Link>
        )}
        <div className="cc-bar-right">
          <button type="button" className="cc-lang" onClick={() => setLang(isAr ? "en" : "ar")}>
            {isAr ? "EN" : "عربي"}
          </button>
          {/* Selling our product to a merchant's own customers, on the shop
              they came to buy from. Ours to show on our site, nowhere else. */}
          {framed ? null : (
            <Link className="cc-bar-cta" href="/pricing">
              {tr("Add to your store", "أضِفه إلى متجرك")}
            </Link>
          )}
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

        {aiConsent ? (
          <VoiceAgent key={lang} initialLang={lang} market={market} />
        ) : (
          <section className="cc-consent" aria-labelledby="cc-consent-title">
            <h2 id="cc-consent-title">{tr("Before we start", "قبل أن نبدأ")}</h2>
            <p>
              {tr(
                "To give you skincare guidance, what you type, what you say and any skin photo you choose to add are sent to our AI provider, OpenAI, for processing. They are not used to train AI models. Please don't share anything you'd rather keep private.",
                "لنقدّم لك إرشاد العناية بالبشرة، يُرسَل ما تكتبه وما تقوله وأي صورة لبشرتك تختار إضافتها إلى مزوّد الذكاء الاصطناعي لدينا، OpenAI، لمعالجتها. لا تُستخدم لتدريب نماذج الذكاء الاصطناعي. يُرجى عدم مشاركة أي معلومات تفضّل إبقاءها خاصة.",
              )}
            </p>
            <button type="button" className="cc-consent-yes" onClick={giveConsent}>
              {tr("I agree, start my consultation", "أوافق وأبدأ الاستشارة")}
            </button>
            <a className="cc-consent-more" href="/privacy-policy">
              {tr("How we handle your data", "كيف نتعامل مع بياناتك")}
            </a>
          </section>
        )}

        <p className="cc-disclaimer">
          {tr(
            "Cosmetic, over-the-counter guidance only — not a diagnosis or a substitute for medical care.",
            "إرشاد تجميلي بدون وصفة فقط — ليس تشخيصاً ولا بديلاً عن الرعاية الطبية.",
          )}
        </p>
      </main>

      {aiConsent && market === "AE" ? (
        <section className="cc-alt">
          <button type="button" className="cc-alt-toggle" onClick={() => setShowForm((open) => !open)}>
            <ChevronDown size={16} className={showForm ? "cc-rot" : ""} />
            {showForm
              ? tr("Hide the detailed form", "إخفاء النموذج التفصيلي")
              : tr("Prefer a detailed form? Open the full intake", "تفضّل نموذجاً تفصيلياً؟ افتح الاستبيان الكامل")}
          </button>
        </section>
      ) : null}

      {aiConsent && market === "AE" && showForm ? (
        <div className="cc-form-host">
          <LiveConsultationSearch curatedProducts={curatedProducts} vendorShares={vendorShares} />
        </div>
      ) : null}
    </div>
  );
}
