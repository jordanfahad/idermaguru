"use client";

import { Camera, ExternalLink, Loader2, Mic, Search, Send, ShieldCheck, ShoppingBag, ShoppingCart, Sparkles } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { IMAGE_CONSENT_TEXT, type RoutineRecommendation } from "@/domain/skincare";
import type { LiveConsultationProduct, LiveConsultationVendor } from "@/data/live-consultations";
import { expandSearchText } from "@/data/search-keywords";

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  abort: () => void;
  start: () => void;
  stop: () => void;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onstart: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: SpeechRecognitionResultList;
};

type Language = "en" | "ar";

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

const defaultSearches = [
  "dark spots and dull skin routine",
  "oily skin with blackheads",
  "dry sensitive barrier repair",
  "simple glow routine under AED 200",
  "acne-safe sunscreen and moisturizer",
];

const copy = {
  en: {
    livePill: "Live consultation 1",
    title: "Consult our in-house AI dermatologist for best skin care routine and skin care products.",
    placeholder: "Tell us your skin goal, concern, budget, or product vibe...",
    start: "Start consultation",
    note: "OTC cosmetic guidance only. This does not diagnose, prescribe, or replace medical care.",
    recentSearches: "Recent searches",
    formTitle: "AI Cosmetologist",
    mainConcern: "Main concern",
    ageRange: "Age range",
    country: "Country",
    skinType: "Skin type",
    sensitivity: "Sensitivity",
    allergies: "Allergies",
    currentActives: "Current actives or prescriptions",
    pregnant: "Pregnant or breastfeeding",
    prescription: "Using prescription treatment",
    photoConsent: "Optional photo consent",
    optionalPhoto: "Optional photo",
    getRoutine: "Get OTC routine",
    resultTitle: "See the recommended products for your concerns",
    resultIntro: "Start with this routine. Each step is selected for your concern, routine fit, and conservative OTC safety rules.",
    addRoutine: "Add full routine to cart",
    productHeading: "Best recommended products for your skin concern",
    productIntro: "Use these as the shopping layer for the routine above. Product images come from the product catalog where available.",
    lookupOnly: "Reference only. This item is not in the target catalog yet, so use the product title for a Google search or add it to the merchant catalog later.",
    productType: "Product type",
    whyProduct: "Why this product",
    howHelp: "How it can help",
    timeline: "When to expect visible change",
    shop: "Shop recommended product",
    addCart: "Add to cart",
    pausedTitle: "Product recommendations are paused",
    recentConsultation: "Recent consultation",
    reviewCopy: "Review your suggested routine below, then open each recommended product page for price, images, ingredients, and availability.",
    footerTitle: "See what other shoppers asked AI Derma Guru",
    footerCopy: "Public consultation snapshots are saved as clickable pages. We show 10 at a time and keep a maximum of 100 recent searches on each consultation page.",
    moreRecent: "More recent searches",
    skinRoutine: "skin routine",
    language: "Language",
  },
  ar: {
    livePill: "استشارة مباشرة 1",
    title: "استشر AI Derma Guru للحصول على أفضل روتين ومنتجات عناية بالبشرة.",
    placeholder: "اكتب هدفك للبشرة، المشكلة، الميزانية، أو نوع المنتج...",
    start: "ابدأ الاستشارة",
    note: "إرشادات تجميلية ومنتجات بدون وصفة فقط. لا يشخص أو يصف علاجاً ولا يستبدل الطبيب.",
    recentSearches: "عمليات بحث حديثة",
    formTitle: "خبير تجميل ذكي",
    mainConcern: "المشكلة الرئيسية",
    ageRange: "الفئة العمرية",
    country: "الدولة",
    skinType: "نوع البشرة",
    sensitivity: "درجة الحساسية",
    allergies: "الحساسية",
    currentActives: "المكونات النشطة أو العلاجات الحالية",
    pregnant: "حامل أو مرضعة",
    prescription: "أستخدم علاجاً بوصفة طبية",
    photoConsent: "الموافقة على صورة اختيارية",
    optionalPhoto: "صورة اختيارية",
    getRoutine: "احصل على روتين OTC",
    resultTitle: "المنتجات المقترحة حسب مشكلتك",
    resultIntro: "ابدأ بهذا الروتين. كل خطوة مختارة حسب المشكلة، ملاءمة الروتين، وقواعد السلامة لمنتجات بدون وصفة.",
    addRoutine: "أضف الروتين كاملاً إلى السلة",
    productHeading: "أفضل المنتجات المقترحة لبشرتك",
    productIntro: "استخدم هذه المنتجات كطبقة تسوق للروتين أعلاه. الصور من كتالوج المنتجات عند توفرها.",
    lookupOnly: "مرجع فقط. هذا المنتج غير موجود حالياً في كتالوج المتجر المستهدف، لذلك يمكن البحث عنه بالاسم في Google أو إضافته لاحقاً للكتالوج.",
    productType: "نوع المنتج",
    whyProduct: "لماذا هذا المنتج",
    howHelp: "كيف يساعد",
    timeline: "متى تظهر نتائج ملحوظة",
    shop: "تسوق المنتج المقترح",
    addCart: "أضف إلى السلة",
    pausedTitle: "تم إيقاف توصيات المنتجات مؤقتاً",
    recentConsultation: "استشارة حديثة",
    reviewCopy: "راجع الروتين المقترح ثم افتح صفحة كل منتج لمعرفة السعر والصور والمكونات والتوفر.",
    footerTitle: "شاهد ما بحث عنه الآخرون في AI Derma Guru",
    footerCopy: "يتم حفظ ملخصات الاستشارات العامة كصفحات قابلة للنقر. نعرض 10 في كل مرة وبحد أقصى 100 بحث حديث لكل صفحة استشارة.",
    moreRecent: "المزيد من عمليات البحث",
    skinRoutine: "روتين البشرة",
    language: "اللغة",
  },
} as const;

const marketing = {
  en: {
    heroEyebrow: "AI Dermatologist · Live",
    heroTitleA: "Meet your AI",
    heroTitleB: "dermatologist.",
    heroLead:
      "Tell us one skin concern and get a personalized routine with products matched to your skin — in seconds.",
    examplePrefix: "Try:",
    chipsLabel: "Popular right now",
    valueProps: ["Personalized routine", "Products matched to you", "Safe, OTC-only guidance"],
    footerLegal: "© AI Derma Guru. Cosmetic guidance only — not a medical diagnosis.",
    footerLinks: "Privacy · Terms · Cosmetic guidance only",
  },
  ar: {
    heroEyebrow: "طبيب الجلدية الذكي · مباشر",
    heroTitleA: "تعرّف على طبيب",
    heroTitleB: "الجلدية الذكي.",
    heroLead:
      "أخبرنا بمشكلة بشرتك واحصل على روتين مخصص مع منتجات مناسبة لبشرتك — خلال ثوانٍ.",
    examplePrefix: "مثال:",
    chipsLabel: "الأكثر رواجاً الآن",
    valueProps: ["روتين مخصص", "منتجات مناسبة لك", "إرشاد آمن بدون وصفة"],
    footerLegal: "© AI Derma Guru. إرشاد تجميلي فقط — ليس تشخيصاً طبياً.",
    footerLinks: "الخصوصية · الشروط · إرشاد تجميلي فقط",
  },
} as const;

export function LiveConsultationSearch({
  curatedProducts,
  vendorShares = [],
}: {
  curatedProducts: LiveConsultationProduct[];
  vendorShares?: LiveConsultationVendor[];
}) {
  const intakeRef = useRef<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const [query, setQuery] = useState("");
  const [recentSearches, setRecentSearches] = useState(defaultSearches);
  const [recentConsultations, setRecentConsultations] = useState<RecentConsultation[]>([]);
  const [recentPage, setRecentPage] = useState(1);
  const [recentHasMore, setRecentHasMore] = useState(false);
  const [lastSuccessfulSearch, setLastSuccessfulSearch] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState<string | null>(null);
  const [language, setLanguage] = useState<Language>("en");
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [result, setResult] = useState<{
    recommendation: RoutineRecommendation;
    explanation: string;
    curatedProducts: LiveConsultationProduct[];
    recommendationId?: string;
    sessionId?: string;
    tenantId?: string;
  } | null>(null);
  const [imageConsent, setImageConsent] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [form, setForm] = useState({
    mainConcern: "I have dull skin and want a simple routine.",
    ageRange: "",
    country: "",
    skinType: "combination",
    sensitivity: "low",
    allergies: "",
    currentActives: "",
    pregnantOrBreastfeeding: false,
    prescriptionUse: false,
    budgetMax: 250,
  });

  useEffect(() => {
    if (/^ar/i.test(navigator.language)) setLanguage("ar");
    try {
      const saved = window.localStorage.getItem("ai-derma-recent-searches");
      if (saved) setRecentSearches(JSON.parse(saved).slice(0, 100));
      const last = window.localStorage.getItem("ai-derma-last-successful-search");
      if (last) setLastSuccessfulSearch(last);
    } catch {
      // localStorage is optional; the consultation still works without it.
    }
    void loadRecentConsultations(1, true);
  }, []);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (started) return;
    const id = window.setInterval(() => {
      setPlaceholderIndex((current) => (current + 1) % defaultSearches.length);
    }, 2800);
    return () => window.clearInterval(id);
  }, [started]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    beginConsultation();
  }

  function beginConsultation() {
    const clean = query.trim() || form.mainConcern;
    const nextLanguage = hasArabic(clean) ? "ar" : language;
    setLanguage(nextLanguage);
    setForm((current) => ({ ...current, mainConcern: clean }));
    setStarted(true);
    setResult(null);
    setError(null);
    window.requestAnimationFrame(() => {
      intakeRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function focusSearch() {
    window.scrollTo({ top: 0, behavior: "smooth" });
    window.requestAnimationFrame(() => searchRef.current?.focus());
  }

  function applyConcern(value: string) {
    const next = localizedSearchValue(value, language);
    setQuery(next);
    if (hasArabic(next)) setLanguage("ar");
    focusSearch();
  }

  async function getRoutine() {
    setLoading(true);
    setError(null);
    const activeLanguage = hasArabic(form.mainConcern) ? "ar" : language;
    if (activeLanguage !== language) setLanguage(activeLanguage);

    try {
      const anonymousSessionId = crypto.randomUUID();
      const sessionResponse = await fetch("/api/chat/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantSlug: "ai-derma-guru",
          anonymousUserId: anonymousSessionId,
          locale: activeLanguage === "ar" ? "ar-AE" : navigator.language,
          sourceUrl: window.location.href,
          referrer: document.referrer,
        }),
      });
      const sessionPayload = await sessionResponse.json();
      if (!sessionResponse.ok) throw new Error(sessionPayload.error ?? "Could not start consultation.");

      if (imageFile && imageConsent) {
        const uploadBody = new FormData();
        uploadBody.set("sessionId", sessionPayload.sessionId);
        uploadBody.set("tenantId", sessionPayload.tenant.id);
        uploadBody.set("accepted", "true");
        uploadBody.set("consentText", IMAGE_CONSENT_TEXT);
        uploadBody.set("image", imageFile);
        await fetch("/api/upload-image", { method: "POST", body: uploadBody });
      }

      const recommendationResponse = await fetch("/api/recommendations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantSlug: "ai-derma-guru",
          sessionId: sessionPayload.sessionId,
          intake: {
            ...form,
            mainConcern: expandSearchText(form.mainConcern),
            secondaryConcerns: [],
            allergies: split(form.allergies),
            currentProducts: [],
            currentActives: split(form.currentActives),
            symptoms: [],
            budgetMax: Number(form.budgetMax),
            routinePreference: "simple",
            fragrancePreference: "fragrance-free preferred",
            texturePreference: "lightweight",
            sunscreenUse: "sometimes",
            previousIrritationHistory: "",
          },
        }),
      });
      const recommendationPayload = await recommendationResponse.json();
      if (!recommendationResponse.ok) {
        throw new Error(recommendationPayload.error ?? "Could not create recommendations.");
      }
      const selectedProducts = selectRelevantCuratedProducts(
        curatedProducts,
        vendorShares,
        form,
        recommendationPayload.recommendation,
      );
      saveSuccessfulSearch(form.mainConcern);
      void saveRecentConsultation(localizedConsultationSummary(activeLanguage, form), selectedProducts);
      setResult({
        recommendation: recommendationPayload.recommendation,
        explanation: recommendationPayload.explanation,
        curatedProducts: selectedProducts,
        recommendationId: recommendationPayload.id,
        sessionId: sessionPayload.sessionId,
        tenantId: sessionPayload.tenant.id,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function loadRecentConsultations(page: number, replace = false) {
    const response = await fetch(`/api/live-consultations/recent?page=${page}&limit=10`);
    if (!response.ok) return;
    const payload = await response.json();
    setRecentConsultations((current) =>
      (replace ? payload.consultations : [...current, ...payload.consultations]).slice(0, 100),
    );
    const nextTotal = replace
      ? payload.consultations.length
      : recentConsultations.length + payload.consultations.length;
    setRecentHasMore(Boolean(payload.hasMore) && nextTotal < 100);
    setRecentPage(page);
  }

  async function saveRecentConsultation(summary: string, products: LiveConsultationProduct[]) {
    const response = await fetch("/api/live-consultations/recent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        concern: form.mainConcern,
        skinType: form.skinType,
        summary,
        products,
      }),
    });
    if (response.ok) void loadRecentConsultations(1, true);
  }

  function toggleVoiceSearch() {
    if (voiceListening) {
      recognitionRef.current?.stop();
      setVoiceListening(false);
      setVoiceMessage(null);
      return;
    }

    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceMessage(voiceUnsupportedMessage(language));
      return;
    }

    const recognition = new Recognition();
    recognitionRef.current = recognition;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = speechLanguage(language);
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setVoiceListening(true);
      setVoiceMessage(language === "ar" ? "نستمع الآن... قل مشكلة بشرتك." : "Listening... speak your skin concern now.");
    };

    recognition.onresult = (event) => {
      let transcript = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        transcript += event.results[index]?.[0]?.transcript ?? "";
      }
      const clean = transcript.trim();
      if (clean) {
        setQuery(clean);
        if (hasArabic(clean)) setLanguage("ar");
        setForm((current) => ({ ...current, mainConcern: clean }));
        setVoiceMessage(
          language === "ar" || hasArabic(clean)
            ? "تم التقاط الصوت. اضغط ابدأ الاستشارة للمتابعة."
            : "Voice captured. Tap Start consultation to continue.",
        );
      }
    };

    recognition.onerror = (event) => {
      setVoiceListening(false);
      setVoiceMessage(voiceErrorMessage(event.error, language));
    };

    recognition.onend = () => {
      setVoiceListening(false);
    };

    try {
      recognition.start();
    } catch {
      setVoiceListening(false);
      setVoiceMessage(
        language === "ar"
          ? "تعذر بدء البحث الصوتي. يرجى السماح باستخدام الميكروفون أو كتابة المشكلة."
          : "Voice search could not start. Please allow microphone access or type your concern.",
      );
    }
  }

  function saveSuccessfulSearch(value: string) {
    const clean = value.trim();
    if (!clean) return;
    setRecentSearches((current) => {
      const next = [clean, ...current.filter((item) => item !== clean)].slice(0, 100);
      try {
        window.localStorage.setItem("ai-derma-recent-searches", JSON.stringify(next));
        window.localStorage.setItem("ai-derma-last-successful-search", clean);
      } catch {}
      return next;
    });
    setLastSuccessfulSearch(clean);
  }

  function trackProductClick(product: LiveConsultationProduct) {
    if (!result?.tenantId) return;
    void fetch("/api/events/click", {
      method: "POST",
      headers: { "content-type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        tenantId: result.tenantId,
        sessionId: result.sessionId,
        productId: product.id,
        recommendationId: result.recommendationId,
        metadata: {
          destinationUrl: product.url,
          page: "live-consultation-1",
          concern: form.mainConcern,
        },
      }),
    });
  }

  function trackAddToCart(products: LiveConsultationProduct[]) {
    if (!result?.tenantId) return;
    const buyableProducts = products.filter(isBuyableProduct);
    if (buyableProducts.length === 0) return;
    void fetch("/api/events/add-to-cart", {
      method: "POST",
      headers: { "content-type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        tenantId: result.tenantId,
        sessionId: result.sessionId,
        recommendationId: result.recommendationId,
        metadata: {
          page: "live-consultation-1",
          concern: form.mainConcern,
          products: buyableProducts.map((product) => ({
            id: product.id,
            name: product.name,
            url: product.url,
            variantId: product.variantId,
          })),
        },
      }),
    });
  }

  const c = copy[language];
  const m = marketing[language];
  const heroChips = recentSearches.slice(0, 5);
  const rotatingPlaceholder = `${m.examplePrefix} ${localizedSearchValue(
    defaultSearches[placeholderIndex % defaultSearches.length],
    language,
  )}`;

  return (
    <main className={`lcx ${language === "ar" ? "lcx-rtl" : ""}`} dir={language === "ar" ? "rtl" : "ltr"} lang={language}>
      <header className="lcx-header">
        <div className="lcx-shell lcx-nav">
          <a className="lcx-brand" href="#lcx-top">
            <span className="lcx-brand-mark">
              <Sparkles size={18} />
            </span>
            <span>AI Derma Guru</span>
          </a>
          <label className="lcx-lang">
            <span>{c.language}</span>
            <select value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
              <option value="en">English</option>
              <option value="ar">العربية</option>
            </select>
          </label>
        </div>
      </header>

      <span id="lcx-top" />

      <section className="lcx-hero lcx-hero-center" id="lcx-consult">
        <div className="lcx-aurora" aria-hidden="true">
          <span className="lcx-orb lcx-orb-1" />
          <span className="lcx-orb lcx-orb-2" />
          <span className="lcx-orb lcx-orb-3" />
        </div>
        <div className="lcx-shell lcx-hero-narrow">
          <span className="lcx-eyebrow">
            <i className="lcx-live-dot" aria-hidden="true" />
            {m.heroEyebrow}
          </span>
          <h1>
            {m.heroTitleA} <span className="lcx-grad">{m.heroTitleB}</span>
          </h1>
          <p className="lcx-lead">{m.heroLead}</p>
          <form className="lcx-search" onSubmit={submit}>
            <Search size={20} />
            <input
              ref={searchRef}
              autoFocus
              onChange={(event) => {
                setQuery(event.target.value);
                if (hasArabic(event.target.value)) setLanguage("ar");
              }}
              placeholder={rotatingPlaceholder}
              value={query}
            />
            <button
              className={`lcx-mic${voiceListening ? " listening" : ""}`}
              type="button"
              aria-label={voiceListening ? "Stop voice search" : "Start voice search"}
              aria-pressed={voiceListening}
              onClick={toggleVoiceSearch}
            >
              <Mic size={18} />
            </button>
            <button className="lcx-search-submit" type="submit">
              <span>{c.start}</span>
              <Send size={16} />
            </button>
          </form>
          <div className="lcx-chip-row lcx-centered" aria-label="Example concerns">
            <span className="lcx-chip-label">{m.chipsLabel}</span>
            {heroChips.map((item) => (
              <button key={item} className="lcx-chip" type="button" onClick={() => applyConcern(item)}>
                {localizedSearchValue(item, language)}
              </button>
            ))}
          </div>
          <div className="lcx-values" aria-label="What you get">
            <span className="lcx-value">
              <Sparkles size={16} />
              {m.valueProps[0]}
            </span>
            <span className="lcx-value">
              <ShoppingBag size={16} />
              {m.valueProps[1]}
            </span>
            <span className="lcx-value">
              <ShieldCheck size={16} />
              {m.valueProps[2]}
            </span>
          </div>
          <p className="lcx-note">{c.note}</p>
          {voiceMessage ? <p className="lcx-voice">{voiceMessage}</p> : null}
        </div>
      </section>

      <div className="lcx-shell lcx-work">
        {started ? (
          <section className="live-intake-panel" ref={intakeRef} aria-label="AI Derma Guru consultation form">
            <div>
              <p className="eyebrow">AI Derma Guru</p>
              <h2>{c.formTitle}</h2>
            </div>
            <label>
              {c.mainConcern}
              <textarea
                value={form.mainConcern}
                onChange={(event) => {
                  setForm({ ...form, mainConcern: event.target.value });
                  if (hasArabic(event.target.value)) setLanguage("ar");
                }}
              />
            </label>
            <div className="compact-grid">
              <label>
                {c.ageRange}
                <input
                  placeholder="25-34"
                  value={form.ageRange}
                  onChange={(event) => setForm({ ...form, ageRange: event.target.value })}
                />
              </label>
              <label>
                {c.country}
                <input
                  placeholder="UAE"
                  value={form.country}
                  onChange={(event) => setForm({ ...form, country: event.target.value })}
                />
              </label>
              <label>
                {c.skinType}
                <select value={form.skinType} onChange={(event) => setForm({ ...form, skinType: event.target.value })}>
                  <option value="dry">{language === "ar" ? "جافة" : "dry"}</option>
                  <option value="normal">{language === "ar" ? "طبيعية" : "normal"}</option>
                  <option value="combination">{language === "ar" ? "مختلطة" : "combination"}</option>
                  <option value="oily">{language === "ar" ? "دهنية" : "oily"}</option>
                  <option value="sensitive">{language === "ar" ? "حساسة" : "sensitive"}</option>
                </select>
              </label>
              <label>
                {c.sensitivity}
                <select
                  value={form.sensitivity}
                  onChange={(event) => setForm({ ...form, sensitivity: event.target.value })}
                >
                  <option value="low">{language === "ar" ? "منخفضة" : "low"}</option>
                  <option value="moderate">{language === "ar" ? "متوسطة" : "moderate"}</option>
                  <option value="high">{language === "ar" ? "مرتفعة" : "high"}</option>
                  <option value="very sensitive">{language === "ar" ? "حساسة جداً" : "very sensitive"}</option>
                </select>
              </label>
            </div>
            <label>
              {c.allergies}
              <input
                placeholder="salicylic acid, fragrance"
                value={form.allergies}
                onChange={(event) => setForm({ ...form, allergies: event.target.value })}
              />
            </label>
            <label>
              {c.currentActives}
              <input
                placeholder="retinol, acids, prescription creams"
                value={form.currentActives}
                onChange={(event) => setForm({ ...form, currentActives: event.target.value })}
              />
            </label>
            <div className="toggle-row">
              <label>
                <input
                  checked={form.pregnantOrBreastfeeding}
                  onChange={(event) => setForm({ ...form, pregnantOrBreastfeeding: event.target.checked })}
                  type="checkbox"
                />
                {c.pregnant}
              </label>
              <label>
                <input
                  checked={form.prescriptionUse}
                  onChange={(event) => setForm({ ...form, prescriptionUse: event.target.checked })}
                  type="checkbox"
                />
                {c.prescription}
              </label>
            </div>
            <div className="live-image-option">
              <label className="consent-box">
                <input checked={imageConsent} onChange={(event) => setImageConsent(event.target.checked)} type="checkbox" />
                {c.photoConsent}
              </label>
              <label className="secondary-button">
                <Camera size={18} />
                {imageFile ? imageFile.name : c.optionalPhoto}
                <input
                  accept="image/jpeg,image/png,image/webp"
                  disabled={!imageConsent}
                  hidden
                  onChange={(event) => setImageFile(event.target.files?.[0] ?? null)}
                  type="file"
                />
              </label>
            </div>
            <button className="primary-button" type="button" onClick={getRoutine}>
              {loading ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
              {c.getRoutine}
            </button>
            {error ? <p className="error-text">{error}</p> : null}
            {result ? (
              <div className="live-result-panel">
                <div className="curated-result-heading">
                  <div>
                    <strong>{c.resultTitle}</strong>
                    <p>{c.resultIntro}</p>
                  </div>
                  {result.curatedProducts.some(isBuyableProduct) ? (
                    <a
                      className="cart-routine-button"
                      href={buildRoutineCartUrl(result.curatedProducts)}
                      onClick={() => trackAddToCart(result.curatedProducts)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ShoppingCart size={18} />
                      {c.addRoutine}
                    </a>
                  ) : null}
                </div>
                {result.recommendation.items.length ? (
                  <>
                    <ConsultationPlan form={form} products={result.curatedProducts} language={language} />
                    <div className="recommended-products-heading">
                      <span>{c.productHeading}</span>
                      <p>{c.productIntro}</p>
                    </div>
                    {result.curatedProducts.map((product) => (
                      <article className="live-curated-card" key={product.id}>
                        <img
                          alt={product.name}
                          onError={(event) => {
                            event.currentTarget.src = fallbackProductImage(product);
                          }}
                          src={product.imageUrl || fallbackProductImage(product)}
                        />
                        <div>
                          <strong>{translateSlot(product.routineSlot, language)}</strong>
                          <h3>{product.name}</h3>
                          {product.discoveryOnly ? (
                            <p className="lookup-only-note">{c.lookupOnly}</p>
                          ) : (
                            <>
                              <ProductPrice product={product} language={language} />
                              <dl>
                                <div>
                                  <dt>{c.productType}</dt>
                                  <dd>{translateCategory(product.category, language)}</dd>
                                </div>
                                <div>
                                  <dt>{c.whyProduct}</dt>
                                  <dd>{productWhy(product, language)}</dd>
                                </div>
                                <div>
                                  <dt>{c.howHelp}</dt>
                                  <dd>{benefitFor(product, language)}</dd>
                                </div>
                                <div>
                                  <dt>{c.timeline}</dt>
                                  <dd>{timelineFor(product.category, form.mainConcern, language)}</dd>
                                </div>
                              </dl>
                              <div className="product-card-actions">
                                <a href={product.url} target="_blank" rel="noreferrer" onClick={() => trackProductClick(product)}>
                                  {c.shop}
                                  <ExternalLink size={14} />
                                </a>
                                {isBuyableProduct(product) ? (
                                  <a
                                    className="add-single-cart"
                                    href={buildRoutineCartUrl([product])}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={() => trackAddToCart([product])}
                                  >
                                    <ShoppingCart size={14} />
                                    {c.addCart}
                                  </a>
                                ) : null}
                              </div>
                            </>
                          )}
                        </div>
                      </article>
                    ))}
                  </>
                ) : (
                  <article className="live-referral-result">
                    <div>
                      <strong>{result.recommendation.safety.level}</strong>
                      <h3>{c.pausedTitle}</h3>
                      <p>{language === "ar" ? arabicReferralMessage() : result.recommendation.summary}</p>
                    </div>
                  </article>
                )}
                {lastSuccessfulSearch ? (
                  <aside className="consult-review-widget" aria-label="Recent successful consultation">
                    <div>
                      <span>{c.recentConsultation}</span>
                      <strong>{lastSuccessfulSearch}</strong>
                    </div>
                    <p>{c.reviewCopy}</p>
                  </aside>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>

      {!started && recentConsultations.length ? (
        <section className="lcx-section lcx-also" id="lcx-concerns">
          <div className="lcx-shell">
            <div className="lcx-section-head">
              <h2>{c.footerTitle}</h2>
              <p>
                {language === "ar"
                  ? "استشارات حديثة حقيقية — اضغط واحدة لرؤية الروتين والمنتجات."
                  : "Real recent consultations — tap one to see the routine and products."}
              </p>
            </div>
            <div className="lcx-recent-grid">
              {recentConsultations.map((item) => (
                <a href={`/recommendations/${item.slug}`} key={item.slug}>
                  <strong>{item.concern}</strong>
                  <small>{item.skin_type ? translateSkinValue(item.skin_type, language) : c.skinRoutine}</small>
                </a>
              ))}
            </div>
            {recentHasMore ? (
              <button className="lcx-btn lcx-btn-ghost lcx-more" type="button" onClick={() => loadRecentConsultations(recentPage + 1)}>
                {c.moreRecent}
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      <footer className="lcx-footer">
        <div className="lcx-shell lcx-footer-inner">
          <span>{m.footerLegal}</span>
          <span>{m.footerLinks}</span>
        </div>
      </footer>
    </main>
  );
}

type RecentConsultation = {
  slug: string;
  title: string;
  concern: string;
  skin_type: string;
  summary: string;
  created_at: string;
};

function speechLanguage(language: Language) {
  if (language === "ar") return "ar-AE";
  const browserLanguage = navigator.language || "en-US";
  return /^ar/i.test(browserLanguage) ? "ar-AE" : browserLanguage;
}

function voiceUnsupportedMessage(language: Language) {
  return language === "ar"
    ? "البحث الصوتي غير مدعوم في هذا المتصفح. يرجى كتابة مشكلة البشرة."
    : "Voice search is not supported in this browser. Please type your skin concern instead.";
}

function voiceErrorMessage(error: string | undefined, language: Language) {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return language === "ar"
      ? "تم حظر الوصول إلى الميكروفون. يرجى السماح بالميكروفون ثم الضغط مرة أخرى."
      : "Microphone access is blocked. Please allow microphone permission, then tap the mic again.";
  }
  if (error === "no-speech") {
    return language === "ar" ? "لم أسمع شيئاً. اضغط على الميكروفون وحاول مرة أخرى." : "I did not hear anything. Tap the mic and try again.";
  }
  if (error === "audio-capture") {
    return language === "ar" ? "لم يتم العثور على ميكروفون. يرجى كتابة المشكلة." : "No microphone was found. Please type your skin concern instead.";
  }
  return language === "ar"
    ? "توقف البحث الصوتي. يمكنك الضغط على الميكروفون مرة أخرى أو كتابة المشكلة."
    : "Voice search stopped. You can tap the mic again or type your concern.";
}

function ProductPrice({ product, language }: { product: LiveConsultationProduct; language: Language }) {
  const before = product.beforePrice;
  const after = product.afterPrice ?? product.price;
  const savings = savingText(before, after);

  return (
    <div className="product-price-strip">
      {before ? <span className="before-price">{before}</span> : null}
      <strong>{after}</strong>
      {savings ? <em>{language === "ar" ? `وفر ${savings}` : `Save ${savings}`}</em> : null}
    </div>
  );
}

function ConsultationPlan({
  form,
  products,
  language,
}: {
  form: {
    mainConcern: string;
    skinType: string;
    sensitivity: string;
    currentActives: string;
  };
  products: LiveConsultationProduct[];
  language: Language;
}) {
  const concern = form.mainConcern.toLowerCase();
  const expandedConcern = expandSearchText(`${concern} ${form.skinType} ${form.sensitivity}`).toLowerCase();
  const acneOrOily = /acne|pimple|breakout|oily|blackhead|pores/.test(expandedConcern);
  const sensitive = /sensitive|burn|stinging|barrier|irritat|eczema|rash/.test(expandedConcern);
  const glow = /dull|dark|spot|glow|tone|pigment|uneven|melasma/.test(expandedConcern);

  const headline =
    language === "ar"
      ? acneOrOily
        ? "لدعم مظهر بشرة أنقى خلال 2-3 أسابيع، اجعل الروتين بسيطاً وثابتاً."
        : glow
          ? "لإشراقة ومظهر أكثر توحداً، ابدأ بواقي الشمس والترطيب وسيروم واحد مناسب."
          : sensitive
            ? "ابدأ بتهدئة حاجز البشرة، ثم أضف المنتجات النشطة تدريجياً."
            : "ابدأ بروتين يومي بسيط قبل إضافة منتجات نشطة إضافية."
      : acneOrOily
        ? "To support clearer-looking skin in the next 2-3 weeks, keep the routine simple and consistent."
        : glow
          ? "For a brighter, more even-looking glow, build around sunscreen, hydration, and one focused serum."
          : sensitive
            ? "First calm the barrier, then add active products slowly."
            : "Start with a simple daily routine before adding extra actives.";

  const morningSteps =
    language === "ar"
      ? [
          "الغسول: يزيل الدهون والعرق وبقايا المنتجات بدون فرك قوي.",
          "السيروم أو العلاج الخفيف: يستهدف المشكلة الأساسية بدون تكديس مكونات نشطة كثيرة.",
          "المرطب: يحافظ على حاجز البشرة حتى تتحمل الروتين.",
          "واقي الشمس: خطوة أساسية صباحاً، خصوصاً للتصبغات وآثار الحبوب والبهتان والملمس.",
        ]
      : [
          "Cleanser: remove oil, sweat, and residue without scrubbing.",
          "Serum or light treatment: target the main concern without stacking too many actives.",
          "Moisturizer: keep the barrier steady so the skin tolerates the routine.",
          "Sunscreen: non-negotiable in the morning, especially for acne marks, dark spots, dullness, and texture.",
        ];
  const eveningSteps = acneOrOily
    ? language === "ar"
      ? [
          "الغسول: نظف البشرة مساءً لإزالة واقي الشمس والدهون المتراكمة.",
          "خطوة للحبوب أو المسام: استخدم BHA أو مقشر لطيف فقط إذا كان مناسباً، وابدأ 1-3 مرات أسبوعياً.",
          "المرطب: اختم بطبقة خفيفة تدعم حاجز البشرة وتقلل احتمال التهيج.",
        ]
      : [
          "Cleanser: cleanse again at night to remove sunscreen and oil buildup.",
          "Acne or pore step: use BHA/exfoliant only if suitable, starting slowly 1-3 nights weekly.",
          "Moisturizer: finish with a light barrier-support layer to reduce irritation risk.",
        ]
    : sensitive
      ? language === "ar"
        ? [
            "الغسول: اجعله لطيفاً وتجنب المقشرات القاسية.",
            "خطوة التعافي: استخدم مرطباً داعماً للحاجز قبل إضافة المكونات النشطة.",
            "المكونات النشطة: انتظر حتى يهدأ الحرقان أو اللسع قبل إدخال الأحماض أو الريتينول.",
          ]
        : [
            "Cleanser: keep it gentle and avoid scrubs.",
            "Recovery step: use moisturizer/barrier support before adding actives.",
            "Actives: wait until burning or stinging has settled before introducing acids or retinoid-style products.",
          ]
      : language === "ar"
        ? [
            "الغسول: يزيل واقي الشمس وتراكم اليوم.",
            "السيروم أو العلاج: استخدم المنتج المستهدف باستمرار وبدون مبالغة.",
            "المرطب: يحافظ على الترطيب ويدعم حاجز البشرة أثناء الليل.",
          ]
        : [
            "Cleanser: remove sunscreen and daily buildup.",
            "Serum or treatment: use the focused product consistently, not aggressively.",
            "Moisturizer: seal hydration and protect the barrier overnight.",
          ];

  return (
    <section className="consult-plan" aria-label={language === "ar" ? "خطة روتين عناية مخصصة" : "Personalized skincare routine plan"}>
      <div className="consult-plan-hero">
        <span>{language === "ar" ? "خطة البشرة بالذكاء الاصطناعي" : "AI skin plan"}</span>
        <h3>{headline}</h3>
        <p>
          {language === "ar"
            ? "حسب مشكلتك، لا يبدأ الروتين بمنتجات عشوائية. الترتيب الأفضل هو: تنظيف، علاج، ترطيب، وحماية. التغييرات التجميلية الملحوظة تحتاج غالباً إلى الاستمرارية، وقد تختلف النتائج من شخص لآخر."
            : "Based on your concern, the routine should not start with random products. It should start with the correct order: cleanse, treat, moisturize, and protect. Visible cosmetic change usually needs consistency, and acne or tone concerns can vary from person to person."}
        </p>
      </div>
      <div className="routine-columns">
        <article>
          <strong>{language === "ar" ? "روتين الصباح" : "Morning routine"}</strong>
          <ol>
            {morningSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </article>
        <article>
          <strong>{language === "ar" ? "روتين المساء" : "Evening routine"}</strong>
          <ol>
            {eveningSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </article>
      </div>
      <div className="derm-advice-grid">
        <div>
          <strong>{language === "ar" ? "لماذا واقي الشمس ضروري" : "Why sunscreen is not optional"}</strong>
          <p>
            {language === "ar"
              ? "بدون واقي شمس يومي، قد تبدو التصبغات وآثار الحبوب وعدم توحد اللون أسوأ حتى لو كان باقي الروتين مناسباً."
              : "Without daily SPF, dark spots, post-acne marks, and uneven tone can keep looking worse even when the rest of the routine is good."}
          </p>
        </div>
        <div>
          <strong>{language === "ar" ? "عادات داعمة للبشرة" : "Skin-support habits"}</strong>
          <p>
            {language === "ar"
              ? "اهتم بالنوم، شرب الماء بانتظام، والوجبات المتوازنة. إذا كانت الحبوب تزيد مع السكر أو النشويات المكررة، فقد يساعد تقليلها على مظهر أنقى."
              : "Prioritize sleep, steady hydration, and balanced meals. If breakouts flare with high-sugar or refined-carb foods, reducing those triggers may support clearer-looking skin."}
          </p>
        </div>
        <div>
          <strong>{language === "ar" ? "ترتيب المنتجات المقترح" : "Recommended product order"}</strong>
          <p>
            {products.map((product) => translateCategory(product.category, language)).slice(0, 4).join(" + ") ||
              (language === "ar" ? "غسول + مرطب + واقي شمس" : "Cleanser + moisturizer + sunscreen")}
          </p>
        </div>
      </div>
    </section>
  );
}

export function selectRelevantCuratedProducts(
  products: LiveConsultationProduct[],
  vendorShares: LiveConsultationVendor[],
  form: {
    mainConcern: string;
    skinType: string;
    sensitivity: string;
    allergies: string;
    currentActives: string;
    pregnantOrBreastfeeding: boolean;
  },
  recommendation: RoutineRecommendation,
) {
  if (!recommendation.items.length) return [];
  const allergyTokens = tokenize(form.allergies).filter((token) => token !== "allergies" && token !== "allergy");
  const queryText = expandSearchText(
    `${form.mainConcern} ${form.skinType} ${form.sensitivity} ${form.currentActives} ${recommendation.summary}`,
  );
  const intentText = expandSearchText(`${form.mainConcern} ${form.skinType} ${form.sensitivity} ${form.currentActives}`);
  const queryTokens = tokenize(
    queryText,
  );
  const hairIntent = isHairConcern(intentText);
  const requestedTypes = requestedProductTypes(intentText);
  const strictProductType = requestedTypes.length > 0 && !isRoutineRequest(intentText);
  const acneSafeIntent = isAcneSafeIntent(intentText);

  const scored = products
    .filter((product) => {
      const text = productText(product);
      const identity = productIdentityText(product);
      if (!isInStock(product)) return false;
      if (allergyTokens.length && allergyTokens.some((token) => text.includes(token))) return false;
      if (form.pregnantOrBreastfeeding && /retinol|retinoid|retinal|tretinoin|adapalene/.test(text)) return false;
      if (!hairIntent && isHairProduct(product)) return false;
      if (hairIntent && !isHairProduct(product)) return false;
      if (hairIntent && /foundation|concealer|powder|makeup|lip|gloss|primer|self tanner|face serum|face serums|toner|sunscreen|spf/.test(text)) {
        return false;
      }
      if (strictProductType && !productMatchesRequestedTypes(product, requestedTypes)) return false;
      if (acneSafeIntent && /foundation|concealer|powder|makeup|lip|gloss|hair|scalp|shampoo|conditioner|mask/.test(identity)) {
        return false;
      }
      return true;
    })
    .map((product) => {
      const text = productText(product);
      const matches = queryTokens.filter((token) => text.includes(token)).length;
      const basicRoutineBoost = !hairIntent && /cleanser|moistur|sunscreen|spf|serum/i.test(product.category + product.routineSlot)
        ? 2
        : 0;
      const hairBoost = hairIntent && isHairProduct(product) ? 120 : 0;
      const hairPenalty = hairIntent && !isHairProduct(product) ? -80 : 0;
      const typeBoost = requestedTypes.length && productMatchesRequestedTypes(product, requestedTypes) ? 180 : 0;
      const acneSafeBoost = acneSafeIntent && productLooksAcneSafe(product) ? 120 : 0;
      const strictTypePenalty = strictProductType && !productMatchesRequestedTypes(product, requestedTypes) ? -500 : 0;
      const priority = Number.isFinite(Number(product.priority)) ? Number(product.priority) : 0;
      const priorityWeight = strictProductType ? 0.25 : 0.65;
      return {
        product,
        pinned: priority >= 95 && (!hairIntent || isHairProduct(product)) && (!strictProductType || productMatchesRequestedTypes(product, requestedTypes)),
        score: matches * 12 + basicRoutineBoost + hairBoost + hairPenalty + typeBoost + acneSafeBoost + strictTypePenalty + priority * priorityWeight,
      };
    })
    .filter((item) => item.score > (hairIntent ? 40 : 0))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.score - a.score)
    .map((item) => item.product);

  const selected = selectByVendorAllocation(scored, vendorShares, 5);
  const discoveryProducts = buildDiscoveryOnlyProducts(form, selected).filter(
    (product) => !selected.some((selectedProduct) => selectedProduct.id === product.id),
  );
  return [...selected, ...discoveryProducts].slice(0, 6);
}

function buildRoutineCartUrl(products: LiveConsultationProduct[]) {
  const items = products.filter(isBuyableProduct).map((product) => ({
    id: product.id,
    name: product.name,
    url: product.url,
    variantId: product.variantId,
  }));
  return `/api/cart/cicabelle?items=${encodeURIComponent(JSON.stringify(items))}`;
}

function selectByVendorAllocation(
  products: LiveConsultationProduct[],
  vendorShares: LiveConsultationVendor[],
  maxProducts: number,
) {
  if (!vendorShares.length) return products.slice(0, maxProducts);
  const activeVendors = vendorShares.filter((vendor) => vendor.share > 0);
  if (!activeVendors.length) return products.slice(0, maxProducts);

  const selected: LiveConsultationProduct[] = [];
  const quotas = activeVendors
    .map((vendor) => {
      const exact = (vendor.share / 100) * maxProducts;
      return {
        name: vendor.name,
        count: Math.floor(exact),
        remainder: exact - Math.floor(exact),
        share: vendor.share,
      };
    })
    .sort((a, b) => b.remainder - a.remainder);

  let assigned = quotas.reduce((sum, quota) => sum + quota.count, 0);
  for (const quota of quotas) {
    if (assigned < maxProducts) {
      quota.count += 1;
      assigned += 1;
    }
  }

  for (const quota of quotas.sort((a, b) => b.share - a.share)) {
    selected.push(
      ...products
        .filter((product) => product.vendor === quota.name && !selected.some((item) => item.id === product.id))
        .slice(0, quota.count),
    );
  }

  if (selected.length < maxProducts) {
    selected.push(
      ...products
        .filter((product) => !selected.some((item) => item.id === product.id))
        .slice(0, maxProducts - selected.length),
    );
  }

  return selected.slice(0, maxProducts);
}

function buildDiscoveryOnlyProducts(
  form: { mainConcern: string; skinType: string },
  selectedProducts: LiveConsultationProduct[] = [],
) {
  const text = expandSearchText(`${form.mainConcern} ${form.skinType}`).toLowerCase();
  const products: LiveConsultationProduct[] = [];

  if (/dark circles|eye area|هالات/.test(text)) {
    products.push(discoveryProduct("lookup-caffeine-eye-cream", "Caffeine Eye Cream", "Eye care", "Dark circles visual support"));
  }
  if (/melasma|hyperpigmentation|dark spots|pigmentation|تصبغات|كلف/.test(text)) {
    products.push(discoveryProduct("lookup-tinted-mineral-spf", "Tinted Mineral Sunscreen SPF50", "Sunscreen", "Dark spot support"));
  }
  if (/eczema|psoriasis|dry rash|itchy|flaky|barrier|اكزيما|صدفية/.test(text)) {
    products.push(discoveryProduct("lookup-fragrance-free-barrier-cream", "Fragrance-Free Barrier Repair Cream", "Moisturizer", "Barrier support"));
  }
  if (/rosacea|redness|red face|red cheeks|وردية/.test(text)) {
    products.push(discoveryProduct("lookup-calming-redness-serum", "Calming Redness Support Serum", "Serum", "Sensitive skin support"));
  }
  if (/fungal acne|حبوب فطرية/.test(text)) {
    products.push(discoveryProduct("lookup-oil-free-gel-moisturizer", "Oil-Free Lightweight Gel Moisturizer", "Moisturizer", "Lightweight support"));
  }
  if (isHairConcern(text)) {
    products.push(discoveryProduct("lookup-hair-repair-mask", "Deep Repair Conditioning Hair Mask", "Hair Care", "Dry hair support"));
  }

  return products.filter((product) => !hasSelectedEquivalentForDiscoveryProduct(selectedProducts, product));
}

function hasSelectedEquivalentForDiscoveryProduct(
  selectedProducts: LiveConsultationProduct[],
  discoveryOnlyProduct: LiveConsultationProduct,
) {
  const discoveryId = discoveryOnlyProduct.id;
  const relatedPattern =
    discoveryId.includes("hair")
      ? /hair|scalp|shampoo|conditioner|conditioning|mask|k18|olaplex|repair/
      : discoveryId.includes("spf")
        ? /spf|sunscreen|mineral|tint|dark spot|pigment|bright|glow|vitamin|niacinamide/
        : discoveryId.includes("eye")
          ? /eye|caffeine|dark circle/
          : discoveryId.includes("redness")
            ? /calm|redness|sensitive|cica|centella|relief/
            : discoveryId.includes("oil-free")
              ? /oil-free|lightweight|gel|non-comedogenic|moistur/
              : /barrier|repair|cream|moistur|ceramide|balm|relief/;

  return selectedProducts.some((product) => !product.discoveryOnly && relatedPattern.test(productText(product)));
}

function discoveryProduct(id: string, name: string, category: string, bundleTag: string): LiveConsultationProduct {
  return {
    id,
    vendor: "Reference",
    name,
    category,
    imageUrl: fallbackProductImage({ category, name } as LiveConsultationProduct),
    price: "",
    url: "",
    routineSlot: "Reference product",
    why: "",
    safety: "",
    trust: "",
    bundleTag,
    priority: 1,
    keywords: [name, category, bundleTag],
    discoveryOnly: true,
  };
}

function savingText(before?: string, after?: string) {
  const beforeValue = priceNumber(before);
  const afterValue = priceNumber(after);
  if (!beforeValue || !afterValue || beforeValue <= afterValue) return "";
  return `AED ${Math.round(beforeValue - afterValue)}`;
}

function priceNumber(value?: string) {
  const match = value?.match(/[\d.]+/);
  return match ? Number(match[0]) : 0;
}

function productText(product: LiveConsultationProduct) {
  return [
    product.name,
    product.category,
    product.routineSlot,
    product.why,
    product.safety,
    product.bundleTag,
    ...(product.keywords ?? []),
  ]
    .join(" ")
    .toLowerCase();
}

function productIdentityText(product: LiveConsultationProduct) {
  return [
    product.name,
    product.category,
    product.routineSlot,
    product.bundleTag,
  ]
    .join(" ")
    .toLowerCase();
}

type RequestedProductType = "moisturizer" | "cleanser" | "sunscreen" | "serum" | "exfoliant" | "spotTreatment" | "hairCare";

function requestedProductTypes(value: string): RequestedProductType[] {
  const text = value.toLowerCase();
  const types: RequestedProductType[] = [];

  if (/\b(moisturi[sz]er|moisturising|moisturizing|moisturiser|hydrating cream|face cream|gel cream|barrier cream|lotion|cream)\b/.test(text)) {
    types.push("moisturizer");
  }
  if (/\b(cleanser|face wash|cleansing gel|cleansing foam|wash)\b/.test(text)) {
    types.push("cleanser");
  }
  if (/\b(sunscreen|spf|sun cream|sunblock)\b/.test(text)) {
    types.push("sunscreen");
  }
  if (/\b(serum|ampoule|essence)\b/.test(text)) {
    types.push("serum");
  }
  if (/\b(exfoliant|exfoliator|toner|bha|aha|peeling)\b/.test(text)) {
    types.push("exfoliant");
  }
  if (/\b(spot treatment|spot gel|pimple patch|acne patch)\b/.test(text)) {
    types.push("spotTreatment");
  }
  if (/\b(hair|scalp|shampoo|conditioner|hair mask|hair oil|leave-in)\b/.test(text)) {
    types.push("hairCare");
  }

  return Array.from(new Set(types));
}

function isRoutineRequest(value: string) {
  return /\b(routine|regimen|full routine|morning|evening|am routine|pm routine|steps|kit|bundle)\b/.test(value.toLowerCase());
}

function isAcneSafeIntent(value: string) {
  const text = value.toLowerCase();
  return /acne|pimple|blemish|breakout|comedone|blackhead|whitehead|closed comedone/.test(text) &&
    /safe|prone|non.?comed|moistur|cream|lotion|gel/.test(text);
}

function productMatchesRequestedTypes(product: LiveConsultationProduct, requestedTypes: RequestedProductType[]) {
  if (!requestedTypes.length) return true;
  return requestedTypes.some((type) => productMatchesRequestedType(product, type));
}

function productMatchesRequestedType(product: LiveConsultationProduct, type: RequestedProductType) {
  const identity = productIdentityText(product);

  if (type !== "hairCare" && isHairProduct(product)) return false;

  switch (type) {
    case "moisturizer":
      return /moistur|hydrating|hydration|cream|lotion|gel cream|barrier|balm|cicaplast|effaclar mat/.test(identity) &&
        !/serum|cleanser|cleansing|wash|shampoo|conditioner|sunscreen|spf|foundation|concealer|powder|makeup|lip|gloss|toner|exfoliant/.test(identity);
    case "cleanser":
      return /cleanser|cleansing|face wash|wash|foam cleanser|gel cleanser/.test(identity) &&
        !/moistur|serum|sunscreen|spf|conditioner|shampoo/.test(identity);
    case "sunscreen":
      return /sunscreen|spf|sun cream|sunblock/.test(identity);
    case "serum":
      return /serum|ampoule|essence/.test(identity) && !/cleanser|moisturizer|moisturiser|cream|sunscreen|spf/.test(identity);
    case "exfoliant":
      return /exfoliant|exfoliator|toner|bha|aha|peeling|salicylic|glycolic|lactic/.test(identity);
    case "spotTreatment":
      return /spot|patch|pimple|blemish|benzoyl/.test(identity);
    case "hairCare":
      return isHairProduct(product);
  }
}

function productLooksAcneSafe(product: LiveConsultationProduct) {
  const text = productText(product);
  return /acne|blemish|pore|oil.?free|non.?comed|oily|matte|mattifying|gel|lightweight|effaclar|soothing|relief|barrier/.test(text);
}

function isHairConcern(value: string) {
  return /hair|scalp|dandruff|frizz|dry hair|hair fall|hair loss|hair lost|split ends|conditioning|shampoo|conditioner|mask|شعر|الشعر|فروة|قشرة|هيشان|تساقط/.test(
    value.toLowerCase(),
  );
}

function isHairProduct(product: LiveConsultationProduct) {
  const identity = productIdentityText(product);
  if (/face|facial|skin|body|lotion|moisturizer|moisturising|cream|serum|toner|acne|makeup|lip|powder|foundation|concealer|primer|sunscreen|spf/.test(identity)) {
    return /hair|scalp|shampoo|conditioner|conditioning|hair care|hair styling|hair loss|hair mask/.test(identity);
  }
  return /hair|scalp|dandruff|shampoo|conditioner|conditioning|hair care|hair styling|hair loss|hair mask|karseell|olaplex|k18|mielle/.test(identity);
}

function isBuyableProduct(product: LiveConsultationProduct) {
  if (product.discoveryOnly || !product.url || !isInStock(product)) return false;
  try {
    const url = new URL(product.url);
    return url.hostname.includes("cicabelle.com") && url.pathname.includes("/products/");
  } catch {
    return false;
  }
}

function isInStock(product: LiveConsultationProduct) {
  if (product.discoveryOnly) return true;
  if (product.inventorySize === undefined) return true;
  return Number(product.inventorySize) > 0;
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !["skin", "want", "with", "have", "and", "for", "the"].includes(token));
}

function hasArabic(value: string) {
  return /[\u0600-\u06FF]/.test(value);
}

function localizedSearchValue(value: string, language: Language) {
  if (language !== "ar") return value;
  return (
    {
      "dark spots and dull skin routine": "تصبغات وبهتان البشرة مع روتين بسيط",
      "oily skin with blackheads": "بشرة دهنية مع رؤوس سوداء",
      "dry sensitive barrier repair": "بشرة جافة وحساسة تحتاج ترميم الحاجز",
      "simple glow routine under AED 200": "روتين إشراقة بسيط أقل من 200 درهم",
      "acne-safe sunscreen and moisturizer": "واقي شمس ومرطب مناسب للبشرة المعرضة للحبوب",
    }[value] ?? value
  );
}

function localizedConsultationSummary(language: Language, form: { mainConcern: string; skinType: string }) {
  if (language === "ar") {
    return `روتين OTC مقترح لمشكلة: ${form.mainConcern}. تم اختيار المنتجات حسب نوع البشرة والملاءمة وقواعد السلامة العامة.`;
  }
  return `Suggested OTC skincare routine for: ${form.mainConcern}. Products were selected by concern, skin fit, and conservative safety rules.`;
}

function arabicReferralMessage() {
  return "بناءً على ما تمت مشاركته، قد تحتاج هذه الحالة إلى مراجعة مختص. يمكن لـ AI Derma Guru تقديم إرشادات عامة لمنتجات بدون وصفة، لكنه لا يشخص أو يعالج الحالات الطبية. إذا كان لديك صعوبة في التنفس، تورم في الشفاه أو اللسان أو الوجه، حمى، احمرار ينتشر بسرعة، ألم شديد، أو مشكلة حول العين، اطلب رعاية طبية عاجلة.";
}

function translateSkinValue(value: string, language: Language) {
  if (language !== "ar") return value;
  return (
    {
      dry: "بشرة جافة",
      normal: "بشرة طبيعية",
      combination: "بشرة مختلطة",
      oily: "بشرة دهنية",
      sensitive: "بشرة حساسة",
      low: "منخفضة",
      moderate: "متوسطة",
      high: "مرتفعة",
      "very sensitive": "حساسة جداً",
    }[value.toLowerCase()] ?? value
  );
}

function translateCategory(category: string, language: Language) {
  if (language !== "ar") return category;
  const text = category.toLowerCase();
  if (/cleanser/.test(text)) return "غسول";
  if (/sunscreen|spf/.test(text)) return "واقي شمس";
  if (/moistur/.test(text)) return "مرطب";
  if (/serum/.test(text)) return "سيروم";
  if (/exfoliant|acid|bha/.test(text)) return "مقشر لطيف";
  if (/hydration/.test(text)) return "ترطيب";
  if (/eye/.test(text)) return "عناية حول العين";
  if (/add-on/.test(text)) return "إضافة اختيارية";
  return category;
}

function translateSlot(slot: string, language: Language) {
  if (language !== "ar") return slot;
  const text = slot.toLowerCase();
  if (/cleanse/.test(text)) return "1. تنظيف";
  if (/tone|serum/.test(text)) return "2. دعم اللون والإشراقة";
  if (/moistur|oil-control/.test(text)) return "3. ترطيب";
  if (/protect|spf/.test(text)) return "4. حماية";
  if (/exfoliant/.test(text)) return "خطوة اختيارية للتقشير";
  if (/reference/.test(text)) return "منتج مرجعي";
  return slot;
}

function productWhy(product: LiveConsultationProduct, language: Language) {
  if (language !== "ar") return product.why;
  const text = `${product.category} ${product.name} ${product.bundleTag ?? ""}`.toLowerCase();
  if (/sunscreen|spf/.test(text)) {
    return "خطوة حماية يومية مهمة للتصبغات، آثار الحبوب، البهتان، وعدم توحد اللون.";
  }
  if (/cleanser|bha|salicylic|blackhead/.test(text)) {
    return "يساعد على تنظيف الدهون والمسام والرؤوس السوداء عندما تكون البشرة مناسبة لهذا النوع من المنتجات.";
  }
  if (/moistur|barrier|cerave|cream|lotion/.test(text)) {
    return "يدعم الترطيب وحاجز البشرة، خصوصاً عند الجفاف أو الحساسية أو الشعور بالشد.";
  }
  if (/serum|glow|spot|tone|niacinamide|axis/.test(text)) {
    return "خطوة مركزة لدعم مظهر الإشراقة والتصبغات وآثار الحبوب بدون تعقيد الروتين.";
  }
  return "تم اختياره كخطوة مناسبة ضمن الروتين بناءً على المشكلة والملاءمة العامة.";
}

function benefitFor(product: LiveConsultationProduct, language: Language) {
  if (language === "ar") {
    if (/sunscreen|spf/i.test(product.category + product.name)) {
      return "يساعد في تقليل تأثير الشمس على التصبغات والبهتان عند الاستخدام اليومي الصحيح.";
    }
    if (/bundle|cleanser|cream|moistur/i.test(product.category + product.name)) {
      return "يساعد على تبسيط الروتين ودعم راحة حاجز البشرة.";
    }
    if (/serum|tone|glow/i.test(product.category + product.name)) {
      return "يساعد على تحسين مظهر البهتان، تفاوت اللون، والملمس مع الاستمرارية.";
    }
    return "يضيف خطوة دعم مركزة بدون الاستغناء عن الأساسيات: الغسول، المرطب، وواقي الشمس.";
  }
  if (/sunscreen|spf/i.test(product.category + product.name)) {
    return "Helps protect the routine from UV-triggered dullness and uneven-looking tone.";
  }
  if (/bundle|cleanser|cream/i.test(product.category + product.name)) {
    return "Helps simplify the routine while supporting a calmer, more comfortable skin barrier.";
  }
  if (/serum|tone|glow/i.test(product.category + product.name)) {
    return "Helps target the look of dullness, uneven tone, and visible texture without overcomplicating the routine.";
  }
  return "Adds a focused support step without replacing the basics: cleanser, moisturizer, and sunscreen.";
}

function timelineFor(category: string, concern = "", language: Language = "en") {
  if (language === "ar") {
    if (/acne|oily|blackhead|pores/i.test(expandSearchText(concern)) && /cleanser|moisturizer|serum|exfoliant/i.test(category)) {
      return "قد يتحسن مظهر الدهون والملمس خلال 2-3 أسابيع، بينما قد تحتاج الحبوب والآثار وقتاً أطول.";
    }
    if (/sunscreen/i.test(category)) return "تبدأ الحماية مع الاستخدام اليومي الصحيح، وتحسن مظهر اللون يحتاج أسابيع من الاستمرارية.";
    if (/cleanser|bundle|hydration|moistur/i.test(category)) return "قد يتحسن الإحساس بالراحة خلال أيام، بينما تظهر فوائد الروتين عادة خلال 2-4 أسابيع.";
    if (/serum|treatment/i.test(category)) return "معظم تغييرات اللون والملمس التجميلية تحتاج استخداماً ثابتاً لمدة 4-8 أسابيع.";
    return "استخدمه باستمرار لمدة 2-6 أسابيع مع اختبار الحساسية وإدخال منتج واحد في كل مرة.";
  }
  if (/acne|oily|blackhead|pores/i.test(concern) && /cleanser|moisturizer|serum|exfoliant/i.test(category)) {
    return "Oil balance and smoother feel may improve in 2-3 weeks; breakouts and marks can take longer.";
  }
  if (/sunscreen/i.test(category)) return "Protection starts with correct daily use; tone benefits depend on consistent use over weeks.";
  if (/cleanser|bundle|hydration/i.test(category)) return "Comfort can feel better within days; visible routine benefits usually take 2-4 weeks.";
  if (/serum|treatment/i.test(category)) return "Most cosmetic tone and texture changes need steady use for 4-8 weeks.";
  return "Use consistently for 2-6 weeks while patch testing and introducing one product at a time.";
}

function fallbackProductImage(product: LiveConsultationProduct) {
  const text = `${product.category} ${product.name}`.toLowerCase();
  if (/sunscreen|spf/.test(text)) {
    return "https://images.unsplash.com/photo-1596755389378-c31d21fd1273?auto=format&fit=crop&w=700&q=80";
  }
  if (/cleanser|acne|bha|salicylic/.test(text)) {
    return "https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=700&q=80";
  }
  if (/serum|glow|spot|tone/.test(text)) {
    return "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&w=700&q=80";
  }
  return "https://images.unsplash.com/photo-1611930022073-b7a4ba5fcccd?auto=format&fit=crop&w=700&q=80";
}

function split(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

