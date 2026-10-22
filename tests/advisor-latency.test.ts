import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// All measurements execute the real routes with local data. No database or
// paid provider is reachable, even when the caller has credentials configured.
vi.mock("@/server/db", () => ({ getPrisma: () => null, getTenantPrisma: () => null }));

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const rounded = (ms: number) => Math.round(ms * 10) / 10;
const request = (body: Record<string, unknown>) => new Request("http://localhost/api/voice-agent", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("LLM_PROVIDER", "mock");
  vi.stubEnv("ADVISOR_RICH_REPLIES", "0");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("OPENAI_COMPATIBLE_API_KEY", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Network disabled in latency tests"); }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("advisor latency with local dependencies", () => {
  it("measures the opening and typed turn without provider calls", async () => {
    const loadAt = performance.now();
    const { POST } = await import("../src/app/api/voice-agent/route");
    const importMs = performance.now() - loadAt;
    for (const language of ["en", "ar"]) {
      const start = performance.now();
      const response = await POST(request({ product: "prod_gentle_cleanser", language }));
      const payload = await response.json();
      expect(response.status).toBe(200);
      expect(payload.focus?.id).toBe("prod_gentle_cleanser");
      console.log(JSON.stringify({ measurement: "opening", language, ms: rounded(performance.now() - start), importMs: rounded(importMs), external: "disabled" }));
    }
    const start = performance.now();
    const response = await POST(request({ utterance: "I have acne" }));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.phase).toBe("asking");
    expect(payload.slots.mainConcern).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
    console.log(JSON.stringify({ measurement: "typed", ms: rounded(performance.now() - start), external: "disabled" }));
  });

  it("measures a recorded turn and exposes the full-blob wait", async () => {
    vi.stubEnv("OPENAI_COMPATIBLE_API_KEY", "offline-test-key");
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/audio/transcriptions")) {
        await pause(180);
        return Response.json({ text: "oily" });
      }
      if (String(url).endsWith("/audio/speech")) {
        await pause(120);
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3]));
            setTimeout(() => {
              controller.enqueue(new Uint8Array([4, 5, 6]));
              controller.close();
            }, 280);
          },
        }), { headers: { "content-type": "audio/mpeg" } });
      }
      throw new Error("Unexpected network request in latency test");
    }));
    const { POST: transcribe } = await import("../src/app/api/voice-agent/transcribe/route");
    const { POST: turn } = await import("../src/app/api/voice-agent/route");
    const { POST: speech } = await import("../src/app/api/voice-agent/speech/route");
    const start = performance.now();
    const transcript = await transcribe(new Request("http://localhost/api/voice-agent/transcribe?lang=en", {
      method: "POST", headers: { "content-type": "audio/mp4" }, body: new Uint8Array(2048),
    }));
    expect(transcript.status).toBe(200);
    const { text } = await transcript.json();
    const transcribedAt = performance.now();
    const reply = await turn(request({ utterance: text, slots: { mainConcern: "acne", askedSkinType: true } }));
    expect(reply.status).toBe(200);
    const payload = await reply.json();
    expect(payload.slots.skinType).toBe("oily");
    const replyAt = performance.now();
    // The client preloads parts in parallel, then waits for blob() before play().
    const parts: string[] = payload.speech?.length ? payload.speech : [payload.reply];
    let firstByteAt = 0;
    await Promise.all(parts.map(async (part, index) => {
      const response = await speech(new Request("http://localhost/api/voice-agent/speech", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: part, language: "en" }),
      }));
      expect(response.status).toBe(200);
      if (index === 0) firstByteAt = performance.now();
      expect((await response.blob()).size).toBe(6);
    }));
    const readyAt = performance.now();
    console.log(JSON.stringify({
      measurement: "recorded-turn", upstream: "scripted delays, not live providers",
      injectedSttMs: 180, injectedTtsHeadersMs: 120, injectedTtsBodyMs: 280,
      transcribeMs: rounded(transcribedAt - start), turnMs: rounded(replyAt - transcribedAt),
      speechHeadersMs: rounded(firstByteAt - replyAt), speechBlobMs: rounded(readyAt - replyAt),
      audioReadyMs: rounded(readyAt - start),
      excludes: "recording, silence detection, transport, iOS settle, decoding and playback",
    }));
  });

  it("bounds two stalled opening enrichments together", async () => {
    vi.stubEnv("ADVISOR_RICH_REPLIES", "1");
    const llm = await import("../src/services/llm/provider");
    const provider = llm.getLLMProvider();
    const summarize = vi.fn(() => new Promise<never>(() => {}));
    const empathise = vi.fn(() => new Promise<never>(() => {}));
    vi.spyOn(llm, "getLLMProvider").mockReturnValue({ ...provider, id: "timing-double",
      readAnswer: provider.readAnswer.bind(provider),
      analyzeImageOptional: provider.analyzeImageOptional.bind(provider),
      explainRecommendations: provider.explainRecommendations.bind(provider),
      summarizeIntake: summarize, generateAssistantMessage: empathise,
    });
    const { POST } = await import("../src/app/api/voice-agent/route");
    const start = performance.now();
    const response = await POST(request({ utterance: "I have acne" }));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.phase).toBe("asking");
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(empathise).toHaveBeenCalledTimes(1);
    console.log(JSON.stringify({ measurement: "stalled-opening-enrichments", ms: rounded(performance.now() - start), budgetMs: 800, calls: 2, upstream: "unresolved local doubles" }));
  });

  it("measures an unrecognized answer without assuming it reaches the reader", async () => {
    const llm = await import("../src/services/llm/provider");
    const provider = llm.getLLMProvider();
    const read = vi.spyOn(provider, "readAnswer").mockImplementation(() => new Promise<never>(() => {}));
    vi.spyOn(llm, "getLLMProvider").mockReturnValue(provider);
    const { POST } = await import("../src/app/api/voice-agent/route");
    const start = performance.now();
    const response = await POST(request({ utterance: "my skin is puzzling", slots: { mainConcern: "acne", askedSkinType: true } }));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.phase).toBe("asking");
    expect(payload.slots.misses).toBe(1);
    console.log(JSON.stringify({ measurement: "unrecognized-skin-answer", ms: rounded(performance.now() - start), readerCalls: read.mock.calls.length, misses: payload.slots.misses, upstream: "unresolved local double if called" }));
  });

  it.each([false, true])("measures routine stock and explanation waits, rich replies=%s", async (rich) => {
    vi.stubEnv("ADVISOR_RICH_REPLIES", rich ? "1" : "0");
    const llm = await import("../src/services/llm/provider");
    const provider = llm.getLLMProvider();
    Object.defineProperty(provider, "id", { value: "timing-double" });
    const explain = vi.spyOn(provider, "explainRecommendations").mockImplementation(() => new Promise<never>(() => {}));
    vi.spyOn(llm, "getLLMProvider").mockReturnValue(provider);
    // A silent storefront: the real stock service must return at its budget.
    vi.stubGlobal("fetch", vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("Simulated stock timeout")), { once: true });
    })));
    const { POST } = await import("../src/app/api/voice-agent/route");
    const start = performance.now();
    const response = await POST(request({ slots: {
      mainConcern: "acne", bodyArea: "face", skinType: "oily",
      pregnantOrBreastfeeding: false, allergies: [],
    } }));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.phase).toBe("result");
    expect(payload.products.length).toBeGreaterThan(0);
    expect(fetch).toHaveBeenCalled();
    expect(explain).toHaveBeenCalledTimes(rich ? 1 : 0);
    console.log(JSON.stringify({ measurement: "stalled-routine-dependencies", rich, ms: rounded(performance.now() - start), stockBudgetMs: 500, explanationBudgetMs: rich ? 1300 : 0, upstream: "unresolved local doubles" }));
  });
});
