import { afterEach, describe, expect, it } from "vitest";
import {
  FallbackLLMProvider,
  ProviderUnavailableError,
  getLLMProvider,
  type AssistantMessageContext,
  type LLMProvider,
} from "../src/services/llm/provider";
import type { IntakeProfileInput, RoutineRecommendation, SafetyTriage } from "../src/domain/skincare";

const allowed: SafetyTriage = { level: "LOW", reasons: [], recommendationAllowed: true };
const ctx: AssistantMessageContext = {
  messages: [{ role: "user", content: "hi" }],
  approvedProducts: [],
  safety: allowed,
};

function makeProvider(id: string, opts: { unavailable?: boolean; throwOther?: boolean } = {}): LLMProvider {
  const fail = () => {
    if (opts.throwOther) throw new Error(`boom from ${id}`);
    if (opts.unavailable) throw new ProviderUnavailableError(id, 429);
  };
  return {
    id,
    async generateAssistantMessage() {
      fail();
      return `assistant:${id}`;
    },
    async summarizeIntake() {
      fail();
      return { mainConcern: id };
    },
    async explainRecommendations() {
      fail();
      return `explain:${id}`;
    },
    async analyzeImageOptional() {
      fail();
      return `image:${id}`;
    },
  };
}

describe("FallbackLLMProvider routing (OpenAI -> Claude -> mock)", () => {
  it("uses the primary provider when it succeeds", async () => {
    const provider = new FallbackLLMProvider([makeProvider("openai"), makeProvider("anthropic"), makeProvider("mock")]);
    expect(await provider.generateAssistantMessage(ctx)).toBe("assistant:openai");
    expect(provider.lastUsedId).toBe("openai");
  });

  it("falls back to Claude when OpenAI is out of tokens", async () => {
    const provider = new FallbackLLMProvider([
      makeProvider("openai", { unavailable: true }),
      makeProvider("anthropic"),
      makeProvider("mock"),
    ]);
    const explanation = await provider.explainRecommendations(
      {} as IntakeProfileInput,
      {} as RoutineRecommendation,
      allowed,
    );
    expect(explanation).toBe("explain:anthropic");
    expect(provider.lastUsedId).toBe("anthropic");
  });

  it("falls through to the offline mock when both AI providers are unavailable", async () => {
    const provider = new FallbackLLMProvider([
      makeProvider("openai", { unavailable: true }),
      makeProvider("anthropic", { unavailable: true }),
      makeProvider("mock"),
    ]);
    expect(await provider.generateAssistantMessage(ctx)).toBe("assistant:mock");
    expect(provider.lastUsedId).toBe("mock");
  });

  it("does not swallow non-availability errors (real bugs surface)", async () => {
    const provider = new FallbackLLMProvider([makeProvider("openai", { throwOther: true }), makeProvider("anthropic")]);
    await expect(provider.generateAssistantMessage(ctx)).rejects.toThrow("boom from openai");
  });
});

describe("getLLMProvider", () => {
  const snapshot = {
    LLM_PROVIDER: process.env.LLM_PROVIDER,
    OPENAI_COMPATIBLE_API_KEY: process.env.OPENAI_COMPATIBLE_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(snapshot)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("returns the offline mock when forced via LLM_PROVIDER=mock", () => {
    process.env.LLM_PROVIDER = "mock";
    expect(getLLMProvider().id).toBe("mock");
  });

  it("returns the offline mock when no provider keys are configured", () => {
    delete process.env.LLM_PROVIDER;
    delete process.env.OPENAI_COMPATIBLE_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    expect(getLLMProvider().id).toBe("mock");
  });
});
