"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Heart, Loader2, Mic, ShoppingCart, Square } from "lucide-react";
import "./voice-agent.css";

type Lang = "en" | "ar";
type Phase = "idle" | "listening" | "thinking" | "speaking";

type AgentProduct = {
  id: string;
  name: string;
  brand: string;
  category: string;
  price: number;
  currency: string;
  imageUrl: string | null;
  url: string;
  slot: string;
  reason: string;
  sponsored?: boolean;
};

type Turn = { role: "user" | "agent"; text: string };

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onerror: (event: { error?: string }) => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/**
 * Browsers ship several voices and default to the flattest one. Prefer the
 * neural/cloud voices (Google, Microsoft "Natural", Apple's premium set) so the
 * advisor doesn't sound like a 1990s screen reader.
 */
function pickVoice(synth: SpeechSynthesis, lang: Lang): SpeechSynthesisVoice | null {
  const voices = synth.getVoices();
  if (!voices.length) return null;
  const prefix = lang === "ar" ? "ar" : "en";
  const candidates = voices.filter((voice) => voice.lang?.toLowerCase().startsWith(prefix));
  if (!candidates.length) return null;

  const preferred = [/natural/i, /neural/i, /google/i, /premium|enhanced/i, /samantha|serena|zira|aria/i];
  for (const pattern of preferred) {
    const match = candidates.find((voice) => pattern.test(voice.name));
    if (match) return match;
  }
  return candidates.find((voice) => !/compact/i.test(voice.name)) ?? candidates[0];
}

const UI = {
  en: {
    start: "Tap to speak",
    stop: "Stop",
    listening: "Listening…",
    thinking: "Thinking…",
    speaking: "Speaking…",
    you: "You",
    agent: "Advisor",
    noVoice: "Voice input isn't supported in this browser. Try Chrome, or use the text advisor.",
    denied: "I couldn't access the microphone. Allow mic permission, or use the text advisor.",
    save: "Save",
    saved: "Saved",
    cart: "Add to cart",
    view: "View",
    sponsored: "Sponsored",
    replay: "Tap the mic to answer",
    fallback: "Open the full advisor",
    error: "Something went wrong. Tap the mic to try again.",
  },
  ar: {
    start: "اضغط للتحدث",
    stop: "إيقاف",
    listening: "أستمع…",
    thinking: "أفكر…",
    speaking: "أتحدث…",
    you: "أنت",
    agent: "المستشار",
    noVoice: "الإدخال الصوتي غير مدعوم في هذا المتصفح. جرّب Chrome أو استخدم المستشار الكتابي.",
    denied: "تعذّر الوصول إلى الميكروفون. امنح الإذن أو استخدم المستشار الكتابي.",
    save: "حفظ",
    saved: "محفوظ",
    cart: "أضف إلى السلة",
    view: "عرض",
    sponsored: "مموَّل",
    replay: "اضغط الميكروفون للإجابة",
    fallback: "افتح المستشار الكامل",
    error: "حدث خطأ. اضغط الميكروفون للمحاولة مرة أخرى.",
  },
};

export function VoiceAgent({ initialLang = "en" }: { initialLang?: Lang }) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [phase, setPhase] = useState<Phase>("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [products, setProducts] = useState<AgentProduct[]>([]);
  const [wishlist, setWishlist] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  const slotsRef = useRef<Record<string, unknown>>({});
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const shouldContinueRef = useRef(false);
  const t = UI[lang];

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("ai-derma-wishlist");
      if (saved) setWishlist(JSON.parse(saved));
    } catch {
      // wishlist is a convenience; ignore storage failures
    }
    return () => {
      shouldContinueRef.current = false;
      recognitionRef.current?.abort();
      window.speechSynthesis?.cancel();
      audioRef.current?.pause();
    };
  }, []);

  /** Browser speech: always available, noticeably robotic. */
  const speakWithBrowser = useCallback(
    (text: string, onDone: () => void) => {
      const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
      if (!synth) {
        onDone();
        return;
      }
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang === "ar" ? "ar-SA" : "en-US";
      const voice = pickVoice(synth, lang);
      if (voice) utterance.voice = voice;
      // Slightly under natural pace reads as considered rather than clipped.
      utterance.rate = 0.97;
      utterance.pitch = 1;
      utterance.onend = onDone;
      utterance.onerror = onDone;
      setPhase("speaking");
      synth.speak(utterance);
    },
    [lang],
  );

  /**
   * Prefer the natural OpenAI voice; fall back to the browser voice whenever it
   * is unavailable (no API key, offline, upstream error) so the agent never
   * goes silent.
   */
  const speak = useCallback(
    async (text: string, onDone: () => void) => {
      if (!text.trim()) {
        onDone();
        return;
      }
      window.speechSynthesis?.cancel();
      audioRef.current?.pause();

      try {
        const response = await fetch("/api/voice-agent/speech", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text, language: lang }),
        });
        if (!response.ok) throw new Error("no natural voice");

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        const finish = () => {
          URL.revokeObjectURL(url);
          onDone();
        };
        audio.onended = finish;
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          speakWithBrowser(text, onDone);
        };
        setPhase("speaking");
        await audio.play();
      } catch {
        speakWithBrowser(text, onDone);
      }
    },
    [lang, speakWithBrowser],
  );

  const listen = useCallback(() => {
    const w = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      setNotice(t.noVoice);
      setPhase("idle");
      return;
    }

    const recognition = new Ctor();
    recognition.lang = lang === "ar" ? "ar-AE" : "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript ?? "";
      if (transcript.trim()) void send(transcript.trim());
    };
    recognition.onerror = (event) => {
      if (event?.error === "not-allowed" || event?.error === "service-not-allowed") {
        setNotice(t.denied);
        shouldContinueRef.current = false;
      }
      setPhase("idle");
    };
    recognition.onend = () => {
      setPhase((current) => (current === "listening" ? "idle" : current));
    };
    recognitionRef.current = recognition;
    setPhase("listening");
    setNotice(null);
    try {
      recognition.start();
    } catch {
      setPhase("idle");
    }
    // send is stable for our purposes; declared below
    // eslint-disable-next-line
  }, [lang, t.noVoice, t.denied]);

  const send = useCallback(
    async (utterance: string) => {
      setPhase("thinking");
      if (utterance) setTurns((current) => [...current, { role: "user", text: utterance }]);

      try {
        const response = await fetch("/api/voice-agent", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ utterance, slots: slotsRef.current, language: lang }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error ?? "agent error");

        slotsRef.current = payload.slots ?? slotsRef.current;
        if (payload.language && payload.language !== lang) setLang(payload.language as Lang);
        if (Array.isArray(payload.products) && payload.products.length) setProducts(payload.products);

        const reply: string = payload.reply ?? "";
        setTurns((current) => [...current, { role: "agent", text: reply }]);

        const keepGoing = payload.phase === "asking" && shouldContinueRef.current;
        void speak(reply, () => {
          if (keepGoing) listen();
          else setPhase("idle");
        });
      } catch {
        setNotice(t.error);
        setPhase("idle");
      }
    },
    [lang, speak, listen, t.error],
  );

  function begin() {
    shouldContinueRef.current = true;
    setStarted(true);
    setNotice(null);
    void send("");
  }

  function stop() {
    shouldContinueRef.current = false;
    recognitionRef.current?.abort();
    window.speechSynthesis?.cancel();
    audioRef.current?.pause();
    setPhase("idle");
  }

  function toggleWishlist(id: string) {
    setWishlist((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      try {
        window.localStorage.setItem("ai-derma-wishlist", JSON.stringify(next));
      } catch {
        // ignore storage failures
      }
      return next;
    });
  }

  function cartUrl(items: AgentProduct[]) {
    const payload = items.map((product) => ({ id: product.id, name: product.name, url: product.url }));
    return `/api/cart/cicabelle?items=${encodeURIComponent(JSON.stringify(payload))}`;
  }

  const busy = phase === "thinking";
  const active = phase === "listening" || phase === "speaking" || busy;

  return (
    <div className={`va${lang === "ar" ? " va-rtl" : ""}`} dir={lang === "ar" ? "rtl" : "ltr"}>
      <div className="va-stage">
        <div className={`va-orb va-orb-${phase}`} aria-hidden="true" />
        <button
          type="button"
          className={`va-mic va-mic-${phase}`}
          onClick={() => (active ? stop() : started ? listen() : begin())}
          aria-label={active ? UI[lang].stop : UI[lang].start}
        >
          {busy ? <Loader2 className="va-spin" size={30} /> : active ? <Square size={26} /> : <Mic size={30} />}
        </button>
      </div>

      <p className="va-status" aria-live="polite">
        {phase === "listening"
          ? t.listening
          : phase === "thinking"
            ? t.thinking
            : phase === "speaking"
              ? t.speaking
              : started
                ? t.replay
                : t.start}
      </p>

      {notice ? (
        <p className="va-notice">
          {notice}{" "}
          <a href="/live-consultation-1">{t.fallback}</a>
        </p>
      ) : null}

      {turns.length ? (
        <div className="va-transcript">
          {turns.slice(-6).map((turn, index) => (
            <p key={`${turn.role}-${index}`} className={`va-turn va-turn-${turn.role}`}>
              <span>{turn.role === "user" ? t.you : t.agent}</span>
              {turn.text}
            </p>
          ))}
        </div>
      ) : null}

      {products.length ? (
        <div className="va-products">
          {products.map((product) => (
            <article className="va-card" key={product.id}>
              {product.imageUrl ? <img src={product.imageUrl} alt={product.name} /> : <div className="va-card-noimg" />}
              <div className="va-card-body">
                <span className="va-slot">{product.slot}</span>
                {product.sponsored ? <span className="va-sponsored">{t.sponsored}</span> : null}
                <strong>{product.name}</strong>
                <p>{product.reason}</p>
                <span className="va-price">
                  {product.currency} {product.price}
                </span>
                <div className="va-actions">
                  <button
                    type="button"
                    className={wishlist.includes(product.id) ? "va-save va-saved" : "va-save"}
                    onClick={() => toggleWishlist(product.id)}
                  >
                    <Heart size={14} fill={wishlist.includes(product.id) ? "currentColor" : "none"} />
                    {wishlist.includes(product.id) ? t.saved : t.save}
                  </button>
                  <a className="va-view" href={product.url} target="_blank" rel="noreferrer">
                    {t.view}
                    <ExternalLink size={13} />
                  </a>
                </div>
              </div>
            </article>
          ))}
          <a className="va-cart-all" href={cartUrl(products)} target="_blank" rel="noreferrer">
            <ShoppingCart size={16} />
            {t.cart}
          </a>
        </div>
      ) : null}
    </div>
  );
}
