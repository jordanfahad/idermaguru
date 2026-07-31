import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Server-side speech-to-text for the voice concierge.
 *
 * iOS Safari's built-in speech recognition was the least reliable part of the
 * whole product: sessions that never delivered a result, short answers that
 * never finalised, and an audio session that ducked playback around every
 * listen. On iOS the client now records each turn like a call and sends the
 * audio here instead — the same transcription approach the serious voice
 * products use, and one we can actually observe and fix.
 *
 * The body is the recorded audio (audio/mp4 from Safari, audio/webm from
 * Chromium); `lang` is a hint, never a constraint. The audio is transcribed
 * and discarded — nothing is stored.
 *
 * Env:
 *   OPENAI_COMPATIBLE_API_KEY (or OPENAI_API_KEY) - required
 *   OPENAI_STT_MODEL          default gpt-4o-mini-transcribe
 */
export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_COMPATIBLE_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Transcription is not configured." }, { status: 503 });
  }

  const audio = await request.arrayBuffer();
  // Anything under ~1KB is a click, not speech — answer instantly.
  if (!audio || audio.byteLength < 1024) return NextResponse.json({ text: "" });
  if (audio.byteLength > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "Recording too large." }, { status: 413 });
  }

  const contentType = request.headers.get("content-type") ?? "audio/mp4";
  const extension = contentType.includes("webm") ? "webm" : contentType.includes("ogg") ? "ogg" : "mp4";
  const lang = new URL(request.url).searchParams.get("lang");

  const form = new FormData();
  form.append("file", new Blob([audio], { type: contentType }), `turn.${extension}`);
  form.append("model", process.env.OPENAI_STT_MODEL ?? "gpt-4o-mini-transcribe");
  form.append("response_format", "json");
  // A hint sharpens short answers ("no", "لا"); omitted when unknown so the
  // model can hear whichever language the shopper actually spoke.
  if (lang === "en" || lang === "ar") form.append("language", lang);

  try {
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error("STT upstream failed", response.status, detail.slice(0, 300));
      return NextResponse.json({ error: "Transcription unavailable." }, { status: 502 });
    }
    const payload = (await response.json()) as { text?: unknown };
    const text = typeof payload.text === "string" ? payload.text.trim() : "";
    return NextResponse.json({ text });
  } catch (error) {
    console.error("STT request failed", error);
    return NextResponse.json({ error: "Transcription unavailable." }, { status: 502 });
  }
}
