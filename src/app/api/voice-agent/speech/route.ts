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
 * Natural text-to-speech for the voice concierge.
 *
 * Uses the OpenAI speech API when a key is configured and streams the audio
 * back to the browser. With no key it returns 503 and the client falls back to
 * the browser's built-in speechSynthesis, so the agent always talks.
 *
 * Env:
 *   OPENAI_COMPATIBLE_API_KEY  (or OPENAI_API_KEY)  - required for natural voice
 *   OPENAI_TTS_MODEL           default gpt-4o-mini-tts
 *   OPENAI_TTS_VOICE           default "shimmer"
 */
export async function POST(request: Request) {
  let input: z.infer<typeof SpeechSchema>;
  try {
    input = await parseJson(request, SpeechSchema);
  } catch (error) {
    if (error instanceof RequestValidationError) return jsonError(error.message);
    throw error;
  }

  const apiKey = process.env.OPENAI_COMPATIBLE_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Not an error state: the client speaks with the browser voice instead.
    return jsonError("Natural speech is not configured.", 503);
  }

  const model = process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts";
  const voice = process.env.OPENAI_TTS_VOICE ?? "shimmer";

  // The scripted questions repeat in every single session, so synthesising them
  // again each time is the main source of the pause before the agent speaks.
  const cacheKey = `${model}:${voice}:${input.text}`;
  const cached = speechCache.get(cacheKey);
  if (cached) {
    return new NextResponse(cached.slice(0), {
      status: 200,
      headers: { "content-type": "audio/mpeg", "cache-control": "no-store", "x-cache": "hit" },
    });
  }

  try {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        voice,
        input: input.text,
        response_format: "mp3",
        instructions:
          "You are a warm, calm skincare advisor in a Gulf beauty store. Speak naturally and unhurried, " +
          "with genuine warmth. Never sound like a robot reading a list.",
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error("TTS upstream failed", response.status, detail.slice(0, 300));
      return jsonError("Speech synthesis unavailable.", 502);
    }

    const audio = await response.arrayBuffer();
    // Cache the fixed lines only. Personalised results are said once, so
    // keeping them would grow the map without ever being reused.
    if (input.text.length <= 200) {
      if (speechCache.size >= 64) speechCache.delete(speechCache.keys().next().value as string);
      speechCache.set(cacheKey, audio);
    }
    return new NextResponse(audio.slice(0), {
      status: 200,
      headers: {
        "content-type": "audio/mpeg",
        "cache-control": "no-store",
        "x-cache": "miss",
      },
    });
  } catch (error) {
    console.error("TTS request failed", error);
    return jsonError("Speech synthesis unavailable.", 502);
  }
}
