"use client";

import "./concierge-home.css";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, Globe, MessageCircle, Mic, Search, Sparkles } from "lucide-react";

type Lang = "en" | "ar";

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  onresult: (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onerror: () => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const WHATSAPP = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;

const COPY = {
  en: {
    dir: "ltr" as const,
    announce: "Glow goal? Build your routine in 60 seconds.",
    announceCta: "Start my routine",
    brandSub: "AI skin concierge",
    nav: [
      { label: "Skin advisor", href: "/live-consultation-1" },
      { label: "Ingredients", href: "/dictionary" },
      { label: "FAQ", href: "/faq" },
      { label: "For brands", href: "/pricing" },
    ],
    kicker: "AI Skin Concierge",
    heroTitle: "Tell me your skin goal.",
    heroLead:
      "Tap the mic or type — I'll build a conservative, OTC-safe routine with products matched to you, in seconds.",
    trySaying: "Try saying",
    examples: [
      "dark spots and dull skin",
      "acne-safe sunscreen and moisturizer",
      "a simple glow routine under AED 200",
      "barrier repair for sensitive skin",
      "hair fall and dandruff",
    ],
    placeholder: "Or type your skin or hair concern…",
    start: "Get my routine",
    listening: "Listening… say your skin concern",
    micHint: "Voice isn't supported on this browser — just type below.",
    pills: ["10,000+ routines built", "OTC-safe guidance", "Bilingual EN / عربي"],
    disclaimer: "OTC cosmetic guidance only — not a diagnosis or a substitute for medical care.",
    whatsapp: "WhatsApp us",
    langSwitch: "العربية",
  },
  ar: {
    dir: "rtl" as const,
    announce: "هدف إشراق؟ ابنِ روتينك في ٦٠ ثانية.",
    announceCta: "ابدأ روتيني",
    brandSub: "مستشار البشرة الذكي",
    nav: [
      { label: "مستشار البشرة", href: "/live-consultation-1" },
      { label: "المكوّنات", href: "/dictionary" },
      { label: "الأسئلة", href: "/faq" },
      { label: "للعلامات التجارية", href: "/pricing" },
    ],
    kicker: "مستشار البشرة الذكي",
    heroTitle: "أخبرني بهدف بشرتك.",
    heroLead:
      "اضغط على الميكروفون أو اكتب — سأبني روتيناً آمناً بدون وصفة مع منتجات مناسبة لك خلال ثوانٍ.",
    trySaying: "جرّب أن تقول",
    examples: [
      "بقع داكنة وبشرة باهتة",
      "واقي شمس ومرطّب مناسب لحب الشباب",
      "روتين إشراق بسيط بأقل من ٢٠٠ درهم",
      "إصلاح حاجز البشرة الحساسة",
      "تساقط الشعر والقشرة",
    ],
    placeholder: "أو اكتب مشكلة بشرتك أو شعرك…",
    start: "احصل على روتيني",
    listening: "أستمع… قل مشكلة بشرتك",
    micHint: "الصوت غير مدعوم في هذا المتصفح — اكتب بالأسفل.",
    pills: ["أكثر من ١٠٬٠٠٠ روتين", "إرشاد آمن بدون وصفة", "بالعربية والإنجليزية"],
    disclaimer: "إرشاد تجميلي بدون وصفة فقط — ليس تشخيصاً ولا بديلاً عن الرعاية الطبية.",
    whatsapp: "راسلنا واتساب",
    langSwitch: "English",
  },
};

export function ConciergeHome() {
  const router = useRouter();
  const [lang, setLang] = useState<Lang>("en");
  const [query, setQuery] = useState("");
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(true);
  const [exampleIdx, setExampleIdx] = useState(0);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const c = COPY[lang];

  useEffect(() => {
    if (typeof navigator !== "undefined" && /^ar/i.test(navigator.language)) setLang("ar");
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setExampleIdx((i) => (i + 1) % COPY.en.examples.length), 2600);
    return () => window.clearInterval(id);
  }, []);

  function go(text: string) {
    const q = text.trim();
    router.push(q ? `/live-consultation-1?q=${encodeURIComponent(q)}` : "/live-consultation-1");
  }

  function toggleMic() {
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    const w = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      setVoiceSupported(false);
      return;
    }
    const rec = new Ctor();
    rec.lang = lang === "ar" ? "ar-AE" : "en-US";
    rec.interimResults = false;
    rec.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript ?? "";
      setListening(false);
      if (transcript) {
        setQuery(transcript);
        go(transcript);
      }
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  }

  return (
    <main className="cg" dir={c.dir} lang={lang}>
      <div className="cg-announce">
        <span className="cg-announce-left">
          <AlertCircle size={15} />
          {c.announce}
        </span>
        <span className="cg-announce-right">
          {WHATSAPP ? (
            <a href={`https://wa.me/${WHATSAPP}`} target="_blank" rel="noreferrer">
              <MessageCircle size={15} />
              <span className="cg-hide-sm">{c.whatsapp}</span>
            </a>
          ) : null}
          <a className="cg-book" href="/live-consultation-1">
            {c.announceCta}
            <ArrowRight size={15} />
          </a>
        </span>
      </div>

      <header className="cg-header">
        <Link className="cg-brand" href="/">
          <span className="cg-brand-mark">ADG</span>
          <span className="cg-brand-text">
            <span className="cg-brand-name">AI Derma Guru</span>
            <span className="cg-brand-sub">{c.brandSub}</span>
          </span>
        </Link>
        <nav className="cg-nav" aria-label="Primary">
          {c.nav.map((item) => (
            <Link key={item.label} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="cg-header-right">
          <button
            type="button"
            className="cg-lang"
            onClick={() => setLang((l) => (l === "en" ? "ar" : "en"))}
            aria-label="Switch language"
          >
            <Globe size={15} />
            {c.langSwitch}
          </button>
        </div>
      </header>

      <section className="cg-hero">
        <p className="cg-kicker">
          <Sparkles size={15} />
          {c.kicker}
        </p>
        <h1 className="cg-title">{c.heroTitle}</h1>
        <p className="cg-lead">{c.heroLead}</p>

        <div className="cg-orb-wrap">
          <div className={`cg-orb${listening ? " listening" : ""}`} aria-hidden="true" />
          <button
            type="button"
            className={`cg-mic${listening ? " listening" : ""}`}
            onClick={toggleMic}
            aria-label={listening ? "Stop voice input" : "Start voice input"}
          >
            <Mic />
          </button>
        </div>
        <p className="cg-listening">{listening ? c.listening : ""}</p>

        <div className="cg-try">
          <span>{c.trySaying}</span>
          <button type="button" className="cg-try-chip" onClick={() => go(c.examples[exampleIdx])}>
            &ldquo;{c.examples[exampleIdx]}&rdquo;
          </button>
        </div>

        <form
          className="cg-input"
          onSubmit={(event) => {
            event.preventDefault();
            go(query);
          }}
        >
          <Search className="cg-search" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={c.placeholder}
            aria-label={c.placeholder}
          />
          <button type="submit">
            {c.start}
            <ArrowRight size={17} />
          </button>
        </form>

        {!voiceSupported ? <p className="cg-hint">{c.micHint}</p> : null}

        <div className="cg-pills">
          {c.pills.map((pill) => (
            <span key={pill}>{pill}</span>
          ))}
        </div>
        <p className="cg-disclaimer">{c.disclaimer}</p>
      </section>

      {WHATSAPP ? (
        <a className="cg-wa" href={`https://wa.me/${WHATSAPP}`} target="_blank" rel="noreferrer" aria-label="WhatsApp">
          <MessageCircle />
        </a>
      ) : null}
    </main>
  );
}
