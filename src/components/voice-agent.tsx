"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ExternalLink, Heart, Loader2, MessageSquare, Mic, Send, ShoppingCart, Sparkles, Square } from "lucide-react";
import { createOrbAudio, type OrbAudio } from "./voice-orb-audio";
import { speechLocale } from "@/services/language";
import { scriptedLines } from "@/services/voice-agent";
import "./voice-agent.css";

/** GET endpoint for a fixed line, so <audio> streams it from the browser cache. */
function speechUrl(text: string, language: string) {
  return `/api/voice-agent/speech?lang=${language === "ar" ? "ar" : "en"}&text=${encodeURIComponent(text)}`;
}

/** Roughly 30s of silence before the advisor stops listening and waits for a tap. */
const MAX_SILENT_RESTARTS = 4;

/** Every line the interview can say verbatim — these are the ones worth caching. */
const SCRIPTED = new Set([...scriptedLines("en"), ...scriptedLines("ar")]);
function isScriptedLine(text: string) {
  return SCRIPTED.has(text.trim());
}

type Lang = "en" | "ar";
type Mode = "voice" | "chat";
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
  step?: string;
  slot: string;
  reason: string;
  cautions?: string[];
  sponsored?: boolean;
};

type Turn = { role: "user" | "agent"; text: string };

/** Routine buckets, in the order a shopper actually uses them. */
const ROUTINE_ORDER = ["am", "daily", "pm", "optional"] as const;
type RoutineBucket = (typeof ROUTINE_ORDER)[number];

/**
 * When a shopper uses each step. Keyed on the routine step rather than its
 * label, so rewording a label cannot silently drop a product out of the panel.
 */
const STEP_BUCKETS: Record<string, RoutineBucket> = {
  sunscreen: "am",
  treatment: "pm",
  eye: "pm",
  exfoliant: "optional",
  mask: "optional",
};

function bucketFor(item: Pick<AgentProduct, "step" | "slot">): RoutineBucket {
  if (item.step) return STEP_BUCKETS[item.step] ?? "daily";
  const name = item.slot.toLowerCase();
  if (name.startsWith("optional") || name.includes("exfoliant") || name.includes("mask")) return "optional";
  if (name.startsWith("morning") || name.includes("sunscreen")) return "am";
  if (name.startsWith("evening") || name.includes("treatment")) return "pm";
  return "daily";
}

/** Groups the routine for the side panel, dropping any bucket with nothing in it. */
function groupRoutine(items: AgentProduct[]) {
  return ROUTINE_ORDER.map((bucket) => ({
    bucket,
    items: items.filter((item) => bucketFor(item) === bucket),
  })).filter((group) => group.items.length > 0);
}

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

// One source of truth with the server, so the greeting the client speaks is the
// same string it prewarmed — and the same one the API would have sent.
const GREETING = {
  en: scriptedLines("en")[0],
  ar: scriptedLines("ar")[0],
};

const PROMPTS = {
  en: [
    "I have dark spots and dull skin",
    "acne-safe sunscreen and moisturiser",
    "a simple glow routine under AED 200",
    "barrier repair for sensitive skin",
    "dandruff and an itchy scalp",
  ],
  ar: [
    "عندي بقع داكنة وبشرة باهتة",
    "واقي شمس مناسب لحب الشباب",
    "روتين إشراق بسيط بأقل من ٢٠٠ درهم",
    "إصلاح حاجز البشرة الحساسة",
    "قشرة وحكة في فروة الرأس",
  ],
};

const UI = {
  en: {
    voiceMode: "Voice",
    chatMode: "Chat",
    trySaying: "Try saying",
    typeHere: "Type your skin or hair concern…",
    send: "Send",
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
    replay: "Tap when you're ready",
    fallback: "Open the full advisor",
    error: "Something went wrong. Tap the mic to try again.",
    showSkin: "Show your skin",
    cameraTitle: "Let the advisor look at your skin?",
    cameraBody:
      "Your camera opens on this device. The photo is reviewed once and immediately discarded — it is never saved, never stored, and never attached to your details. Cosmetic observations only; this is not a diagnosis.",
    cameraAllow: "Open camera",
    cameraCancel: "Not now",
    cameraCapture: "Capture",
    cameraShared: "(shared a photo of my skin)",
    cameraSaw: "From the photo I can see",
    cameraRefer:
      "I'd rather not comment on that from a photo — it's worth having a pharmacist or clinician take a look in person. I can still help with general routine questions.",
    cameraUnusable: "I couldn't read that clearly. Try better light and hold steady.",
    cameraDenied: "I couldn't open the camera. Allow camera access, or just describe your skin.",
    cameraError: "The photo review didn't work. You can describe your skin instead.",
    liveTranscript: "Live transcript",
    quickPicks: "Common concerns",
    yourRoutine: "Your routine",
    steps: (n: number) => (n === 1 ? "1 step" : `${n} steps`),
    routine: { am: "Morning", daily: "Daily", pm: "Evening", optional: "As needed" },
    startOver: "Start a new routine",
  },
  ar: {
    voiceMode: "صوت",
    chatMode: "محادثة",
    trySaying: "جرّب أن تقول",
    typeHere: "اكتب مشكلة بشرتك أو شعرك…",
    send: "إرسال",
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
    replay: "اضغط عندما تكون جاهزاً",
    fallback: "افتح المستشار الكامل",
    error: "حدث خطأ. اضغط الميكروفون للمحاولة مرة أخرى.",
    showSkin: "أرِ بشرتك",
    cameraTitle: "هل تسمح للمستشار برؤية بشرتك؟",
    cameraBody:
      "تُفتح الكاميرا على جهازك. تتم مراجعة الصورة مرة واحدة ثم تُحذف فوراً — لا تُحفظ ولا تُخزَّن ولا تُربط ببياناتك. ملاحظات تجميلية فقط، وليست تشخيصاً.",
    cameraAllow: "افتح الكاميرا",
    cameraCancel: "ليس الآن",
    cameraCapture: "التقط",
    cameraShared: "(شاركت صورة لبشرتي)",
    cameraSaw: "من الصورة ألاحظ",
    cameraRefer:
      "أفضّل ألا أعلّق على ذلك من صورة — يستحسن أن يراه صيدلي أو مختص شخصياً. ما زال بإمكاني مساعدتك في أسئلة الروتين العامة.",
    cameraUnusable: "لم أتمكن من رؤية الصورة بوضوح. جرّب إضاءة أفضل وثبّت الكاميرا.",
    cameraDenied: "تعذّر فتح الكاميرا. اسمح بالوصول أو صف بشرتك بالكلمات.",
    cameraError: "لم تنجح مراجعة الصورة. يمكنك وصف بشرتك بدلاً من ذلك.",
    liveTranscript: "النص المباشر",
    quickPicks: "مشاكل شائعة",
    yourRoutine: "روتينك",
    steps: (n: number) => (n === 1 ? "خطوة واحدة" : `${n} خطوات`),
    routine: { am: "صباحاً", daily: "يومياً", pm: "مساءً", optional: "عند الحاجة" },
    startOver: "ابدأ روتيناً جديداً",
  },
};

/** Browsers default to their flattest voice; prefer the neural/cloud ones. */
function pickVoice(synth: SpeechSynthesis, code: string): SpeechSynthesisVoice | null {
  const voices = synth.getVoices();
  if (!voices.length) return null;
  const prefix = code.slice(0, 2).toLowerCase();
  const candidates = voices.filter((v) => v.lang?.toLowerCase().startsWith(prefix));
  if (!candidates.length) return null;
  for (const pattern of [/natural/i, /neural/i, /google/i, /premium|enhanced/i, /samantha|serena|aria/i]) {
    const match = candidates.find((v) => pattern.test(v.name));
    if (match) return match;
  }
  return candidates.find((v) => !/compact/i.test(v.name)) ?? candidates[0];
}

export function VoiceAgent({
  initialLang = "en",
  variant = "full",
}: {
  initialLang?: Lang;
  /** "full" is the shopper product; "compact" is the homepage demo. */
  variant?: "full" | "compact";
}) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [mode, setMode] = useState<Mode>("voice");
  const [phase, setPhase] = useState<Phase>("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [interim, setInterim] = useState("");
  const [draft, setDraft] = useState("");
  const [products, setProducts] = useState<AgentProduct[]>([]);
  const [disclosure, setDisclosure] = useState<string | null>(null);
  const [wishlist, setWishlist] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [promptIndex, setPromptIndex] = useState(0);

  const [camera, setCamera] = useState<"off" | "consent" | "live" | "reviewing">("off");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

  const slotsRef = useRef<Record<string, unknown>>({});
  const modeRef = useRef<Mode>("voice");
  // The language actually spoken (may be neither English nor Arabic); the UI
  // chrome stays EN/AR while speech + recognition follow the shopper.
  const spokenLangRef = useRef<string>(initialLang);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const orbRef = useRef<OrbAudio | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const continueRef = useRef(false);
  // How many times recognition has restarted without hearing anything. A
  // shopper who walked away shouldn't keep the microphone open forever.
  const silentRestartsRef = useRef(0);
  const restartTimerRef = useRef<number | null>(null);
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

  // Keep the newest turn in view inside the panel, never by growing the page.
  useEffect(() => {
    const panel = transcriptRef.current;
    if (panel) panel.scrollTop = panel.scrollHeight;
  }, [turns, interim]);

  // Rotate the example prompts while the shopper hasn't started.
  useEffect(() => {
    if (started) return;
    const id = window.setInterval(() => setPromptIndex((i) => (i + 1) % PROMPTS.en.length), 3200);
    return () => window.clearInterval(id);
  }, [started]);

  // Synthesise the scripted lines before anyone taps. The greeting goes first
  // so the very first word is instant; the interview questions follow a beat
  // later so they don't compete with it for bandwidth. Both the server cache
  // and the browser cache are warm by the time they're needed.
  useEffect(() => {
    const warm = (text: string) =>
      fetch(speechUrl(text, lang), { cache: "force-cache" }).catch(() => {
        // Prewarming is an optimisation; speak() still works without it.
      });

    const [greeting, ...questions] = scriptedLines(lang);
    void warm(greeting);
    const id = window.setTimeout(() => questions.forEach((line) => void warm(line)), 1500);
    return () => window.clearTimeout(id);
  }, [lang]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("ai-derma-wishlist");
      if (saved) setWishlist(JSON.parse(saved));
    } catch {
      // wishlist is a convenience
    }
    return () => {
      continueRef.current = false;
      if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
      recognitionRef.current?.abort();
      window.speechSynthesis?.cancel();
      audioElRef.current?.pause();
      orbRef.current?.dispose();
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
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
      utterance.lang = speechLocale(spokenLangRef.current);
      const voice = pickVoice(synth, spokenLangRef.current);
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

      let audio = audioElRef.current;
      if (!audio) {
        audio = new Audio();
        audio.preload = "auto";
        audioElRef.current = audio;
      }
      // Route through the analyser so the orb pulses with the agent's voice.
      orbRef.current?.attachElement(audio);

      let objectUrl: string | null = null;
      const finish = () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        onDone();
      };

      try {
        if (isScriptedLine(text)) {
          // A scripted line is already in the browser cache, and the element
          // starts playing on the first bytes rather than the last — this is
          // the difference between an instant reply and a second of silence.
          audio.src = speechUrl(text, spokenLangRef.current);
        } else {
          // Anything personalised goes over POST so the shopper's routine never
          // lands in a URL or a request log.
          const response = await fetch("/api/voice-agent/speech", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text, language: spokenLangRef.current }),
          });
          if (!response.ok) throw new Error("no natural voice");
          objectUrl = URL.createObjectURL(await response.blob());
          audio.src = objectUrl;
        }

        audio.onended = finish;
        audio.onerror = () => {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          speakWithBrowser(text, onDone);
        };
        await audio.play();
      } catch {
        speakWithBrowser(text, onDone);
      }
    },
    [lang, speakWithBrowser],
  );

  /**
   * Speaks a reply that arrived in pieces — typically an acknowledgement
   * followed by the next scripted question. The next piece is fetched while the
   * current one plays, so the join sounds like a breath rather than a stall.
   */
  const speakSequence = useCallback(
    (parts: string[], onDone: () => void) => {
      const queue = parts.map((part) => part.trim()).filter(Boolean);
      if (!queue.length) {
        onDone();
        return;
      }
      const step = (index: number) => {
        if (index >= queue.length) {
          onDone();
          return;
        }
        const upcoming = queue[index + 1];
        if (upcoming && isScriptedLine(upcoming)) {
          void fetch(speechUrl(upcoming, spokenLangRef.current), { cache: "force-cache" }).catch(() => {});
        }
        void speak(queue[index], () => step(index + 1));
      };
      step(0);
    },
    [speak],
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
          body: JSON.stringify({ utterance, slots: slotsRef.current, language: spokenLangRef.current }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error ?? "agent error");

        slotsRef.current = payload.slots ?? slotsRef.current;
        if (typeof payload.language === "string" && payload.language) {
          spokenLangRef.current = payload.language;
          // Only the two authored locales drive the interface copy.
          if (payload.language === "ar" || payload.language === "en") setLang(payload.language);
        }
        if (Array.isArray(payload.products) && payload.products.length) {
          setProducts(payload.products);
          setDisclosure(typeof payload.disclosure === "string" ? payload.disclosure : null);
        }

        const reply: string = payload.reply ?? "";
        setTurns((current) => [...current, { role: "agent", text: reply }]);

        // Chat mode stays silent and never grabs the microphone.
        if (modeRef.current === "chat") {
          setPhase("idle");
          return;
        }
        // Keep the microphone open unless safety triage ended the session — the
        // shopper can always ask a follow-up once the routine is on screen.
        const keepGoing = payload.phase !== "referral" && continueRef.current;
        const parts: string[] = Array.isArray(payload.speech) && payload.speech.length ? payload.speech : [reply];
        speakSequence(parts, () => (keepGoing ? listen() : setPhase("idle")));
      } catch {
        setNotice(t.error);
        setPhase("idle");
      }
    },
    // eslint-disable-next-line
    [lang, speakSequence, t.error],
  );

  /**
   * Opens the microphone and keeps it open.
   *
   * Browsers end recognition on every pause — including pauses in the middle of
   * a sentence. Treating that as the end of the shopper's turn is what made the
   * conversation stop dead and demand another tap, so a silent end just starts
   * it again. After a run of restarts with nothing heard we do stand down, so a
   * shopper who walked away isn't left with a live mic.
   */
  const listen = useCallback(
    function startListening() {
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

      if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
      // Detach before aborting, so the replaced session's onend knows it is no
      // longer the live one and doesn't queue a restart of its own.
      const previous = recognitionRef.current;
      recognitionRef.current = null;
      previous?.abort();

      const recognition = new Ctor();
      recognition.lang = speechLocale(spokenLangRef.current);
      recognition.interimResults = true; // live words as the shopper speaks
      recognition.continuous = false;
      let heard = false;

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
        if (live.trim() || settled.trim()) {
          heard = true;
          silentRestartsRef.current = 0;
        }
        if (settled.trim()) {
          // The answer is in; stop before the browser restarts on its own.
          recognitionRef.current = null;
          try {
            recognition.stop();
          } catch {
            // already stopping
          }
          void send(settled.trim());
        }
      };

      recognition.onerror = (event) => {
        if (event?.error === "not-allowed" || event?.error === "service-not-allowed") {
          setNotice(t.denied);
          continueRef.current = false;
          setPhase("idle");
        }
        // "no-speech" and "aborted" are ordinary: onend decides what happens.
      };

      recognition.onend = () => {
        if (recognitionRef.current !== recognition) return; // we ended it on purpose
        recognitionRef.current = null;
        if (!continueRef.current || modeRef.current !== "voice") {
          setPhase((current) => (current === "listening" ? "idle" : current));
          return;
        }
        silentRestartsRef.current = heard ? 0 : silentRestartsRef.current + 1;
        if (silentRestartsRef.current > MAX_SILENT_RESTARTS) {
          silentRestartsRef.current = 0;
          setPhase("idle");
          return;
        }
        restartTimerRef.current = window.setTimeout(startListening, 120);
      };

      recognitionRef.current = recognition;
      setPhase("listening");
      setNotice(null);
      // Only chime when the turn actually changes hands, not on every restart.
      if (silentRestartsRef.current === 0) orbRef.current?.cue();
      void orbRef.current?.attachMic();
      try {
        recognition.start();
      } catch {
        setPhase("idle");
      }
    },
    [lang, send, t.noVoice, t.denied],
  );

  function begin() {
    modeRef.current = "voice";
    // Must be created inside the tap gesture or browsers keep audio suspended.
    if (!orbRef.current) orbRef.current = createOrbAudio();
    orbRef.current.startHum();
    continueRef.current = true;
    silentRestartsRef.current = 0;
    setStarted(true);
    setNotice(null);

    // Greet instantly and locally — no round trip before the first word, and
    // the audio was prewarmed on page load so it plays on the tap itself.
    const greeting = GREETING[lang];
    setTurns([{ role: "agent", text: greeting }]);
    setPhase("speaking");
    void speak(greeting, () => listen());
  }

  function stopCamera() {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCamera("off");
  }

  async function openCamera() {
    setNotice(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 } },
        audio: false,
      });
      cameraStreamRef.current = stream;
      setCamera("live");
      // The element mounts with the "live" state, so attach on the next frame.
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => {});
        }
      });
    } catch {
      setNotice(t.cameraDenied);
      setCamera("off");
    }
  }

  /**
   * Captures one frame, sends it for review, and drops it. The image is never
   * uploaded to storage, never attached to the session and never kept in state.
   */
  async function captureAndReview() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    setCamera("reviewing");

    const maxEdge = 768;
    const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      stopCamera();
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL("image/jpeg", 0.7);
    stopCamera();

    try {
      const response = await fetch("/api/voice-agent/vision", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image, language: spokenLangRef.current }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? "vision failed");

      if (payload.refer) {
        const line = t.cameraRefer;
        setTurns((current) => [...current, { role: "agent", text: line }]);
        void speak(line, () => setPhase("idle"));
        return;
      }
      if (payload.usable === false) {
        setNotice(t.cameraUnusable);
        return;
      }

      const observations: string[] = payload.observations ?? [];
      const concerns: string[] = payload.concerns ?? [];
      setTurns((current) => [
        ...current,
        { role: "user", text: t.cameraShared },
        ...(observations.length ? [{ role: "agent" as const, text: `${t.cameraSaw} ${observations.join(", ")}.` }] : []),
      ]);

      // Fold what was seen into the intake, then continue the same conversation
      // so the routine reflects it. Safety slots are untouched.
      const slots = slotsRef.current as Record<string, unknown>;
      const seen = [...observations, ...concerns].join(", ");
      slotsRef.current = {
        ...slots,
        mainConcern: slots.mainConcern ? `${slots.mainConcern}. Visible: ${seen}` : seen,
        ...(payload.skinType && !slots.skinType ? { skinType: payload.skinType } : {}),
      };
      void send("");
    } catch {
      setNotice(t.cameraError);
      setPhase("idle");
    }
  }

  /** Chat send, and the "Try saying" chips. Works with no microphone at all. */
  function submitText(text: string) {
    const clean = text.trim();
    if (!clean) return;
    modeRef.current = "chat";
    setMode("chat");
    setStarted(true);
    setDraft("");
    setNotice(null);
    void send(clean);
  }

  function switchMode(next: Mode) {
    modeRef.current = next;
    setMode(next);
    if (next === "chat") {
      // Leaving voice: release the mic and silence playback.
      continueRef.current = false;
      recognitionRef.current?.abort();
      window.speechSynthesis?.cancel();
      audioElRef.current?.pause();
      orbRef.current?.detachMic();
      orbRef.current?.stopHum();
      setInterim("");
      setPhase("idle");
    }
  }

  function stop() {
    continueRef.current = false;
    if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
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

  /** Clears the routine so the panel goes back to concerns and the intake restarts. */
  function resetRoutine() {
    setProducts([]);
    setDisclosure(null);
    slotsRef.current = {};
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
     <div className="va-grid">
      <aside className={turns.length ? "va-side va-side-live" : "va-side"}>
        {turns.length ? (
          <>
            <p className="va-side-title">
              <span className="va-live-dot" />
              {t.liveTranscript}
            </p>
            <div className="va-transcript" ref={transcriptRef}>
              {turns.map((turn, index) => (
                <p key={`${turn.role}-${index}-${turn.text.slice(0, 12)}`} className={`va-turn va-turn-${turn.role}`}>
                  <span>{turn.role === "user" ? t.you : t.agent}</span>
                  {turn.text}
                </p>
              ))}
            </div>
          </>
        ) : null}
      </aside>

      <div className="va-centre">
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

      <p className="va-status" aria-live="polite">{mode === "voice" ? statusLabel : busy ? t.thinking : ""}</p>
      <p className="va-interim">{interim ? <span>{interim}</span> : null}</p>

      {!started ? (
        <div className="va-try">
          <span>{t.trySaying}</span>
          <button type="button" className="va-try-chip" onClick={() => submitText(PROMPTS[lang][promptIndex])}>
            &ldquo;{PROMPTS[lang][promptIndex]}&rdquo;
          </button>
        </div>
      ) : null}

      <div className="va-modes" role="tablist" aria-label="Input mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "voice"}
          className={mode === "voice" ? "va-mode va-mode-on" : "va-mode"}
          onClick={() => switchMode("voice")}
        >
          <Mic size={14} />
          {t.voiceMode}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "chat"}
          className={mode === "chat" ? "va-mode va-mode-on" : "va-mode"}
          onClick={() => switchMode("chat")}
        >
          <MessageSquare size={14} />
          {t.chatMode}
        </button>
      </div>

      <button type="button" className="va-skin-btn" onClick={() => setCamera("consent")}>
        <Camera size={15} />
        {t.showSkin}
      </button>

      {camera === "consent" ? (
        <div className="va-consent" role="dialog" aria-label={t.cameraTitle}>
          <strong>{t.cameraTitle}</strong>
          <p>{t.cameraBody}</p>
          <div className="va-consent-actions">
            <button type="button" className="va-consent-yes" onClick={openCamera}>
              <Camera size={15} />
              {t.cameraAllow}
            </button>
            <button type="button" className="va-consent-no" onClick={() => setCamera("off")}>
              {t.cameraCancel}
            </button>
          </div>
        </div>
      ) : null}

      {camera === "live" || camera === "reviewing" ? (
        <div className="va-camera">
          <video ref={videoRef} playsInline muted autoPlay />
          <div className="va-camera-actions">
            <button type="button" className="va-consent-yes" onClick={captureAndReview} disabled={camera === "reviewing"}>
              {camera === "reviewing" ? <Loader2 className="va-spin-icon" size={15} /> : <Camera size={15} />}
              {t.cameraCapture}
            </button>
            <button type="button" className="va-consent-no" onClick={stopCamera}>
              {t.cameraCancel}
            </button>
          </div>
        </div>
      ) : null}

      </div>

      {/* The right column is contextual: common concerns until the advisor has
          something to show, then the routine itself — so results never push the
          orb or the transcript off the screen. */}
      <aside className={products.length ? "va-side va-side-picks va-side-routine" : "va-side va-side-picks"}>
        {products.length ? (
          <div className="va-panel" key="routine">
            <p className="va-side-title">
              <Sparkles size={13} />
              {t.yourRoutine}
              <span className="va-panel-count">{t.steps(products.length)}</span>
            </p>

            <div className="va-routine">
              {groupRoutine(products).map((group) => (
                <section className="va-routine-group" key={group.bucket}>
                  <p className="va-routine-head">{t.routine[group.bucket]}</p>
                  {group.items.map((product) => (
                    <article className="va-rx" key={product.id}>
                      {product.imageUrl ? (
                        <img
                          src={product.imageUrl}
                          alt={`${product.brand ? `${product.brand} ` : ""}${product.name}`}
                          loading="lazy"
                          // Merchant catalogues carry dead image URLs; show the
                          // neutral tile rather than a broken-image glyph. The
                          // alt text goes too — a src-less img paints its alt
                          // inside the tile, and the product name is already
                          // spelled out beside it.
                          onError={(event) => {
                            event.currentTarget.classList.add("va-rx-noimg");
                            event.currentTarget.removeAttribute("src");
                            event.currentTarget.alt = "";
                          }}
                        />
                      ) : (
                        <div className="va-rx-noimg" />
                      )}
                      <div className="va-rx-body">
                        <span className="va-rx-slot">
                          {product.slot}
                          {product.sponsored ? <em className="va-sponsored">{t.sponsored}</em> : null}
                        </span>
                        <strong>{product.name}</strong>
                        <p className="va-rx-reason">{product.reason}</p>
                        {product.cautions?.length ? <p className="va-rx-caution">{product.cautions[0]}</p> : null}
                        <div className="va-rx-foot">
                          <span className="va-price">
                            {product.currency} {product.price}
                          </span>
                          <button
                            type="button"
                            className={wishlist.includes(product.id) ? "va-icon-btn va-saved" : "va-icon-btn"}
                            onClick={() => toggleWishlist(product.id)}
                            aria-label={wishlist.includes(product.id) ? t.saved : t.save}
                            title={wishlist.includes(product.id) ? t.saved : t.save}
                          >
                            <Heart size={14} fill={wishlist.includes(product.id) ? "currentColor" : "none"} />
                          </button>
                          <a
                            className="va-icon-btn"
                            href={product.url}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={t.view}
                            title={t.view}
                          >
                            <ExternalLink size={13} />
                          </a>
                        </div>
                      </div>
                    </article>
                  ))}
                </section>
              ))}
            </div>

            <a className="va-cart-all" href={cartUrl(products)} target="_blank" rel="noreferrer">
              <ShoppingCart size={15} />
              {t.cart}
            </a>
            {disclosure ? <p className="va-disclosure">{disclosure}</p> : null}
            <button type="button" className="va-restart" onClick={resetRoutine}>
              {t.startOver}
            </button>
          </div>
        ) : (
          <div className="va-panel" key="picks">
            <p className="va-side-title">{t.quickPicks}</p>
            <div className="va-picks">
              {PROMPTS[lang].slice(0, 4).map((prompt) => (
                <button key={prompt} type="button" className="va-pick" onClick={() => submitText(prompt)}>
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}
      </aside>
     </div>

      {mode === "chat" ? (
        <form
          className="va-composer"
          onSubmit={(event) => {
            event.preventDefault();
            submitText(draft);
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t.typeHere}
            aria-label={t.typeHere}
            autoComplete="off"
          />
          <button type="submit" disabled={busy || !draft.trim()}>
            {busy ? <Loader2 className="va-spin-icon" size={16} /> : <Send size={16} />}
            {t.send}
          </button>
        </form>
      ) : null}

      {notice ? (
        <p className="va-notice">
          {notice} <a href="/live-consultation-1">{t.fallback}</a>
        </p>
      ) : null}

    </div>
  );
}
