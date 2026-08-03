import { NextResponse } from "next/server";
import { z } from "zod";
import { DYNAMIC_SPEECH, rateLimit, SCRIPTED_SPEECH } from "@/lib/rate-limit";
import { fixedLines } from "@/services/voice-agent";
import { jsonError, parseJson, RequestValidationError } from "../../_shared";

export const runtime = "nodejs";

/**
 * The only lines GET will speak — the advisor's own script, the same list the
 * client uses to decide which door to knock on. Membership is the gate, not
 * length: a 400-character cap here silently refused the two LONGEST lines in
 * the product (the intimate-area answer and the clinician referral), and on
 * iPhone the browser-voice fallback is mute outside a tap — so the advisor's
 * most sensitive answers played as dead air with "Advisor speaking" showing.
 */
const SCRIPTED = new Set([...fixedLines("en"), ...fixedLines("ar")].map((line) => line.trim()));

/**
 * Per-instance cache of synthesised lines. The interview asks the same handful
 * of questions in every session, so after the first shopper they play back
 * without a round trip to the speech API.
 */
const speechCache = new Map<string, ArrayBuffer>();

const SpeechSchema = z.object({
  text: z.string().min(1).max(1200),
  language: z.enum(["en", "ar"]).optional(),
});

/**
 * How the advisor should sound. The old direction ("calm and unhurried") is
 * exactly what made her read as flat and slow, so this asks for the opposite:
 * bright, quick, audibly smiling. Overridable per merchant.
 */
const DEFAULT_INSTRUCTIONS =
  "You are a bright, genuinely enthusiastic beauty advisor on the floor of a Gulf skincare boutique. " +
  "Sound like you are pleased to be helping: warm, smiling, energetic, with real lift at the end of a " +
  "question. Keep the pace brisk and conversational, the way you would talk to a friend at the counter — " +
  "quick, natural, never flat, never a robot reading a script. Let the important word in each sentence " +
  "carry a little extra colour. Project your voice at a full, confident, consistent volume from the very " +
  "first word to the very last — never trail off, never go quiet at the ends of sentences, and keep the " +
  "same punchy energy in every line of the conversation.";

const ARABIC_NOTE =
  " The text is Arabic: speak it as a native Gulf Arabic speaker would, with the same warmth and energy.";

function instructionsFor(language?: "en" | "ar") {
  const base = process.env.OPENAI_TTS_INSTRUCTIONS ?? DEFAULT_INSTRUCTIONS;
  return language === "ar" ? `${base}${ARABIC_NOTE}` : base;
}

/**
 * Synthesises one line, streaming the audio back as it arrives.
 *
 * Waiting for the whole MP3 before the first sound was the bulk of the pause
 * between turns, so the upstream body is piped straight to the browser and a
 * tee'd copy fills the cache in the background.
 */
/**
 * How long a line the browser and the CDN may keep.
 *
 * The text is in the URL, so a URL identifies exactly one recording and that
 * recording never changes — which is what makes `immutable` safe. It also means
 * an edited line is a new URL, so nothing has to be purged on deploy.
 *
 * This used to be `private`, which tells Vercel's CDN not to store it at all.
 * Every shopper in every session therefore reached the function in Mumbai for
 * audio that is identical for all of them. Public caching puts it on a point of
 * presence near the shopper instead — no function, no speech API, no Mumbai.
 */
const FOREVER = "public, max-age=31536000, immutable";

async function synthesise(text: string, language: "en" | "ar" | undefined, cacheable: boolean) {
  const apiKey = process.env.OPENAI_COMPATIBLE_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Not an error state: the client speaks with the browser voice instead.
    return jsonError("Natural speech is not configured.", 503);
  }

  const model = process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts";
  const voice = process.env.OPENAI_TTS_VOICE ?? "coral";
  const instructions = instructionsFor(language);

  // The scripted questions repeat in every single session, so synthesising them
  // again each time is the main source of the pause before the agent speaks.
  // The instructions are part of the recording's identity: without them in the
  // key, a delivery change kept serving the old read from this map.
  const cacheKey = `${model}:${voice}:${language ?? "en"}:${instructions.length}:${text}`;
  const cached = speechCache.get(cacheKey);
  if (cached) {
    return new NextResponse(cached.slice(0), {
      status: 200,
      headers: {
        "content-type": "audio/mpeg",
        "cache-control": cacheable ? FOREVER : "no-store",
        "x-cache": "hit",
      },
    });
  }

  try {
    const body: Record<string, unknown> = {
      model,
      voice,
      input: text,
      response_format: "mp3",
      instructions,
    };
    // Only sent when a merchant asks for it: an unsupported field would 400 and
    // drop the whole session to the robotic browser voice.
    const speed = Number(process.env.OPENAI_TTS_SPEED);
    if (Number.isFinite(speed) && speed > 0) body.speed = speed;

    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => "");
      console.error("TTS upstream failed", response.status, detail.slice(0, 300));
      return jsonError("Speech synthesis unavailable.", 502);
    }

    // Cache the fixed lines only — but decided by which door the request came
    // through, not by how long the line is. A 200-character rule meant the
    // longest fixed lines were the ones never cached: the referral, the
    // emergency message, the intimate-area answer. Those are said to a shopper
    // who is worried, and they were the slowest lines in the product.
    if (!cacheable) {
      return new NextResponse(response.body, {
        status: 200,
        headers: { "content-type": "audio/mpeg", "cache-control": "no-store", "x-cache": "miss" },
      });
    }

    const [toClient, toCache] = response.body.tee();
    void collect(toCache)
      .then((audio) => {
        // 83 fixed lines per language, so 64 evicted the set it exists to hold.
        if (speechCache.size >= 256) speechCache.delete(speechCache.keys().next().value as string);
        speechCache.set(cacheKey, audio);
      })
      .catch(() => {
        // A failed cache fill just means the next shopper re-synthesises it.
      });

    return new NextResponse(toClient, {
      status: 200,
      headers: {
        "content-type": "audio/mpeg",
        "cache-control": FOREVER,
        "x-cache": "miss",
      },
    });
  } catch (error) {
    console.error("TTS request failed", error);
    return jsonError("Speech synthesis unavailable.", 502);
  }
}

async function collect(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged.buffer;
}

/**
 * Natural text-to-speech for the voice concierge.
 *
 * POST carries anything personalised (the routine summary), so the shopper's
 * own words never end up in a URL or a server log. GET exists for the fixed
 * interview lines, which the client warms on page load so the very first tap
 * plays instantly instead of waiting on the speech API.
 *
 * Env:
 *   OPENAI_COMPATIBLE_API_KEY  (or OPENAI_API_KEY)  - required for natural voice
 *   OPENAI_TTS_MODEL           default gpt-4o-mini-tts
 *   OPENAI_TTS_VOICE           default "coral"
 *   OPENAI_TTS_INSTRUCTIONS    override the delivery direction
 *   OPENAI_TTS_SPEED           optional playback rate multiplier
 */
export async function POST(request: Request) {
  // Arbitrary text, synthesised fresh every time: this is the door that makes
  // the merchant's speech credit a public utility. A refusal costs the shopper
  // the natural voice for that line, not the line — speak() falls through to
  // the browser voice on any non-ok response.
  const limited = rateLimit(request, DYNAMIC_SPEECH);
  if (limited) return limited;

  let input: z.infer<typeof SpeechSchema>;
  try {
    input = await parseJson(request, SpeechSchema);
  } catch (error) {
    if (error instanceof RequestValidationError) return jsonError(error.message);
    throw error;
  }
  // POST carries whatever a model wrote, so it is never cached anywhere.
  return synthesise(input.text, input.language, false);
}

export async function GET(request: Request) {
  // Counted before the scripted-line check, so hammering this with junk text
  // costs a caller their allowance rather than an unlimited supply of 400s.
  const limited = rateLimit(request, SCRIPTED_SPEECH);
  if (limited) return limited;

  const url = new URL(request.url);
  const text = url.searchParams.get("text")?.trim() ?? "";
  const language = url.searchParams.get("lang") === "ar" ? "ar" : "en";
  // Anything that is not the advisor's own script goes through POST — which
  // also keeps arbitrary text out of the CDN's forever-cache.
  if (!text || !SCRIPTED.has(text)) return jsonError("GET speaks only the advisor's scripted lines.");
  return synthesise(text, language, true);
}
