"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Heart, Loader2, Mic, ShoppingCart, Square } from "lucide-react";
import { createOrbAudio, type OrbAudio } from "./voice-orb-audio";
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
  onresult: (event: {
    resultIndex: number;
    results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
  }) => void;
  onerror: (event: { error?: string }) => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const GREETING = {
  en: "Hi — I'm your skin advisor. Tell me what's bothering your skin or hair.",
  ar: "مرحباً — أنا مستشار البشرة. أخبرني ما الذي يزعج بشرتك أو شعرك.",
};

const UI = {
  en: {
    start: "Tap to speak",
    stop: "Stop",
    listening: "Listening",
    thinking: "Thinking",
    speaking: "Speaking",
    you: "You",
    agent: "Advisor",
    noVoice: "Voice isn't supported in this browser. Try Chrome or Safari, or use the text advisor.",
    denied: "I couldn't access the microphone. Allow mic permission, or use the text advisor.",
    save: "Save",
    saved: "Saved",
    cart: "Add routine to cart",
    view: "View",
    sponsored: "Sponsored",
    replay: "Tap to answer",
    fallback: "Open the full advisor",
    error: "Something went wrong. Tap the mic to try again.",
  },
  ar: {
    start: "اضغط للتحدث",
    stop: "إيقاف",
    listening: "أستمع",
    thinking: "أفكر",
    speaking: "أتحدث",
    you: "أنت",
    agent: "المستشار",
    noVoice: "الصوت غير مدعوم في هذا المتصفح. جرّب Chrome أو Safari أو استخدم المستشار الكتابي.",
    denied: "تعذّر الوصول إلى الميكروفون. امنح الإذن أو استخدم المستشار الكتابي.",
    save: "حفظ",
    saved: "محفوظ",
    cart: "أضف الروتين إلى السلة",
    view: "عرض",
    sponsored: "مموَّل",
    replay: "اضغط للإجابة",
    fallback: "افتح المستشار الكامل",
    error: "حدث خطأ. اضغط الميكروفون للمحاولة مرة أخرى.",
  },
};

/** Browsers default to their flattest voice; prefer the neural/cloud ones. */
function pickVoice(synth: SpeechSynthesis, lang: Lang): SpeechSynthesisVoice | null {
  const voices = synth.getVoices();
  if (!voices.length) return null;
  const candidates = voices.filter((v) => v.lang?.toLowerCase().startsWith(lang === "ar" ? "ar" : "en"));
  if (!candidates.length) return null;
  for (const pattern of [/natural/i, /neural/i, /google/i, /premium|enhanced/i, /samantha|serena|aria/i]) {
    const match = candidates.find((v) => pattern.test(v.name));
    if (match) return match;
  }
  return candidates.find((v) => !/compact/i.test(v.name)) ?? candidates[0];
}

export function VoiceAgent({ initialLang = "en" }: { initialLang?: Lang }) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [phase, setPhase] = useState<Phase>("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [interim, setInterim] = useState("");
  const [products, setProducts] = useState<AgentProduct[]>([]);
  const [wishlist, setWishlist] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  const slotsRef = useRef<Record<string, unknown>>({});
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const orbRef = useRef<OrbAudio | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const continueRef = useRef(false);
  const t = UI[lang];

  // Drive --level from real audio every frame.
  useEffect(() => {
    const tick = () => {
      const orb = orbRef.current;
      const stage = stageRef.current;
      if (orb && stage) stage.style.setProperty("--level", orb.level().toFixed(3));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("ai-derma-wishlist");
      if (saved) setWishlist(JSON.parse(saved));
    } catch {
      // wishlist is a convenience
    }
    return () => {
      continueRef.current = false;
      recognitionRef.current?.abort();
      window.speechSynthesis?.cancel();
      audioElRef.current?.pause();
      orbRef.current?.dispose();
    };
  }, []);

  const speakWithBrowser = useCallback(
    (text: string, onDone: () => void) => {
      const synth = window.speechSynthesis;
      if (!synth) {
        onDone();
        return;
      }
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang === "ar" ? "ar-SA" : "en-US";
      const voice = pickVoice(synth, lang);
      if (voice) utterance.voice = voice;
      utterance.rate = 0.97;
      utterance.onend = onDone;
      utterance.onerror = onDone;
      setPhase("speaking");
      synth.speak(utterance);
    },
    [lang],
  );

  /** Natural OpenAI voice when configured; browser voice otherwise. */
  const speak = useCallback(
    async (text: string, onDone: () => void) => {
      if (!text.trim()) {
        onDone();
        return;
      }
      window.speechSynthesis?.cancel();
      audioElRef.current?.pause();
      setPhase("speaking");

      try {
        const response = await fetch("/api/voice-agent/speech", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text, language: lang }),
        });
        if (!response.ok) throw new Error("no natural voice");

        const url = URL.createObjectURL(await response.blob());
        let audio = audioElRef.current;
        if (!audio) {
          audio = new Audio();
          audio.crossOrigin = "anonymous";
          audioElRef.current = audio;
        }
        audio.src = url;
        // Route through the analyser so the orb pulses with the agent's voice.
        orbRef.current?.attachElement(audio);
        const finish = () => {
          URL.revokeObjectURL(url);
          onDone();
        };
        audio.onended = finish;
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          speakWithBrowser(text, onDone);
        };
        await audio.play();
      } catch {
        speakWithBrowser(text, onDone);
      }
    },
    [lang, speakWithBrowser],
  );

  const send = useCallback(
    async (utterance: string) => {
      setPhase("thinking");
      setInterim("");
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
        const keepGoing = payload.phase === "asking" && continueRef.current;
        void speak(reply, () => (keepGoing ? listen() : setPhase("idle")));
      } catch {
        setNotice(t.error);
        setPhase("idle");
      }
    },
    // eslint-disable-next-line
    [lang, speak, t.error],
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
    recognition.interimResults = true; // live words as the shopper speaks
    recognition.continuous = false;

    recognition.onresult = (event) => {
      let live = "";
      let settled = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) settled += text;
        else live += text;
      }
      setInterim(live);
      if (settled.trim()) void send(settled.trim());
    };
    recognition.onerror = (event) => {
      if (event?.error === "not-allowed" || event?.error === "service-not-allowed") {
        setNotice(t.denied);
        continueRef.current = false;
      }
      setPhase("idle");
    };
    recognition.onend = () => setPhase((current) => (current === "listening" ? "idle" : current));

    recognitionRef.current = recognition;
    setPhase("listening");
    setNotice(null);
    orbRef.current?.cue();
    void orbRef.current?.attachMic();
    try {
      recognition.start();
    } catch {
      setPhase("idle");
    }
  }, [lang, send, t.noVoice, t.denied]);

  function begin() {
    // Must be created inside the tap gesture or browsers keep audio suspended.
    if (!orbRef.current) orbRef.current = createOrbAudio();
    orbRef.current.startHum();
    continueRef.current = true;
    setStarted(true);
    setNotice(null);

    // Greet instantly and locally — no round trip before the first word.
    const greeting = GREETING[lang];
    setTurns([{ role: "agent", text: greeting }]);
    void speak(greeting, () => listen());
  }

  function stop() {
    continueRef.current = false;
    recognitionRef.current?.abort();
    window.speechSynthesis?.cancel();
    audioElRef.current?.pause();
    orbRef.current?.detachMic();
    orbRef.current?.stopHum();
    setInterim("");
    setPhase("idle");
  }

  function toggleWishlist(id: string) {
    setWishlist((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      try {
        window.localStorage.setItem("ai-derma-wishlist", JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  function cartUrl(items: AgentProduct[]) {
    const payload = items.map((p) => ({ id: p.id, name: p.name, url: p.url }));
    return `/api/cart/cicabelle?items=${encodeURIComponent(JSON.stringify(payload))}`;
  }

  const busy = phase === "thinking";
  const active = phase !== "idle";
  const statusLabel =
    phase === "listening" ? t.listening : phase === "thinking" ? t.thinking : phase === "speaking" ? t.speaking : started ? t.replay : t.start;

  return (
    <div className={`va va-${phase}${lang === "ar" ? " va-rtl" : ""}`} dir={lang === "ar" ? "rtl" : "ltr"}>
      <div className="va-stage" ref={stageRef}>
        <div className="va-bloom" aria-hidden="true" />
        <div className="va-halo" aria-hidden="true" />
        <div className="va-field" aria-hidden="true" />
        <div className="va-field va-field-2" aria-hidden="true" />
        <div className="va-ring" aria-hidden="true" />
        <div className="va-ring va-ring-2" aria-hidden="true" />
        <div className="va-ripple" aria-hidden="true" />
        <button
          type="button"
          className="va-mic"
          onClick={() => (active ? stop() : started ? listen() : begin())}
          aria-label={active ? t.stop : t.start}
        >
          {busy ? <Loader2 className="va-spin-icon" size={30} /> : active ? <Square size={26} /> : <Mic size={30} />}
        </button>
      </div>

      <p className="va-status" aria-live="polite">{statusLabel}</p>
      <p className="va-interim">{interim ? <span>{interim}</span> : null}</p>

      {notice ? (
        <p className="va-notice">
          {notice} <a href="/live-consultation-1">{t.fallback}</a>
        </p>
      ) : null}

      {turns.length ? (
        <div className="va-transcript">
          {turns.slice(-6).map((turn, index) => (
            <p key={`${turn.role}-${index}-${turn.text.slice(0, 12)}`} className={`va-turn va-turn-${turn.role}`}>
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
