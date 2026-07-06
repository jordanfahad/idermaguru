import Anthropic from "@anthropic-ai/sdk";
import {
  ESCALATION_MESSAGE,
  type IntakeProfileInput,
  type ProductCatalogItem,
  type RoutineRecommendation,
  type SafetyTriage,
} from "@/domain/skincare";

export type AssistantMessageContext = {
  messages: { role: "user" | "assistant" | "system"; content: string }[];
  approvedProducts: ProductCatalogItem[];
  safety: SafetyTriage;
};

export type LLMProvider = {
  /** Stable identifier for the concrete provider ("openai" | "anthropic" | "mock" | "fallback"). */
  readonly id: string;
  /** Set by composite providers to the id of the underlying provider that served the last call. */
  readonly lastUsedId?: string;
  generateAssistantMessage(context: AssistantMessageContext): Promise<string>;
  summarizeIntake(messages: AssistantMessageContext["messages"]): Promise<Partial<IntakeProfileInput>>;
  explainRecommendations(
    profile: IntakeProfileInput,
    recommendation: RoutineRecommendation,
    safetyResult: SafetyTriage,
  ): Promise<string>;
  analyzeImageOptional(image: { storageKey: string; mimeType: string }, intakeContext: IntakeProfileInput): Promise<string>;
};

export const SKIN_ADVISOR_SYSTEM_PROMPT = `You are AI Derma Guru, a cosmetic skin advisor for OTC skincare product discovery. You are not a doctor, dermatologist, pharmacist, or medical device. You do not diagnose, prescribe, or treat serious medical conditions. You help users understand general skincare routines and choose suitable over-the-counter or cosmetic products from an approved product catalog.

You must:
- Be warm, professional, concise, and commercially helpful.
- Ask clarifying questions when essential.
- Recommend only products supplied in the approved product list.
- Explain recommendations using approved product metadata, ingredients, and user preferences.
- Include safety cautions when relevant.
- Refer users to a clinician for severe, persistent, painful, infected, bleeding, rapidly changing, suspicious, or unclear skin issues.
- Never diagnose melanoma, cancer, infection, eczema, psoriasis, rosacea, melasma, fungal acne, or any disease.
- Never recommend prescription medication.
- Never tell a user to stop prescribed medication.
- Never claim guaranteed results.
- Never claim to treat, cure, or prevent any condition. Talk about cosmetic goals (hydration, texture, glow, evenness), not disease outcomes.
- Never hide sponsored or affiliate relationships.
- Never use before/after claims unless explicitly provided and approved in product metadata.
- Always remind users to follow product label directions and patch test new products.

When red flags are present:
- Stop product-selling behavior.
- Give a referral or urgent-care message.
- Only suggest bland general care when appropriate, such as avoiding irritating actives, using gentle cleanser, moisturizer, sunscreen, and seeking professional care.

Tone:
Professional, trustworthy, clear, friendly, not alarmist, not overly medical.`;

// Keeps non-streaming widget responses snappy and prevents Opus-class models from
// leaking exploratory reasoning into the visible reply when extended thinking is off.
const FINAL_ANSWER_DIRECTIVE =
  "Respond only with the final message for the shopper. Do not include your reasoning, planning, or meta-commentary.";

const SYNTHESIS_MODEL = process.env.ANTHROPIC_SYNTHESIS_MODEL ?? "claude-opus-4-8";
const CHAT_MODEL = process.env.ANTHROPIC_CHAT_MODEL ?? "claude-haiku-4-5";

/**
 * Thrown when a provider cannot serve a request for an operational reason
 * (out of quota/credits, rate limited, auth/permission failure, server error,
 * or a network fault). The fallback router catches this to move to the next
 * provider; anything else (e.g. a 400 from a request bug) propagates.
 */
export class ProviderUnavailableError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly status?: number,
    public readonly cause?: unknown,
  ) {
    super(`LLM provider "${providerId}" unavailable${status ? ` (status ${status})` : ""}`);
    this.name = "ProviderUnavailableError";
  }
}

// 401/403 (auth, permission, billing), 408/409/425/429 (timeout, conflict, quota,
// rate limit), and 5xx (server/overloaded) all mean "this provider can't serve the
// request right now" — fall back. `undefined` covers thrown network/connection errors.
function isUnavailableStatus(status?: number): boolean {
  return status === undefined || [401, 403, 408, 409, 425, 429, 500, 502, 503, 504, 529].includes(status);
}

/**
 * Route requests through an ordered chain of providers, falling back to the next
 * one whenever a provider reports it is unavailable. Per the owner's directive,
 * the default chain is OpenAI first, then Claude when OpenAI is out of tokens,
 * then the offline mock as a last resort. Real bugs (non-`ProviderUnavailableError`)
 * are never swallowed.
 */
export class FallbackLLMProvider implements LLMProvider {
  readonly id = "fallback";
  lastUsedId?: string;

  constructor(private readonly providers: LLMProvider[]) {
    if (providers.length === 0) {
      throw new Error("FallbackLLMProvider requires at least one provider");
    }
  }

  private async run<T>(operation: (provider: LLMProvider) => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (const provider of this.providers) {
      try {
        const result = await operation(provider);
        this.lastUsedId = provider.lastUsedId ?? provider.id;
        return result;
      } catch (error) {
        if (error instanceof ProviderUnavailableError) {
          lastError = error;
          continue;
        }
        throw error;
      }
    }
    throw lastError ?? new Error("All LLM providers are unavailable");
  }

  generateAssistantMessage(context: AssistantMessageContext) {
    return this.run((provider) => provider.generateAssistantMessage(context));
  }

  summarizeIntake(messages: AssistantMessageContext["messages"]) {
    return this.run((provider) => provider.summarizeIntake(messages));
  }

  explainRecommendations(profile: IntakeProfileInput, recommendation: RoutineRecommendation, safetyResult: SafetyTriage) {
    return this.run((provider) => provider.explainRecommendations(profile, recommendation, safetyResult));
  }

  analyzeImageOptional(image: { storageKey: string; mimeType: string }, intakeContext: IntakeProfileInput) {
    return this.run((provider) => provider.analyzeImageOptional(image, intakeContext));
  }
}

export function getLLMProvider(): LLMProvider {
  const override = process.env.LLM_PROVIDER;

  if (override === "mock") return new MockLLMProvider();

  if (override === "anthropic") {
    return process.env.ANTHROPIC_API_KEY
      ? new FallbackLLMProvider([new AnthropicProvider(), new MockLLMProvider()])
      : new MockLLMProvider();
  }

  if (override === "openai-compatible") {
    return process.env.OPENAI_COMPATIBLE_API_KEY
      ? new FallbackLLMProvider([new OpenAICompatibleProvider(), new MockLLMProvider()])
      : new MockLLMProvider();
  }

  // Default routing: OpenAI -> Claude (when OpenAI is out of tokens) -> offline mock.
  const chain: LLMProvider[] = [];
  if (process.env.OPENAI_COMPATIBLE_API_KEY) chain.push(new OpenAICompatibleProvider());
  if (process.env.ANTHROPIC_API_KEY) chain.push(new AnthropicProvider());
  chain.push(new MockLLMProvider());

  return chain.length === 1 ? chain[0] : new FallbackLLMProvider(chain);
}

class MockLLMProvider implements LLMProvider {
  readonly id = "mock";

  async generateAssistantMessage(context: AssistantMessageContext) {
    if (!context.safety.recommendationAllowed) {
      return context.safety.referralMessage ?? "This may need a clinician's review before product guidance.";
    }

    return "I can help with a conservative OTC routine. I’ll keep recommendations limited to the approved product catalog and avoid anything that conflicts with your intake.";
  }

  async summarizeIntake(messages: AssistantMessageContext["messages"]) {
    const joined = messages.map((message) => message.content).join(" ");
    return {
      mainConcern: joined || "general routine building",
      freeText: joined,
    };
  }

  async explainRecommendations(
    profile: IntakeProfileInput,
    recommendation: RoutineRecommendation,
    safetyResult: SafetyTriage,
  ) {
    if (!safetyResult.recommendationAllowed) {
      return safetyResult.referralMessage ?? "Please seek clinician guidance before product recommendations.";
    }

    const names = recommendation.items.map((item) => item.product.name).join(", ");
    return `For ${profile.mainConcern}, I’d keep this routine simple and label-led: ${names}. Patch test, introduce one product at a time, and use sunscreen in the morning.`;
  }

  async analyzeImageOptional() {
    return "Image review is not diagnostic in this MVP. Recommendations remain based on the intake and approved OTC catalog.";
  }
}

class OpenAICompatibleProvider implements LLMProvider {
  readonly id = "openai";
  private endpoint = process.env.OPENAI_COMPATIBLE_BASE_URL ?? "https://api.openai.com/v1/chat/completions";
  private model = process.env.OPENAI_COMPATIBLE_MODEL ?? "gpt-4.1-mini";

  async generateAssistantMessage(context: AssistantMessageContext) {
    return this.chat([
      { role: "system", content: SKIN_ADVISOR_SYSTEM_PROMPT },
      {
        role: "system",
        content: JSON.stringify({
          safety: context.safety,
          approvedProducts: context.approvedProducts.map((product) => ({
            id: product.id,
            name: product.name,
            claims: product.approvedClaimsJson,
          })),
        }),
      },
      ...context.messages,
    ]);
  }

  async summarizeIntake(messages: AssistantMessageContext["messages"]) {
    const text = await this.chat([
      { role: "system", content: "Extract a concise JSON skincare intake object. Return JSON only." },
      ...messages,
    ]);

    return safeParseIntake(text) ?? { mainConcern: messages.map((message) => message.content).join(" "), freeText: text };
  }

  async explainRecommendations(
    profile: IntakeProfileInput,
    recommendation: RoutineRecommendation,
    safetyResult: SafetyTriage,
  ) {
    return this.chat([
      { role: "system", content: SKIN_ADVISOR_SYSTEM_PROMPT },
      {
        role: "user",
        content: JSON.stringify({
          profile,
          safetyResult,
          allowedProducts: recommendation.items.map((item) => ({
            name: item.product.name,
            approvedClaims: item.product.approvedClaimsJson,
            reason: item.reason,
            cautions: item.cautions,
          })),
        }),
      },
    ]);
  }

  async analyzeImageOptional() {
    return "Image analysis provider is stubbed. This system does not diagnose from images.";
  }

  private async chat(messages: { role: string; content: string }[]) {
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${process.env.OPENAI_COMPATIBLE_API_KEY}`,
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          messages,
        }),
      });
    } catch (error) {
      // Network/DNS/connection fault — treat as unavailable so we fall back.
      throw new ProviderUnavailableError(this.id, undefined, error);
    }

    if (!response.ok) {
      // 429 + insufficient_quota ("tokens done"), auth, and server errors → fall back.
      if (isUnavailableStatus(response.status)) {
        throw new ProviderUnavailableError(this.id, response.status);
      }
      throw new Error(`OpenAI-compatible provider failed with ${response.status}`);
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };

    return payload.choices?.[0]?.message?.content ?? "";
  }
}

class AnthropicProvider implements LLMProvider {
  readonly id = "anthropic";
  // Quality-first synthesis on Opus 4.8; fast/cheap chat + classification on Haiku 4.5 (spec §6.2).
  private readonly synthesisModel = SYNTHESIS_MODEL;
  private readonly chatModel = CHAT_MODEL;
  private client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1 });

  async generateAssistantMessage(context: AssistantMessageContext) {
    // Red flags force the safe path regardless of the model (spec §3.2).
    if (!context.safety.recommendationAllowed) {
      return context.safety.referralMessage ?? ESCALATION_MESSAGE;
    }

    const groundingSystem = [
      SKIN_ADVISOR_SYSTEM_PROMPT,
      FINAL_ANSWER_DIRECTIVE,
      `Approved catalog and safety context (recommend ONLY from approvedProducts):\n${JSON.stringify({
        safety: context.safety,
        approvedProducts: context.approvedProducts.map((product) => ({
          id: product.id,
          name: product.name,
          claims: product.approvedClaimsJson,
        })),
      })}`,
      extractSystem(context.messages),
    ]
      .filter(Boolean)
      .join("\n\n");

    const text = await this.createMessage(this.chatModel, groundingSystem, toAnthropicMessages(context.messages), 700);
    return text || "I can help with a conservative OTC routine using the approved product catalog. What is your main skin concern?";
  }

  async summarizeIntake(messages: AssistantMessageContext["messages"]) {
    const system = [
      "Extract a concise skincare intake object from the conversation.",
      'Return ONLY minified JSON with any of these keys when present: mainConcern, secondaryConcerns (string[]), skinType, sensitivity, allergies (string[]), pregnantOrBreastfeeding (boolean), prescriptionUse (boolean), ageRange, duration, symptoms (string[]), freeText.',
      "Do not diagnose. Do not add commentary. JSON only.",
    ].join(" ");

    const text = await this.createMessage(this.chatModel, system, toAnthropicMessages(messages), 500);
    return safeParseIntake(text) ?? { mainConcern: messages.map((message) => message.content).join(" "), freeText: text };
  }

  async explainRecommendations(
    profile: IntakeProfileInput,
    recommendation: RoutineRecommendation,
    safetyResult: SafetyTriage,
  ) {
    if (!safetyResult.recommendationAllowed) {
      return safetyResult.referralMessage ?? ESCALATION_MESSAGE;
    }

    const system = `${SKIN_ADVISOR_SYSTEM_PROMPT}\n\n${FINAL_ANSWER_DIRECTIVE}`;
    const user = `Write a short, warm, non-medical explanation of this OTC routine, grounded ONLY in the provided products and their approved claims. Do not name any disease or promise to treat/cure/prevent anything.\n\n${JSON.stringify(
      {
        profile,
        safetyResult,
        allowedProducts: recommendation.items.map((item) => ({
          name: item.product.name,
          approvedClaims: item.product.approvedClaimsJson,
          reason: item.reason,
          cautions: item.cautions,
        })),
      },
    )}`;

    const text = await this.createMessage(this.synthesisModel, system, [{ role: "user", content: user }], 900);
    return text || (await new MockLLMProvider().explainRecommendations(profile, recommendation, safetyResult));
  }

  async analyzeImageOptional() {
    // Selfie analysis is gated to a later, legal-reviewed phase (spec §3.5). Never diagnostic.
    return "Image analysis is not enabled. This system does not diagnose from images; guidance stays based on your intake and the approved OTC catalog.";
  }

  private async createMessage(
    model: string,
    system: string,
    messages: Anthropic.MessageParam[],
    maxTokens: number,
  ): Promise<string> {
    try {
      const response = await this.client.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        messages,
      });
      return response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("")
        .trim();
    } catch (error) {
      throw toAnthropicProviderError(error, this.id);
    }
  }
}

function toAnthropicProviderError(error: unknown, providerId: string): unknown {
  if (error instanceof Anthropic.APIError) {
    // APIConnectionError and friends have an undefined status → isUnavailableStatus(undefined) is true.
    const status = (error as { status?: number }).status;
    if (isUnavailableStatus(status)) {
      return new ProviderUnavailableError(providerId, status, error);
    }
  }
  return error;
}

// The Anthropic Messages API requires the first message to be from the user and
// does not accept system-role turns in the array (system content is hoisted out).
function toAnthropicMessages(messages: AssistantMessageContext["messages"]): Anthropic.MessageParam[] {
  const conversation: Anthropic.MessageParam[] = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({ role: message.role as "user" | "assistant", content: message.content }));

  if (conversation.length === 0 || conversation[0].role !== "user") {
    conversation.unshift({ role: "user", content: "I'd like help building a simple OTC skincare routine." });
  }

  return conversation;
}

function extractSystem(messages: AssistantMessageContext["messages"]): string {
  return messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
}

function safeParseIntake(text: string): Partial<IntakeProfileInput> | null {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const candidate = cleaned.startsWith("{") ? cleaned : cleaned.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) return null;
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === "object" ? (parsed as Partial<IntakeProfileInput>) : null;
  } catch {
    return null;
  }
}
