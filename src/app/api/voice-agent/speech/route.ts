import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, parseJson, RequestValidationError } from "../../_shared";

export const runtime = "nodejs";

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
  "carry a little extra colour.";

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
async function synthesise(text: string, language?: "en" | "ar") {
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
  const cacheKey = `${model}:${voice}:${language ?? "en"}:${text}`;
  const cached = speechCache.get(cacheKey);
  if (cached) {
    return new NextResponse(cached.slice(0), {
      status: 200,
      headers: {
        "content-type": "audio/mpeg",
        // The audio for a given line never changes; let the browser keep it.
        "cache-control": "private, max-age=3600",
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

    // Cache the fixed lines only. Personalised results are said once, so
    // keeping them would grow the map without ever being reused.
    if (text.length > 200) {
      return new NextResponse(response.body, {
        status: 200,
        headers: { "content-type": "audio/mpeg", "cache-control": "no-store", "x-cache": "miss" },
      });
    }

    const [toClient, toCache] = response.body.tee();
    void collect(toCache)
      .then((audio) => {
        if (speechCache.size >= 64) speechCache.delete(speechCache.keys().next().value as string);
        speechCache.set(cacheKey, audio);
      })
      .catch(() => {
        // A failed cache fill just means the next shopper re-synthesises it.
      });

    return new NextResponse(toClient, {
      status: 200,
      headers: {
        "content-type": "audio/mpeg",
        "cache-control": "private, max-age=3600",
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
  let input: z.infer<typeof SpeechSchema>;
  try {
    input = await parseJson(request, SpeechSchema);
  } catch (error) {
    if (error instanceof RequestValidationError) return jsonError(error.message);
    throw error;
  }
  return synthesise(input.text, input.language);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const text = url.searchParams.get("text")?.trim() ?? "";
  const language = url.searchParams.get("lang") === "ar" ? "ar" : "en";
  if (!text || text.length > 400) return jsonError("A short line of text is required.");
  return synthesise(text, language);
}
