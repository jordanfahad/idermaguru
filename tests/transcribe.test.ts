import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../src/app/api/voice-agent/transcribe/route";

/**
 * iOS turns are recorded and transcribed here instead of using Apple's
 * on-device recognition — the component that kept getting stuck. The route's
 * failure modes matter: the client falls back to a re-listen, never a crash.
 */

const request = (body: ArrayBuffer, type = "audio/mp4", lang = "en") =>
  new Request(`http://localhost/api/voice-agent/transcribe?lang=${lang}`, {
    method: "POST",
    headers: { "content-type": type },
    body,
  });

beforeEach(() => {
  vi.stubEnv("OPENAI_COMPATIBLE_API_KEY", "test-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the transcribe endpoint", () => {
  it("declines politely when no key is configured", async () => {
    vi.stubEnv("OPENAI_COMPATIBLE_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    const response = await POST(request(new ArrayBuffer(4096)));
    expect(response.status).toBe(503);
  });

  it("answers a click-length body instantly, without an upstream call", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const response = await POST(request(new ArrayBuffer(100)));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: "" });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("returns the transcription text, with the language hint forwarded", async () => {
    let sentForm: FormData | null = null;
    vi.stubGlobal("fetch", async (_url: unknown, init?: { body?: unknown }) => {
      sentForm = init?.body as FormData;
      return new Response(JSON.stringify({ text: " I have dandruff " }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const response = await POST(request(new ArrayBuffer(4096), "audio/mp4", "en"));
    expect(await response.json()).toEqual({ text: "I have dandruff" });
    expect(sentForm!.get("language")).toBe("en");
    expect((sentForm!.get("file") as File).type).toContain("audio/mp4");
  });

  it("reports an upstream failure as unavailable, not as words", async () => {
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 500 }));
    const response = await POST(request(new ArrayBuffer(4096)));
    expect(response.status).toBe(502);
  });
});
