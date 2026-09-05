"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Clock, ExternalLink, Heart, Loader2, MessageSquare, Mic, RotateCcw, Send, ShoppingCart, Sparkles, Square } from "lucide-react";
import { createOrbAudio, type OrbAudio } from "./voice-orb-audio";
import { speechLocale } from "@/services/language";
import { acknowledgements, describePhoto, fixedLines, scriptedLines } from "@/services/voice-agent";
import "./voice-agent.css";

/**
 * GET endpoint for a fixed line, so <audio> streams it from the browser cache.
 *
 * `v` is the voice-direction version: the recordings are cached immutable by
 * URL, so a change to how the advisor DELIVERS her lines must mint new URLs or
 * every shopper keeps hearing the old read forever. Bump it when the TTS
 * instructions change.
 */
function speechUrl(text: string, language: string) {
  return `/api/voice-agent/speech?v=2&lang=${language === "ar" ? "ar" : "en"}&text=${encodeURIComponent(text)}`;
}

/**
 * One-line diagnostics from the shopper's device to the server logs — event
 * names, sizes and states only, never the words themselves. The silent-voice
 * hunt ran six rounds against an iPhone nobody here could hold; what actually
 * happened on the device belongs in the logs, not in guesswork.
 */
function logClient(event: string, detail: Record<string, string | number | boolean> = {}) {
  try {
    void fetch("/api/voice-agent/client-log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event, detail }),
      keepalive: true,
    }).catch(() => {
      // diagnostics must never break the call
    });
  } catch {
    // same
  }
}

/** Roughly 30s of silence before the advisor stops listening and waits for a tap. */
const MAX_SILENT_RESTARTS = 4;

/**
 * iPhone and iPad, including iPadOS pretending to be a Mac.
 *
 * On iOS Safari, a page that HOLDS a getUserMedia audio stream and runs
 * webkitSpeechRecognition at the same time is fighting itself for the one
 * audio-input route. Recognition starts "successfully" and simply never
 * receives audio — no interim, no final, no error — most often on the session
 * right after a TTS reply reshuffles the audio session. Desktop Chrome
 * multiplexes happily, which is why this never reproduced in a headless test
 * and always reproduced on the shopper's phone.
 */
/**
 * Whether the embedding page has withheld the microphone — true, false, or
 * "cannot tell".
 *
 * `allow="microphone"` on an iframe is permission DELEGATION, not permission:
 * with it the shopper still gets the ordinary browser prompt, and can still
 * say no. Those two failures look identical from getUserMedia and need
 * opposite advice — one is fixed by tapping Allow, the other cannot be fixed
 * by the shopper at all — so guessing between them means being confidently
 * wrong half the time.
 *
 * The Permissions Policy API answers it where it exists. Safari does not
 * implement it, which is most of this store's traffic, so null is the common
 * answer and the copy for it has to cover both cases honestly.
 */
function pageBlocksMic(): boolean | null {
  if (typeof document === "undefined") return null;
  const policy = (document as Document & { featurePolicy?: { allowsFeature?: (feature: string) => boolean } })
    .featurePolicy;
  if (typeof policy?.allowsFeature !== "function") return null;
  try {
    return !policy.allowsFeature("microphone");
  } catch {
    return null;
  }
}

/**
 * Whether a held microphone stream can still actually produce audio.
 *
 * `readyState === "live"` is not enough, and the gap between those two is the
 * whole bug. On iOS, playing audio interrupts an open capture session: the
 * track stays live and goes MUTED, delivering digital silence while every
 * check we had said it was fine. A shopper four turns into a conversation kept
 * talking to a microphone that had been dead since the advisor's last reply —
 * five recordings sent, five transcribed to nothing, and the advisor stood
 * down as designed.
 *
 * A muted track cannot be un-muted from here; the only recovery is to drop it
 * and ask for another.
 */
function usableStream(stream: MediaStream): boolean {
  return stream.getAudioTracks().some((track) => track.readyState === "live" && !track.muted);
}

const IOS =
  typeof navigator !== "undefined" &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

/** Every line the interview can say verbatim — these are the ones worth caching. */
/**
 * Every line that is written by us rather than by a model.
 *
 * These go over GET, so the browser keeps the audio for an hour and the server
 * keeps it for the life of the instance. Only the seven questions used to
 * qualify, which meant every acknowledgement, reaction and result line was
 * synthesised from scratch on every turn of every session — the single biggest
 * source of silence between the shopper speaking and the advisor answering.
 */
const SCRIPTED = new Set([...fixedLines("en"), ...fixedLines("ar")]);
function isScriptedLine(text: string) {
  return SCRIPTED.has(text.trim());
}

type Lang = "en" | "ar";
type Mode = "voice" | "chat";
type Phase = "idle" | "listening" | "thinking" | "speaking";

/**
 * A follow-up the server offered for this turn.
 *
 * `ask` travels back as an intent rather than the label as free text: a button
 * we drew ourselves should not have to survive the tangent classifier on its
 * way home.
 */
type Suggestion = { ask: "about" | "actives" | "suits"; label: string };

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
  expectedResults?: string;
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
    denied: "I couldn't reach the microphone — either the browser blocked it, or this page hasn't allowed it. I've switched to chat; type below and I'll answer just the same.",
    deniedEmbedded: "This page hasn't given me microphone access, so voice can't start here. I've switched to chat — type below and I'll answer just the same.",
    save: "Save",
    saved: "Saved",
    cart: "Add routine to cart",
    view: "View",
    sponsored: "Sponsored",
    replay: "Tap when you're ready",
    fallback: "Open the full advisor",
    error: "Something went wrong. Tap the mic to try again.",
    micTrouble:
      "I'm not hearing anything from the microphone. Tap the orb to try again — or switch to Chat and type, that always works.",
    micIdle: "Still with you — tap the orb whenever you're ready to carry on.",
    youSpeaking: "You're speaking — I'm listening →",
    advisorSpeaking: "Your advisor speaking →",
    hearAgain: "Hear that again",
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
    cameraNotSkin: (shows: string) =>
      shows
        ? `That looks like ${shows} to me — and I'm only qualified to look at skin! Point the camera at the area you'd like help with and I'll take a proper look.`
        : "I don't think that's skin I'm looking at — and skin is the only thing I'm qualified to comment on. Point the camera at the area you'd like help with and try again.",
    cameraWhichPart: "I can see skin, but I can't quite tell which part of the body I'm looking at — whereabouts is this?",
    cameraDenied: "I couldn't open the camera. Allow camera access, or just describe your skin.",
    cameraError: "The photo review didn't work. You can describe your skin instead.",
    liveTranscript: "Live transcript",
    quickPicks: "Common concerns",
    aboutThis: "About this product",
    addToBag: "Add to bag",
    addedToBag: "Added to your bag.",
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
    denied: "تعذّر الوصول إلى الميكروفون — إمّا أن المتصفح منعه أو أن هذه الصفحة لم تسمح به. انتقلت إلى المحادثة؛ اكتب أدناه وسأجيبك بالمثل.",
    deniedEmbedded: "هذه الصفحة لم تمنحني إذن الميكروفون، لذا لا يمكن بدء الصوت هنا. انتقلت إلى المحادثة — اكتب أدناه وسأجيبك بالمثل.",
    save: "حفظ",
    saved: "محفوظ",
    cart: "أضف الروتين إلى السلة",
    view: "عرض",
    sponsored: "مموَّل",
    replay: "اضغط عندما تكون جاهزاً",
    fallback: "افتح المستشار الكامل",
    error: "حدث خطأ. اضغط الميكروفون للمحاولة مرة أخرى.",
    micTrouble: "لا يصلني صوت من الميكروفون. اضغط الكرة للمحاولة مجدداً — أو انتقل إلى «محادثة» واكتب، فهذا يعمل دائماً.",
    micIdle: "ما زلت معك — اضغط الكرة متى أردت المتابعة.",
    youSpeaking: "أنت تتحدث — أنا أُصغي ←",
    advisorSpeaking: "مستشارك يتحدث ←",
    hearAgain: "أعِد السماع",
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
    cameraNotSkin: (shows: string) =>
      shows
        ? `يبدو لي أن هذه ${shows} — وأنا مؤهل للنظر إلى البشرة فقط! وجّه الكاميرا إلى المنطقة التي تريد المساعدة بها وسألقي نظرة.`
        : "لا أعتقد أن ما أراه بشرة — والبشرة هي الشيء الوحيد المؤهل للتعليق عليه. وجّه الكاميرا إلى المنطقة المطلوبة وحاول مجدداً.",
    cameraWhichPart: "أرى بشرة، لكن لا أستطيع تحديد أي جزء من الجسم أنظر إليه — أين هذه المنطقة تحديداً؟",
    cameraDenied: "تعذّر فتح الكاميرا. اسمح بالوصول أو صف بشرتك بالكلمات.",
    cameraError: "لم تنجح مراجعة الصورة. يمكنك وصف بشرتك بدلاً من ذلك.",
    liveTranscript: "النص المباشر",
    quickPicks: "مشاكل شائعة",
    aboutThis: "عن هذا المنتج",
    addToBag: "أضف إلى الحقيبة",
    addedToBag: "تمت الإضافة إلى حقيبتك.",
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
  tenantSlug,
  focusProduct,
  initialQuestion,
}: {
  initialLang?: Lang;
  /** "full" is the shopper product; "compact" is the homepage demo. */
  variant?: "full" | "compact";
  /**
   * Whose catalogue to recommend from. Undefined on our own pages, where the
   * API's default is the right answer; set by /advisor, which is the surface a
   * merchant embeds. The server does not take this on trust when the request
   * arrives on a host that already names a merchant — see /api/voice-agent.
   */
  tenantSlug?: string;
  /**
   * What the shopper is looking at, when the advisor was opened from a product
   * page — a handle, URL, id or SKU. Sent as given; the server resolves it
   * against the tenant's catalogue and ignores anything that matches nothing,
   * so an advisor opened from a page we do not stock behaves exactly as one
   * opened from the floating launcher.
   */
  focusProduct?: string;
  /**
   * A question the storefront asked on the shopper's behalf.
   *
   * Cicabelle's product page carries buttons — "Ask DermaGuru if this suits
   * your skin", "How do I use X in my routine?" — that open the panel with the
   * question already chosen. Treated exactly as though the shopper had typed
   * it: it goes through the ordinary dialogue, and the answer is text, because
   * nobody has tapped anything a browser will let us speak through yet.
   */
  initialQuestion?: string;
}) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [mode, setMode] = useState<Mode>("voice");
  const [phase, setPhase] = useState<Phase>("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [interim, setInterim] = useState("");
  // The sentence the advisor is saying right now, for the call bar.
  const [speakingLine, setSpeakingLine] = useState("");
  // The advisor's whole last reply, so "Hear that again" can replay every
  // part of it — the recovery when a line was missed or the phone stayed
  // quiet — inside a fresh tap, which is the gesture iOS trusts most.
  const replayRef = useRef<string[]>([]);
  const [draft, setDraft] = useState("");
  const [products, setProducts] = useState<AgentProduct[]>([]);
  /**
   * The product the shopper is standing in front of.
   *
   * Kept apart from `products` on purpose. That list is the routine, and the
   * column that renders it is headed "Your routine" — so putting the page's
   * own product in it both mislabelled it and displaced the chips that were
   * the point of showing it.
   */
  const [focus, setFocus] = useState<AgentProduct | null>(null);
  /** The follow-ups this turn offered, if any — see suggestionsFor on the server. */
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [disclosure, setDisclosure] = useState<string | null>(null);
  const [wishlist, setWishlist] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  /**
   * The same fact as `started`, readable from an async closure.
   *
   * The opening turn on a product page is a network round trip that includes
   * an LLM call, so it can land a second or two after the panel appeared — by
   * which time the shopper may have tapped the microphone and be mid-sentence.
   * State does not reach the closure that resolves it; this does.
   */
  const startedRef = useRef(false);
  /** Both, together, so the async paths can never disagree with the UI. */
  const markStarted = useCallback(() => {
    startedRef.current = true;
    setStarted(true);
  }, []);


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
  const routineRef = useRef<HTMLElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const continueRef = useRef(false);
  // How many times recognition has restarted without hearing anything. A
  // shopper who walked away shouldn't keep the microphone open forever.
  const silentRestartsRef = useRef(0);
  // Whether this visit's microphone has EVER produced words. It decides which
  // stand-down message is honest: a mic that has worked and gone quiet gets
  // "tap when you're ready", not an error about a microphone problem.
  const everHeardRef = useRef(false);
  // When a recognition session last ended. iOS ducks the page's media output
  // while recognition runs and is slow to lift it; playback started inside
  // that window keeps the ducked volume for the whole line. Speak waits out
  // the remainder of a short settle window on iOS.
  const lastMicActivityRef = useRef(0);
  const restartTimerRef = useRef<number | null>(null);
  // iOS call mode: Apple's on-device recognition was the least reliable part
  // of the product (sessions that never produce a result, short answers that
  // never finalise, ducked playback around every listen). On iOS the mic is
  // held open like a phone call, each turn is RECORDED and transcribed
  // server-side, and the audio session stays in one state — one volume —
  // from greeting to goodbye.
  const callStreamRef = useRef<MediaStream | null>(null);
  const callStreamPromiseRef = useRef<Promise<MediaStream | null> | null>(null);
  const callCtxRef = useRef<AudioContext | null>(null);
  const vadNodesRef = useRef<{ source: MediaStreamAudioSourceNode; analyser: AnalyserNode } | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const vadFrameRef = useRef<number | null>(null);
  const recordedTurnRef = useRef(0);
  const t = UI[lang];

  /**
   * The call stream, opened on demand (and inside the tap in begin()).
   *
   * Single-flight: begin() requests the microphone inside the tap, and the
   * first listen can arrive before that request resolves. Two concurrent
   * getUserMedia calls meant TWO streams, and only the last one assigned was
   * ever stopped again — the orphan held the iPhone's audio session in call
   * mode for the rest of the visit, which ducks every advisor line after the
   * first to silence. One pending request, shared by every caller.
   */
  const ensureCallStream = useCallback(async (): Promise<MediaStream | null> => {
    const current = callStreamRef.current;
    if (current && usableStream(current)) return current;
    /*
     * The held stream is no good any more, so let it go before asking for
     * another — an orphaned track keeps the iPhone's audio session in call
     * mode, which is the bug the single-flight above was written for.
     */
    if (current) {
      current.getTracks().forEach((track) => track.stop());
      callStreamRef.current = null;
      if (vadNodesRef.current) {
        try {
          vadNodesRef.current.source.disconnect();
        } catch {
          // already detached
        }
        vadNodesRef.current = null;
      }
    }
    if (!callStreamPromiseRef.current) {
      callStreamPromiseRef.current = navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          callStreamRef.current = stream;
          return stream;
        })
        .catch(() => null)
        .finally(() => {
          callStreamPromiseRef.current = null;
        });
    }
    return callStreamPromiseRef.current;
  }, []);

  /** Ends any in-flight recorded turn without acting on its audio. */
  const cancelRecordedTurn = useCallback(() => {
    recordedTurnRef.current += 1;
    if (vadFrameRef.current) window.cancelAnimationFrame(vadFrameRef.current);
    vadFrameRef.current = null;
    // Unplug the turn's level-meter graph. Left connected, every turn adds
    // another live microphone tap to the context — a growing render graph
    // that keeps the audio session looking busy even between turns.
    const nodes = vadNodesRef.current;
    vadNodesRef.current = null;
    if (nodes) {
      try {
        nodes.source.disconnect();
        nodes.analyser.disconnect();
      } catch {
        // already gone
      }
    }
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.ondataavailable = null;
      try {
        recorder.stop();
      } catch {
        // already stopped
      }
    }
  }, []);

  /** Hangs up the call: recorder, analyser context and microphone released. */
  const releaseCall = useCallback(() => {
    cancelRecordedTurn();
    callStreamRef.current?.getTracks().forEach((track) => track.stop());
    callStreamRef.current = null;
    // A microphone request still in flight lands AFTER the hang-up — stop
    // whatever it delivers, or its stream keeps the mic indicator lit and the
    // audio session in call mode with nobody holding the reference.
    void callStreamPromiseRef.current?.then((stream) => stream?.getTracks().forEach((track) => track.stop()));
    void callCtxRef.current?.close().catch(() => {});
    callCtxRef.current = null;
  }, [cancelRecordedTurn]);

  /**
   * The microphone is not going to work, so stop offering it.
   *
   * Until now every one of these paths set a message and left the panel in
   * Voice mode, staring at an orb that would fail again on the next tap. A
   * shopper on a storefront does not debug permissions; they leave. Chat needs
   * no permission from anybody and reaches the same advisor.
   *
   * Distinguishes the two reasons, because the advice differs and the wrong
   * advice is worse than none: a shopper who was never ASKED cannot fix it by
   * granting anything. An embedded panel only gets a microphone if the page
   * that framed it said so with allow="microphone" — see docs/EMBED.md — and
   * when that is missing the browser refuses without ever prompting.
   */
  const giveUpOnVoice = useCallback(
    (reason: "denied" | "unsupported") => {
      continueRef.current = false;
      recognitionRef.current?.abort();
      recognitionRef.current = null;
      releaseCall();
      modeRef.current = "chat";
      setMode("chat");
      setPhase("idle");
      setNotice(reason === "unsupported" ? t.noVoice : pageBlocksMic() === true ? t.deniedEmbedded : t.denied);
    },
    [t.noVoice, t.denied, t.deniedEmbedded, releaseCall],
  );

  /**
   * Bring the routine to the shopper on a phone.
   *
   * Stacked, the columns run orb, routine, transcript — so the answer somebody
   * has just spent four questions waiting for renders below the fold, and the
   * screen looks like nothing happened. On desktop the routine is already in
   * view beside the orb, so this only fires where the layout stacks.
   *
   * Keyed on which products are showing, not how many: an adjusted routine of
   * the same length is still a new answer worth being shown.
   */
  const routineKey = products.map((product) => product.id).join(",");
  useEffect(() => {
    if (!routineKey) return;
    const node = routineRef.current;
    if (!node || typeof window.matchMedia !== "function") return;
    if (!window.matchMedia("(max-width: 1080px)").matches) return;

    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // A frame late, so the panel has been laid out and lands where we scroll to.
    const id = window.requestAnimationFrame(() => {
      node.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    });
    return () => window.cancelAnimationFrame(id);
  }, [routineKey]);

  /**
   * Attach the camera stream once the <video> is really in the DOM.
   *
   * This used to run inside a requestAnimationFrame fired straight after
   * setCamera("live"). React commits when it commits, and on a phone that frame
   * regularly arrived first — so videoRef.current was null, the stream was never
   * attached, and the shopper watched a black rectangle while the camera light
   * on their phone was on. An effect runs after the commit, which is the only
   * point at which the element is guaranteed to exist.
   */
  useEffect(() => {
    if (camera !== "live" && camera !== "reviewing") return;
    const video = videoRef.current;
    const stream = cameraStreamRef.current;
    if (!video || !stream) return;

    if (video.srcObject !== stream) video.srcObject = stream;
    // iOS will not start a stream until it has metadata, and play() before that
    // rejects silently — which looks identical to the bug above.
    const start = () => {
      video.play().catch(() => setNotice(t.cameraError));
    };
    if (video.readyState >= 1) start();
    else video.addEventListener("loadedmetadata", start, { once: true });
    return () => video.removeEventListener("loadedmetadata", start);
  }, [camera, t.cameraError]);

  /**
   * Drive --level from real audio — but only while there is audio.
   *
   * This ran every frame for the whole life of the page, and --level feeds the
   * colour stops of several radial gradients. A gradient whose stops change
   * cannot be composited, so every frame forced a repaint of the orb: while
   * idle, while reading, and while the shopper was trying to scroll. On a phone
   * that is exactly what makes a page feel heavy and stuttery under the thumb.
   *
   * Now it runs while listening or speaking, and stops otherwise.
   */
  const pulsing = phase === "listening" || phase === "speaking";
  useEffect(() => {
    const still = () => stageRef.current?.style.setProperty("--level", "0");
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (!pulsing || reduced) {
      still();
      return;
    }

    // Two decimal places is finer than the eye resolves in a gradient, and it
    // keeps a repaint from being queued for a change nobody can see.
    let last = -1;
    const tick = () => {
      const orb = orbRef.current;
      const stage = stageRef.current;
      if (orb && stage) {
        const level = Math.round(orb.level() * 100) / 100;
        if (level !== last) {
          last = level;
          stage.style.setProperty("--level", level.toFixed(2));
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      still();
    };
  }, [pulsing]);

  // Keep the newest turn in view inside the panel. A no-op on a phone, where
  // the panel is no longer a scroller and the page carries the transcript.
  useEffect(() => {
    const panel = transcriptRef.current;
    if (panel && panel.scrollHeight > panel.clientHeight) panel.scrollTop = panel.scrollHeight;
  }, [turns, interim]);

  // Rotate the example prompts while the shopper hasn't started.
  useEffect(() => {
    if (started) return;
    const id = window.setInterval(() => setPromptIndex((i) => (i + 1) % PROMPTS.en.length), 3200);
    return () => window.clearInterval(id);
  }, [started]);

  // Hang up when the storefront closes the launcher, or when the page goes
  // away. Embedded in a merchant's shop this component is inside an iframe the
  // widget merely HIDES on close — hiding does not pause a document, so
  // without this the advisor kept listening and talking behind a closed panel
  // with the recording indicator lit on someone else's site. The frame stays
  // alive so the conversation is still there when it is reopened; only the
  // microphone and the voice stop.
  useEffect(() => {
    const hangUp = () => {
      continueRef.current = false;
      if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
      recognitionRef.current?.abort();
      recognitionRef.current = null;
      // releaseCall is the one place that knows how to put the microphone down
      // — including stopping a getUserMedia request that lands *after* the
      // hang-up. Spelling that out again here would be the same six lines with
      // its own future bugs.
      releaseCall();
      // The photo flow holds a second, separate stream. Closing the panel has
      // to put that light out too, and this is newly reachable: until the
      // frame delegated `camera`, the button could not open one in an embed.
      stopCamera();
      window.speechSynthesis?.cancel();
      audioElRef.current?.pause();
      setInterim("");
      setPhase("idle");
    };
    // The sender is the merchant's page, so its origin is whatever storefront
    // we are embedded in and cannot be checked against a list. That is fine
    // for this one message and would not be for any other: "stop" only ever
    // turns things OFF, and anything on that page could achieve the same by
    // removing the frame. Accept it only from the window that framed us, and
    // only by exact name, so it stays the one instruction we take from
    // outside.
    const onMessage = (event: MessageEvent) => {
      if (window.parent === window || event.source !== window.parent) return;
      if ((event.data as { type?: string } | null)?.type === "dg:stop") hangUp();
    };
    window.addEventListener("message", onMessage);
    // A storefront navigation puts this page in the back/forward cache rather
    // than unmounting it, so the effect cleanup below never runs.
    window.addEventListener("pagehide", hangUp);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("pagehide", hangUp);
    };
  }, [releaseCall]);

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
    // The questions next — one of them is always what comes after the greeting.
    const askId = window.setTimeout(() => questions.forEach((line) => void warm(line)), 1200);
    // Then the short lines that open a turn. By the time the shopper has
    // finished their first sentence these are in the browser, so the reply
    // starts speaking immediately instead of waiting on the speech API.
    const ackId = window.setTimeout(() => acknowledgements(lang).forEach((line) => void warm(line)), 3500);
    return () => {
      window.clearTimeout(askId);
      window.clearTimeout(ackId);
    };
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
      recordedTurnRef.current += 1;
      if (vadFrameRef.current) window.cancelAnimationFrame(vadFrameRef.current);
      callStreamRef.current?.getTracks().forEach((track) => track.stop());
      void callStreamPromiseRef.current?.then((stream) => stream?.getTracks().forEach((track) => track.stop()));
      void callCtxRef.current?.close().catch(() => {});
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
      let started = false;
      let settled = false;
      let startWatch = 0;
      let hardCap = 0;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(startWatch);
        window.clearTimeout(hardCap);
        onDone();
      };
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = speechLocale(spokenLangRef.current);
      const voice = pickVoice(synth, spokenLangRef.current);
      if (voice) utterance.voice = voice;
      utterance.rate = 0.97;
      utterance.volume = 1;
      utterance.onstart = () => {
        started = true;
      };
      utterance.onend = finish;
      utterance.onerror = finish;
      // iOS refuses to speak an utterance queued outside a tap — SILENTLY.
      // It fires no start, no end, no error: the advisor shows "speaking"
      // and the conversation never moves again. If speech hasn't audibly
      // started within a beat, give up and move on — the words are on the
      // screen, and "Hear that again" replays them with the natural voice.
      startWatch = window.setTimeout(() => {
        if (!started) {
          logClient("browser-voice-mute", { chars: text.length });
          try {
            synth.cancel();
          } catch {
            // nothing to cancel
          }
          finish();
        }
      }, 3000);
      // And a generous ceiling even when it DID start, because iOS also
      // loses end events when the tab's audio session shifts mid-utterance.
      hardCap = window.setTimeout(() => {
        try {
          synth.cancel();
        } catch {
          // nothing to cancel
        }
        finish();
      }, 5000 + text.length * 120);
      setPhase("speaking");
      synth.speak(utterance);
    },
    [lang],
  );

  /** Natural OpenAI voice when configured; browser voice otherwise. */
  const speak = useCallback(
    async (text: string, onDone: () => void, preloadedUrl?: string) => {
      if (!text.trim()) {
        onDone();
        return;
      }
      window.speechSynthesis?.cancel();
      audioElRef.current?.pause();
      // Never talk over an open microphone. A silent-restart timer queued just
      // before this turn arrived would reopen recognition DURING playback —
      // and iOS ducks media output to a whisper while capture is live, which
      // is heard as the voice starting strong and going extremely quiet.
      if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
      const liveRecognition = recognitionRef.current;
      recognitionRef.current = null;
      if (liveRecognition) {
        lastMicActivityRef.current = Date.now();
        liveRecognition.abort();
      }
      cancelRecordedTurn();
      // iOS keeps the page's audio session in CALL mode while anything still
      // captures — a live microphone track (merely muting it is not enough)
      // or a running Web Audio context with a microphone source — and in
      // that state the advisor's playback is ducked to nothing or routed to
      // the earpiece: the bar says "Advisor speaking" and the phone stays
      // silent. So for the length of the line the capture stack comes down
      // COMPLETELY: recorder cancelled above, microphone tracks STOPPED,
      // analyser context suspended. The next recorded turn re-acquires the
      // microphone — same page, already granted, no second prompt.
      const callTracks = callStreamRef.current?.getAudioTracks() ?? [];
      if (callTracks.some((track) => track.readyState === "live")) {
        // iOS releases the record session a beat AFTER the tracks stop, and
        // playback that starts inside that beat keeps call-mode volume for
        // the whole line — so the settle clock below starts here.
        lastMicActivityRef.current = Date.now();
        callTracks.forEach((track) => track.stop());
      }
      if (callCtxRef.current?.state === "running") {
        void callCtxRef.current.suspend().catch(() => {});
      }
      setPhase("speaking");
      setSpeakingLine(text);

      let audio = audioElRef.current;
      if (!audio) {
        audio = new Audio();
        audio.preload = "auto";
        audioElRef.current = audio;
      }
      audio.volume = 1;
      // Route through the analyser so the orb pulses with the agent's voice.
      // NOT on iOS: capturing an element into a WebAudio graph is permanent
      // for that element, and iOS leaves the graph's output at the ducked
      // level it had during the last recognition session — every line after
      // the first listen played at a whisper. Played directly, the element
      // returns to full media volume; the orb keeps its CSS speaking state.
      if (!IOS) orbRef.current?.attachElement(audio);

      let objectUrl: string | null = null;
      // One exit only. A failed load fires BOTH the element's onerror and the
      // rejection of play(), so the browser fallback ran twice — two listen()
      // calls, the second aborting the first mid-answer.
      let exited = false;
      const once = (run: () => void) => {
        if (exited) return;
        exited = true;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        run();
      };
      const finish = () => once(onDone);

      try {
        if (preloadedUrl) {
          // Already in memory: playback starts with no request at all.
          objectUrl = preloadedUrl;
          audio.src = preloadedUrl;
        } else {
          // Scripted lines knock on the cacheable GET door first; anything
          // personalised goes straight to POST so the shopper's routine never
          // lands in a URL or a request log. A GET refusal falls through to
          // POST rather than to the robotic browser voice — losing the
          // natural voice because the cache door was closed is exactly what
          // muted the advisor's most sensitive lines on iPhone (R-067).
          let response = isScriptedLine(text)
            ? await fetch(speechUrl(text, spokenLangRef.current)).catch(() => null)
            : null;
          if (!response?.ok) {
            response = await fetch("/api/voice-agent/speech", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ text, language: spokenLangRef.current }),
            });
          }
          if (!response.ok) throw new Error("no natural voice");
          objectUrl = URL.createObjectURL(await response.blob());
          audio.src = objectUrl;
        }

        audio.onended = finish;
        audio.onerror = () => {
          logClient("playback-error", { chars: text.length, preloaded: Boolean(preloadedUrl), ios: IOS });
          once(() => speakWithBrowser(text, onDone));
        };
        // iOS ducks media output while speech recognition holds the audio
        // session, and lifts it a beat AFTER recognition ends. Playback that
        // starts inside that beat keeps the ducked volume for the whole line
        // — heard as the voice "going down" right after the shopper spoke.
        // Wait out the remainder of a short settle window; later parts of the
        // same reply see an old timestamp and start with no delay at all.
        if (IOS) {
          const settle = 450 - (Date.now() - lastMicActivityRef.current);
          if (settle > 0 && !exited) await new Promise((resolve) => setTimeout(resolve, settle));
        }
        if (!exited) {
          await audio.play();
          logClient("line-played", { chars: text.length, preloaded: Boolean(preloadedUrl), ios: IOS });
        }
      } catch {
        logClient("speech-unavailable", { chars: text.length, scripted: isScriptedLine(text), ios: IOS });
        once(() => speakWithBrowser(text, onDone));
      }
    },
    [lang, speakWithBrowser, cancelRecordedTurn],
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
      replayRef.current = queue;
      // Fetch the audio for EVERY part now, in parallel, as blobs. The old
      // version warmed the HTTP cache and let the <audio> element re-request
      // each line when its turn came — but Safari's media loader bypasses the
      // fetch cache, so on the device that matters most every sentence still
      // paid a full round trip, heard as a long breath between sentences. A
      // blob in memory starts in the same frame.
      //
      // Dynamic parts too: they used to wait until their turn and pay their
      // whole synthesis as an audible pause in the MIDDLE of the reply —
      // exactly where a failure also dropped that one line to the quiet
      // robotic browser voice. Synthesised here, they arrive while the first
      // cached part is already playing.
      const preloads = queue.map((part) => {
        const posted = () =>
          fetch("/api/voice-agent/speech", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text: part, language: spokenLangRef.current }),
          });
        // A scripted line the GET door refuses still gets its natural voice
        // through POST — see R-067.
        return (isScriptedLine(part) ? fetch(speechUrl(part, spokenLangRef.current)).then((response) => (response.ok ? response : posted())) : posted())
          .then((response) => (response.ok ? response.blob() : null))
          .then((blob) => (blob ? URL.createObjectURL(blob) : null))
          .catch(() => null);
      });
      const step = (index: number) => {
        if (index >= queue.length) {
          onDone();
          return;
        }
        void preloads[index].then((url) => speak(queue[index], () => step(index + 1), url ?? undefined));
      };
      step(0);
    },
    [speak],
  );

  /** One turn's round trip, with no side effects — so callers can overlap it. */
  const requestTurn = useCallback(
    async (utterance: string, ask?: Suggestion["ask"]) => {
      const response = await fetch("/api/voice-agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          utterance,
          slots: slotsRef.current,
          language: spokenLangRef.current,
          // Omitted rather than sent empty: the route defaults the field, and a
          // blank string would be a slug that matches no merchant.
          ...(tenantSlug ? { tenantSlug } : {}),
          // Sent on every turn, not just the opening one. It is what the
          // shopper is looking at for the whole visit, and a later question —
          // "is this one okay with retinol?" — means the product just as much
          // as the first one did.
          ...(focusProduct ? { product: focusProduct } : {}),
          // Which chip was tapped, when one was. Absent for anything typed or
          // spoken, which goes through the ordinary dialogue as it always has.
          ...(ask ? { ask } : {}),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? "agent error");
      return payload;
    },
    [tenantSlug, focusProduct],
  );

  /** Applies a turn's payload: state, transcript, and the spoken reply. */
  const handleTurn = useCallback(
    (
      payload: {
        slots?: Record<string, unknown>;
        language?: string;
        products?: AgentProduct[];
        focus?: AgentProduct | null;
        suggestions?: Suggestion[];
        disclosure?: string;
        reply?: string;
        phase?: string;
        speech?: string[];
      },
      // The opening turn on a product page arrives before anybody has tapped
      // anything. Speaking it would need an audio autoplay permission we do
      // not have and would not deserve if we did — an advisor that starts
      // talking the moment a panel opens on somebody's storefront.
      options?: { silent?: boolean },
    ) => {
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
      // Only ever set, never cleared by a turn that carries none. What the
      // shopper is looking at does not stop being true because they asked
      // something else about it.
      if (payload.focus) setFocus(payload.focus);
      // Assigned on every turn, not only when non-empty: an answered chip has
      // to disappear, and a turn that offers nothing has to clear what the
      // last one offered. The products above are deliberately not like this —
      // a routine stays on screen while the conversation carries on around it.
      if (Array.isArray(payload.suggestions)) setSuggestions(payload.suggestions);

      const reply: string = payload.reply ?? "";
      setTurns((current) => [...current, { role: "agent", text: reply }]);

      // Chat mode stays silent and never grabs the microphone.
      if (options?.silent || modeRef.current === "chat") {
        setPhase("idle");
        return;
      }
      // Keep the microphone open unless safety triage ended the session — the
      // shopper can always ask a follow-up once the routine is on screen.
      // "farewell" is the shopper saying they're done: reopening the mic after
      // goodbye is the shop assistant following you to the door.
      const keepGoing =
        payload.phase !== "referral" && payload.phase !== "farewell" && continueRef.current;
      const parts: string[] = Array.isArray(payload.speech) && payload.speech.length ? payload.speech : [reply];
      speakSequence(parts, () => {
        if (keepGoing) {
          listen();
          return;
        }
        // The visit is over — hang up the call so the mic indicator goes out.
        releaseCall();
        setPhase("idle");
      });
    },
    // eslint-disable-next-line
    [speakSequence],
  );

  const send = useCallback(
    async (utterance: string, ask?: Suggestion["ask"]) => {
      setPhase("thinking");
      setInterim("");
      if (utterance) setTurns((current) => [...current, { role: "user", text: utterance }]);

      try {
        handleTurn(await requestTurn(utterance, ask));
      } catch {
        setNotice(t.error);
        setPhase("idle");
      }
    },
    [requestTurn, handleTurn, t.error],
  );

  /**
   * Add to bag, from inside somebody else's page.
   *
   * The advisor is an iframe on another origin, so it cannot touch the
   * storefront's cart — that is the browser working correctly, not a gap. What
   * it can do is say what the shopper asked for and let the page it is
   * embedded in do the adding.
   *
   * The message carries the HANDLE, not a variant id. We do not hold Shopify
   * variant ids: the sync reads products, keeps the first variant's price and
   * SKU, and those SKUs are `csv-<timestamp>-<row>` on most of this catalogue
   * — a number that would look like an id and add the wrong thing. The handle
   * is the one identifier that is correct on every row, and the storefront can
   * turn it into a variant with the product JSON it already has.
   *
   * Addressed to the shop's own origin rather than "*". We know it: it is the
   * origin of the product's own URL, which came out of the merchant's
   * catalogue, not out of the page we are embedded in. A panel framed by
   * somebody else gets its message dropped by the browser, which is the right
   * outcome and not one we have to police ourselves.
   */
  const addToParentCart = useCallback((product: AgentProduct) => {
    let origin: string;
    try {
      origin = new URL(product.url).origin;
    } catch {
      return;
    }
    const handle = product.url.split("#")[0].split("?")[0].split("/").filter(Boolean).pop();
    if (!handle) return;

    try {
      window.parent.postMessage(
        {
          type: "dermaguru:add-to-cart",
          // Present from the first message so the listener can refuse a shape
          // it does not know, rather than guess at one.
          version: 1,
          handle,
          quantity: 1,
          url: product.url,
        },
        origin,
      );
      setNotice(t.addedToBag);
    } catch {
      setNotice(t.error);
    }
  }, [t.addedToBag, t.error]);

  /**
   * Opening a product page with an offer rather than a question.
   *
   * The panel used to greet from a hardcoded line the moment somebody tapped
   * the microphone, and never asked the server for an opening turn at all — so
   * everything the route knows how to say about the product on the page was
   * unreachable, and a shopper standing in front of one product was asked
   * "what's bothering your skin?" as though the page did not exist.
   *
   * Runs once, and only with a product: on our own pages, and on the floating
   * launcher anywhere but a product page, there is nothing to open about.
   *
   * Silent, and it does not set `started` — nothing has been tapped, so there
   * is no gesture to speak through and no conversation to be in the middle of.
   * What appears is the greeting, the card, and the chips. Tapping any of them
   * is the gesture.
   */
  const openedRef = useRef(false);
  /**
   * The opening turn's line, held for the tap that will speak it.
   *
   * begin() cannot await a network call — it runs inside the gesture, and iOS
   * only lets audio start within the gesture that asked for it. So the line is
   * kept here as soon as it lands, and its audio is prewarmed the same way the
   * scripted lines are, which is what makes it play on the tap itself.
   */
  const openingReplyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusProduct || openedRef.current) return;
    openedRef.current = true;

    // A pre-seeded question is a stronger instruction than "open about this",
    // and it answers with the product in hand anyway, so it replaces the
    // opening turn rather than racing it.
    if (initialQuestion) {
      modeRef.current = "chat";
      setMode("chat");
      markStarted();
      void send(initialQuestion);
      return;
    }

    requestTurn("")
      .then((payload) => {
        /*
         * The shopper got there first.
         *
         * This request includes an LLM call, so it lands a second or two after
         * the panel appeared — long enough for somebody to have tapped the
         * microphone and started talking. Applying an OPENING turn on top of a
         * live conversation does three things, and all of them read as the
         * advisor breaking: it resets the slots to empty, so what they just
         * said is forgotten; it appends a greeting into the middle of the
         * transcript; and it puts the phase back to idle, which takes the call
         * bar off the screen and turns the orb back into a start button while
         * the advisor is still listening.
         *
         * The card is kept, because it is a fact about the page rather than a
         * turn in the conversation. Everything else is dropped.
         */
        // Ready for the tap, whether or not the shopper has got there first.
        const line = typeof payload.reply === "string" ? payload.reply.trim() : "";
        if (line && payload.focus) {
          openingReplyRef.current = line;
          void fetch(speechUrl(line, spokenLangRef.current === "ar" ? "ar" : "en"), { cache: "force-cache" }).catch(
            () => {
              // Prewarming is an optimisation; speak() still works without it.
            },
          );
        }

        if (startedRef.current) {
          if (payload.focus) setFocus(payload.focus);
          return;
        }
        handleTurn(payload, { silent: true });
      })
      // Silence is the right failure. The shopper still has the microphone and
      // the text box, and a red error on a storefront panel nobody has touched
      // yet would be worse than the greeting they did not get.
      .catch(() => {});
    // Deliberately not depending on send/requestTurn/handleTurn: they are
    // rebuilt as state changes, and this must fire once on arrival, not again
    // every time the conversation moves.
    // eslint-disable-next-line
  }, [focusProduct, initialQuestion]);

  /**
   * One recorded turn of the iOS call.
   *
   * Records from the held stream, watches the level, stops a beat after the
   * shopper goes quiet, and sends the audio for server transcription. There is
   * no on-device recognition anywhere in this path — the thing that kept
   * getting stuck is simply not used.
   */
  const startRecordedTurn = useCallback(
    function recordTurn() {
      continueRef.current = true;
      if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
      cancelRecordedTurn();
      const token = recordedTurnRef.current;

      void (async () => {
        const stream = await ensureCallStream();
        if (token !== recordedTurnRef.current || modeRef.current !== "voice") return;
        if (!stream) {
          giveUpOnVoice("denied");
          return;
        }

        const mime = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((candidate) =>
          MediaRecorder.isTypeSupported?.(candidate),
        );
        let recorder: MediaRecorder;
        try {
          recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        } catch {
          setNotice(t.micTrouble);
          setPhase("idle");
          return;
        }
        recorderRef.current = recorder;

        // Turn-taking by level — but the level meter is an ACCELERATOR, never
        // a gatekeeper. iOS starts an AudioContext created outside a tap
        // suspended, and a suspended analyser reads flat silence: gating the
        // transcription on it made the advisor deaf while the shopper talked
        // at a LISTENING orb. Whatever gets recorded is transcribed; the
        // meter's only job is ending the turn quickly after the shopper stops.
        const Ctor =
          window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!callCtxRef.current && Ctor) {
          try {
            callCtxRef.current = new Ctor();
          } catch {
            callCtxRef.current = null;
          }
        }
        const ctx = callCtxRef.current;
        let analyser: AnalyserNode | null = null;
        if (ctx) {
          try {
            if (ctx.state === "suspended") void ctx.resume().catch(() => {});
            const source = ctx.createMediaStreamSource(stream);
            analyser = ctx.createAnalyser();
            analyser.fftSize = 1024;
            source.connect(analyser);
            vadNodesRef.current = { source, analyser };
          } catch {
            analyser = null;
          }
        }

        const chunks: BlobPart[] = [];
        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size) chunks.push(event.data);
        };

        const startedAt = Date.now();
        let voiceAt = 0;
        let lastVoiceAt = 0;
        const bins = analyser ? new Uint8Array(analyser.fftSize) : null;

        const standDown = () => {
          logClient("mic-stand-down", { everHeard: everHeardRef.current, ios: IOS });
          silentRestartsRef.current = 0;
          setNotice(everHeardRef.current ? t.micIdle : t.micTrouble);
          setPhase("idle");
        };

        const finishTurn = () => {
          if (token !== recordedTurnRef.current) return;
          if (vadFrameRef.current) window.cancelAnimationFrame(vadFrameRef.current);
          vadFrameRef.current = null;
          recorderRef.current = null;
          recorder.onstop = () => {
            if (token !== recordedTurnRef.current || modeRef.current !== "voice") return;
            /*
             * Everything below reports what the microphone actually produced.
             *
             * The playback side has been instrumented since the silent-advisor
             * bug; the LISTENING side never was. So a shopper whose advisor
             * went quiet mid-conversation left five identical 200s in the
             * transcribe log and nothing else, and "they stopped talking" and
             * "the microphone captured silence" are indistinguishable from
             * outside the device. bytes and level tell them apart: a healthy
             * blob that transcribes to nothing is a dead audio route, a tiny
             * one is a recorder that never engaged, and a quiet meter with a
             * real blob is the known suspended-analyser case.
             */
            const ms = Date.now() - startedAt;
            if (!chunks.length) {
              logClient("mic-no-audio", { ms, level: Boolean(voiceAt), restarts: silentRestartsRef.current + 1 });
              silentRestartsRef.current += 1;
              if (silentRestartsRef.current > MAX_SILENT_RESTARTS) return standDown();
              restartTimerRef.current = window.setTimeout(recordTurn, 120);
              return;
            }
            const blob = new Blob(chunks, { type: mime ?? "audio/mp4" });
            setPhase("thinking");
            void fetch(`/api/voice-agent/transcribe?lang=${spokenLangRef.current === "ar" ? "ar" : "en"}`, {
              method: "POST",
              headers: { "content-type": blob.type },
              body: blob,
            })
              .then((response) => (response.ok ? response.json() : { text: "" }))
              .then((payload: { text?: string }) => {
                if (token !== recordedTurnRef.current || modeRef.current !== "voice") return;
                const text = (payload.text ?? "").trim();
                if (text) {
                  everHeardRef.current = true;
                  silentRestartsRef.current = 0;
                  void send(text);
                  return;
                }
                /*
                 * Real audio in, no words out. That is a cough or a passing
                 * car — or a capture route that has gone dead without saying
                 * so, which is what happens on iOS when playback interrupts
                 * the session. `muted` catches most of those in
                 * ensureCallStream; this catches the rest, because a stream
                 * that produced a full-size recording of nothing has earned
                 * being thrown away rather than recorded from four more
                 * times. The next attempt asks for a fresh one.
                 */
                if (blob.size > 2048) {
                  callStreamRef.current?.getTracks().forEach((track) => track.stop());
                  callStreamRef.current = null;
                }
                // Energy without words — noise, a cough. Listen again.
                logClient("mic-silent", {
                  bytes: blob.size,
                  ms,
                  level: Boolean(voiceAt),
                  restarts: silentRestartsRef.current + 1,
                  ios: IOS,
                });
                silentRestartsRef.current += 1;
                if (silentRestartsRef.current > MAX_SILENT_RESTARTS) return standDown();
                setPhase("listening");
                restartTimerRef.current = window.setTimeout(recordTurn, 120);
              })
              .catch(() => {
                if (token !== recordedTurnRef.current) return;
                setNotice(t.error);
                setPhase("idle");
              });
          };
          try {
            recorder.stop();
          } catch {
            // Already stopped: run the handler with whatever was captured.
            recorder.onstop?.(new Event("stop"));
          }
        };

        const tick = () => {
          if (token !== recordedTurnRef.current) return;
          const now = Date.now();
          if (analyser && bins) {
            analyser.getByteTimeDomainData(bins);
            let sum = 0;
            for (let i = 0; i < bins.length; i += 1) {
              const deviation = (bins[i] - 128) / 128;
              sum += deviation * deviation;
            }
            const rms = Math.sqrt(sum / bins.length);
            if (rms > 0.035) {
              if (!voiceAt) voiceAt = now;
              lastVoiceAt = now;
            }
          }
          // The meter ends a turn EARLY when it works; the timers end every
          // turn regardless, and the transcriber is the judge of whether
          // anything was said. A deaf meter costs a slower cadence, never
          // a lost turn.
          if (voiceAt && now - lastVoiceAt > 900) return finishTurn();
          if (!voiceAt && now - startedAt > 5000) return finishTurn();
          if (now - startedAt > 15000) return finishTurn();
          vadFrameRef.current = window.requestAnimationFrame(tick);
        };

        setPhase("listening");
        setNotice(null);
        stream.getAudioTracks().forEach((track) => {
          track.enabled = true;
        });
        try {
          recorder.start();
        } catch {
          setPhase("idle");
          return;
        }
        vadFrameRef.current = window.requestAnimationFrame(tick);
      })();
    },
    [ensureCallStream, cancelRecordedTurn, send, t.denied, t.micTrouble, t.micIdle, t.error],
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
      // iOS: the recorded call replaces on-device recognition wholesale.
      if (IOS && typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia)) {
        startRecordedTurn();
        return;
      }
      const w = window as unknown as {
        SpeechRecognition?: SpeechRecognitionCtor;
        webkitSpeechRecognition?: SpeechRecognitionCtor;
      };
      const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
      if (!Ctor) {
        giveUpOnVoice("unsupported");
        return;
      }

      // Asking to listen IS asking to keep listening. stop() clears this flag
      // and nothing ever set it back, so a shopper who stopped once and then
      // tapped the mic again got a single recognition session with no restart
      // behind it — the browser ends one at the first pause, onend saw the flag
      // was false, and the microphone went quiet mid-answer.
      continueRef.current = true;

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

      let lastInterim = "";

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
        if (live.trim()) lastInterim = live;
        if (live.trim() || settled.trim()) {
          heard = true;
          everHeardRef.current = true;
          silentRestartsRef.current = 0;
        }
        if (settled.trim()) {
          // The answer is in; stop before the browser restarts on its own.
          recognitionRef.current = null;
          lastMicActivityRef.current = Date.now();
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
          giveUpOnVoice("denied");
        }
        // "no-speech" and "aborted" are ordinary: onend decides what happens.
      };

      recognition.onend = () => {
        lastMicActivityRef.current = Date.now();
        if (recognitionRef.current !== recognition) return; // we ended it on purpose
        recognitionRef.current = null;
        if (!continueRef.current || modeRef.current !== "voice") {
          setPhase((current) => (current === "listening" ? "idle" : current));
          return;
        }
        // iOS Safari routinely ends recognition — above all on one-word answers
        // like "no" — without ever flagging a final result. The words arrived as
        // interims; dropping them and restarting looped the microphone forever
        // while the shopper repeated themselves at a listening orb. If it ended
        // with words heard and nothing settled, the words ARE the answer.
        const flush = lastInterim.trim();
        if (flush) {
          setInterim("");
          void send(flush);
          return;
        }
        silentRestartsRef.current = heard ? 0 : silentRestartsRef.current + 1;
        if (silentRestartsRef.current > MAX_SILENT_RESTARTS) {
          silentRestartsRef.current = 0;
          // Standing down without a word is indistinguishable from being
          // stuck. Say it — and say the right thing: a mic that has worked
          // all along and gone quiet is a thinking shopper, not a fault.
          setNotice(everHeardRef.current ? t.micIdle : t.micTrouble);
          setPhase("idle");
          return;
        }
        restartTimerRef.current = window.setTimeout(startListening, 120);
      };

      // iOS sometimes opens a session whose audio route never engages: the
      // orb says listening, the shopper talks, and no result of any kind ever
      // arrives. The give-up counter only ticks on onend, and a dead session
      // can sit open for a long time — so a session that has heard nothing at
      // all after 7 seconds is cycled by force. A genuinely quiet room hits
      // the same path and simply restarts, exactly as onend would.
      const watchdog = window.setTimeout(() => {
        if (recognitionRef.current === recognition && !heard) {
          recognitionRef.current = null;
          try {
            recognition.abort();
          } catch {
            // already gone
          }
          silentRestartsRef.current += 1;
          if (silentRestartsRef.current > MAX_SILENT_RESTARTS) {
            silentRestartsRef.current = 0;
            setNotice(everHeardRef.current ? t.micIdle : t.micTrouble);
            setPhase("idle");
            return;
          }
          restartTimerRef.current = window.setTimeout(startListening, 120);
        }
      }, 7000);
      const clearWatchdog = () => window.clearTimeout(watchdog);
      const previousOnEnd = recognition.onend;
      recognition.onend = () => {
        clearWatchdog();
        previousOnEnd?.();
      };

      recognitionRef.current = recognition;
      setPhase("listening");
      setNotice(null);
      // Only chime when the turn actually changes hands, not on every restart.
      if (silentRestartsRef.current === 0) orbRef.current?.cue();
      // The analyser stream is decoration — amplitude for the orb. On iOS,
      // holding it is what starves recognition of audio, so there the orb
      // gives up its light show and the microphone actually works.
      if (IOS) orbRef.current?.detachMic();
      else void orbRef.current?.attachMic();
      try {
        recognition.start();
      } catch {
        // iOS throws InvalidStateError when a session is started during an
        // audio-route transition — precisely the moment playback ends and we
        // want to listen again. Going idle here was a silent mid-conversation
        // stop with no message and no retry. One breath, then try again.
        recognitionRef.current = null;
        clearWatchdog();
        silentRestartsRef.current += 1;
        if (silentRestartsRef.current > MAX_SILENT_RESTARTS) {
          silentRestartsRef.current = 0;
          setNotice(everHeardRef.current ? t.micIdle : t.micTrouble);
          setPhase("idle");
          return;
        }
        restartTimerRef.current = window.setTimeout(startListening, 250);
      }
    },
    [lang, send, startRecordedTurn, t.noVoice, t.denied, t.micTrouble, t.micIdle],
  );

  function begin() {
    modeRef.current = "voice";
    // Must be created inside the tap gesture or browsers keep audio suspended.
    //
    // NOT on iOS. The orb's audio engine — hum, cue, analyser — keeps a Web
    // Audio output rendering for the whole session, and with one live, iOS
    // holds the page's media output at the DUCKED level it applies during
    // speech recognition: every line after the first listen played quiet.
    // On iOS the orb is CSS-only and the reply element owns the audio route.
    if (!IOS) {
      if (!orbRef.current) orbRef.current = createOrbAudio();
      orbRef.current.startHum();
    } else {
      // Open the call inside the tap, so the permission prompt appears now and
      // the first listen starts with the microphone already granted. The
      // analyser's context is created here too: iOS starts an AudioContext
      // made outside a user gesture SUSPENDED, and a suspended analyser reads
      // flat silence — the deaf turn-meter behind "still getting stuck".
      void ensureCallStream();
      if (!callCtxRef.current) {
        const Ctor =
          window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctor) {
          try {
            callCtxRef.current = new Ctor();
          } catch {
            callCtxRef.current = null;
          }
        }
      }
      if (callCtxRef.current?.state === "suspended") void callCtxRef.current.resume().catch(() => {});
    }
    continueRef.current = true;
    silentRestartsRef.current = 0;
    markStarted();
    setNotice(null);

    /*
     * On a product page, the first line names the product.
     *
     * It used to be GREETING[lang] unconditionally — "tell me what's bothering
     * your skin or hair" — so a shopper standing on one product was opened
     * with a general consultation and the conversation went where a general
     * consultation goes. The advisor knew the product; the first thing it said
     * did not.
     *
     * Taken from the opening turn, which has been in flight since the panel
     * mounted and whose audio was prewarmed the moment it landed. NOT awaited
     * here: this runs inside the tap, and iOS only lets audio start within the
     * gesture that asked for it — a round trip in the middle of that is how
     * the first word gets refused. If it has not arrived yet, the general
     * greeting still opens and the card and chips still name the product.
     */
    const greeting = (focusProduct && openingReplyRef.current) || GREETING[lang];
    setTurns([{ role: "agent", text: greeting }]);
    replayRef.current = [greeting];
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
      // The <video> does not exist yet — it renders with the "live" state. The
      // effect near the top attaches the stream once React has committed it.
      setCamera("live");
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
      // A keyboard is a keyboard. Saying "I couldn't read that clearly" to a
      // photo of one is untrue, and it is how shoppers testing the assistant
      // decide the whole thing is fake.
      if (payload.notSkin) {
        const line = t.cameraNotSkin(typeof payload.shows === "string" ? payload.shows : "");
        setTurns((current) => [...current, { role: "user", text: t.cameraShared }, { role: "agent", text: line }]);
        if (modeRef.current === "voice") {
          continueRef.current = true;
          void speak(line, () => listen());
        } else {
          setPhase("idle");
        }
        return;
      }
      // Skin, but too tightly framed to place. Ask — the body-area question
      // already exists and changes which products are even eligible.
      if (payload.needsContext) {
        const line = t.cameraWhichPart;
        setTurns((current) => [...current, { role: "user", text: t.cameraShared }, { role: "agent", text: line }]);
        if (modeRef.current === "voice") {
          continueRef.current = true;
          void speak(line, () => listen());
        } else {
          setPhase("idle");
        }
        return;
      }
      if (payload.usable === false) {
        setNotice(t.cameraUnusable);
        setPhase("idle");
        return;
      }

      // Somebody testing with a photo of their lunch is told it looks like
      // lunch — and asked for skin. "I couldn't read that clearly" was a lie.
      if (payload.notSkin) {
        const line = t.cameraNotSkin(typeof payload.shows === "string" ? payload.shows : "");
        setTurns((current) => [...current, { role: "user", text: t.cameraShared }, { role: "agent", text: line }]);
        if (modeRef.current === "voice") {
          continueRef.current = true;
          void speak(line, () => listen());
        } else setPhase("idle");
        return;
      }
      // Skin, but it could not place the body part: asking beats guessing.
      if (payload.needsContext) {
        const line = t.cameraWhichPart;
        setTurns((current) => [...current, { role: "user", text: t.cameraShared }, { role: "agent", text: line }]);
        if (modeRef.current === "voice") {
          continueRef.current = true;
          void speak(line, () => listen());
        } else setPhase("idle");
        return;
      }

      const observations: string[] = payload.observations ?? [];
      const concerns: string[] = payload.concerns ?? [];
      const seen = [...observations, ...concerns].filter(Boolean).join(", ");

      // A photo the model could describe nothing in used to blank mainConcern,
      // and an empty utterance with empty slots is precisely how the API is told
      // a session is starting — so it answered with the greeting and reset every
      // answer already given. That is the whole consultation, gone.
      if (!seen && !(slotsRef.current as Record<string, unknown>).mainConcern) {
        setNotice(t.cameraUnusable);
        setPhase("idle");
        return;
      }

      // A person who has just looked at your skin doesn't read a comma list —
      // and on voice this line was never spoken at all: the shopper heard
      // silence, then a question, as if the photo had gone nowhere.
      const looked = describePhoto(observations.length ? observations : concerns, lang);
      setTurns((current) => [
        ...current,
        { role: "user", text: t.cameraShared },
        ...(looked ? [{ role: "agent" as const, text: looked }] : []),
      ]);

      // Fold what was seen into the intake, then continue the same conversation
      // so the routine reflects it. Safety slots are untouched.
      const slots = slotsRef.current as Record<string, unknown>;
      slotsRef.current = {
        ...slots,
        sawPhoto: true,
        ...(seen ? { mainConcern: slots.mainConcern ? `${slots.mainConcern}. Visible: ${seen}` : seen } : {}),
        ...(payload.skinType && !slots.skinType ? { skinType: payload.skinType } : {}),
        // A photo of a hand routes to body products, not a face routine.
        ...(payload.bodyArea && !slots.bodyArea ? { bodyArea: payload.bodyArea } : {}),
      };
      // Taking a photo mid-conversation means the conversation continues. The
      // shopper almost certainly tapped the orb to stop talking before reaching
      // for the camera, which cleared this — so the advisor asked its next
      // question into a microphone it had never reopened.
      if (modeRef.current === "voice") {
        continueRef.current = true;
        // Say what was seen while the next turn's round trip runs UNDERNEATH
        // the speech. Serially this was look-line synthesis, then the network,
        // then the question — three waits in a row where one is audible.
        if (looked) {
          const pendingTurn = requestTurn("");
          void speak(looked, () => {
            pendingTurn.then(handleTurn).catch(() => {
              setNotice(t.error);
              setPhase("idle");
            });
          });
          return;
        }
      }
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
    markStarted();
    setDraft("");
    setNotice(null);
    void send(clean);
  }

  /**
   * Switch the advisor's language.
   *
   * Typing Arabic always worked — the server detects the script per utterance.
   * SPEAKING it did not: recognition starts in en-US, an English recogniser
   * mangles Arabic into Latin junk, and the script detection downstream never
   * sees Arabic at all. The recogniser has to be told what to listen for, and
   * this is where the shopper tells it.
   */
  function switchLang(next: Lang) {
    if (next === lang) return;
    setLang(next);
    spokenLangRef.current = next;
    // A live recognition session is bound to the old locale; restart it in the
    // new one rather than leaving it listening for the wrong language.
    if (phase === "listening") {
      recognitionRef.current?.abort();
      cancelRecordedTurn();
      restartTimerRef.current = window.setTimeout(() => listen(), 150);
    }
  }

  function switchMode(next: Mode) {
    modeRef.current = next;
    setMode(next);
    if (next === "chat") {
      // Leaving voice: release the mic and silence playback.
      continueRef.current = false;
      recognitionRef.current?.abort();
      releaseCall();
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
    releaseCall();
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
    // Ids, not URLs: the cart endpoint resolves the store from its own
    // catalogue rather than trusting a link handed to it in a query string.
    const payload = items.map((p) => ({ id: p.id, url: p.url }));
    return `/api/cart/cicabelle?items=${encodeURIComponent(JSON.stringify(payload))}`;
  }

  const busy = phase === "thinking";
  const active = phase !== "idle";
  const statusLabel =
    phase === "listening" ? t.listening : phase === "thinking" ? t.thinking : phase === "speaking" ? t.speaking : started ? t.replay : t.start;

  return (
    <div className={`va va-${phase}${lang === "ar" ? " va-rtl" : ""}`} dir={lang === "ar" ? "rtl" : "ltr"}>
     {/* The call bar follows the shopper wherever they scroll: who is talking
         and what is being said, without climbing back up to the orb. */}
     {started && mode === "voice" && active ? (
       <div className={`va-callbar va-callbar-${phase}`} aria-live="polite">
         <span className="va-callbar-who">
           {phase === "listening" ? t.youSpeaking : phase === "speaking" ? t.advisorSpeaking : t.thinking}
         </span>
         <span className="va-callbar-text">
           {phase === "listening" ? interim || "…" : phase === "speaking" ? speakingLine : "…"}
         </span>
         {phase === "listening" && replayRef.current.length ? (
           <button
             type="button"
             className="va-callbar-replay"
             onClick={() => speakSequence(replayRef.current, () => listen())}
           >
             <RotateCcw size={12} aria-hidden="true" />
             {t.hearAgain}
           </button>
         ) : null}
       </div>
     ) : null}
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

      <div className="va-langs" role="group" aria-label="Language">
        <button
          type="button"
          className={lang === "en" ? "va-lang va-lang-on" : "va-lang"}
          aria-pressed={lang === "en"}
          onClick={() => switchLang("en")}
        >
          EN
        </button>
        <button
          type="button"
          className={lang === "ar" ? "va-lang va-lang-on" : "va-lang"}
          aria-pressed={lang === "ar"}
          onClick={() => switchLang("ar")}
          lang="ar"
        >
          عربي
        </button>
      </div>

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
      <aside
        ref={routineRef}
        className={products.length ? "va-side va-side-picks va-side-routine" : "va-side va-side-picks"}
      >
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
                          // Shopify's CDN and several merchant hosts refuse a
                          // request that carries a referrer from another domain,
                          // which is exactly what the widget is. Sending none
                          // gets the image rather than a 403.
                          referrerPolicy="no-referrer"
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
                        {product.expectedResults ? (
                          <p className="va-rx-timing">
                            <Clock size={12} aria-hidden />
                            <span>{product.expectedResults}</span>
                          </p>
                        ) : null}
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
            {/*
              The product the shopper is standing in front of, above the things
              we can say about it — the shape of the panel they already know
              from every other advisor on a product page.
            */}
            {focus ? (
              <article className="va-focus">
                {focus.imageUrl ? (
                  <img
                    src={focus.imageUrl}
                    alt={`${focus.brand ? `${focus.brand} ` : ""}${focus.name}`}
                    // Shopify's CDN refuses a request carrying a referrer from
                    // another domain, which is exactly what an embedded panel is.
                    referrerPolicy="no-referrer"
                    onError={(event) => {
                      event.currentTarget.classList.add("va-rx-noimg");
                      event.currentTarget.removeAttribute("src");
                      event.currentTarget.alt = "";
                    }}
                  />
                ) : (
                  <div className="va-rx-noimg" />
                )}
                <div className="va-focus-body">
                  {focus.brand ? <span className="va-focus-brand">{focus.brand}</span> : null}
                  <strong>{focus.name}</strong>
                  <span className="va-price">
                    {focus.currency} {focus.price}
                  </span>
                  <div className="va-focus-actions">
                    <button type="button" className="va-focus-add" onClick={() => addToParentCart(focus)}>
                      <ShoppingCart size={14} />
                      {t.addToBag}
                    </button>
                    <a className="va-focus-view" href={focus.url} target="_blank" rel="noreferrer">
                      <ExternalLink size={13} />
                      <span className="va-sr">{t.view}</span>
                    </a>
                  </div>
                </div>
              </article>
            ) : null}
            {/*
              What the server offered for this product, when it offered
              anything. Those chips are computed from the fields we actually
              hold for it, so they are worth tapping; the generic prompts are
              the fallback for a conversation that is not about one product.
            */}
            <p className="va-side-title">{suggestions.length ? t.aboutThis : t.quickPicks}</p>
            <div className="va-picks">
              {suggestions.length
                ? suggestions.map((chip) => (
                    <button
                      key={chip.ask}
                      type="button"
                      className="va-pick"
                      onClick={() => {
                        // The label is what the shopper said; the intent is
                        // what the server acts on. Sending only the words
                        // would put a button we drew through the classifier.
                        modeRef.current = "chat";
                        setMode("chat");
                        markStarted();
                        setNotice(null);
                        void send(chip.label, chip.ask);
                      }}
                    >
                      {chip.label}
                    </button>
                  ))
                : PROMPTS[lang].slice(0, 4).map((prompt) => (
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

      {/*
        Pinned, like the call bar, and for the same reason it is: the shopper
        scrolls down to read the transcript, so anything in the flow of the
        panel is off-screen exactly when it matters.

        Putting it under the orb was the previous attempt at this, and this
        screenshot is what that looks like once a conversation has a few turns
        in it — the escape-hatch link visible at the bottom of the page, and
        the sentence explaining why the advisor had gone quiet scrolled out of
        sight above. It never competes with the call bar: that one renders only
        while a call is active, and a notice means it is not.
      */}
      {notice ? (
        <div className="va-alert" role="status">
          <span>{notice}</span>
          <a href="/live-consultation-1" target="_blank" rel="noreferrer">
            {t.fallback}
          </a>
        </div>
      ) : null}

    </div>
  );
}
