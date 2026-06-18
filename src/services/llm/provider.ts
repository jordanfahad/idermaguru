import type {
  IntakeProfileInput,
  ProductCatalogItem,
  RoutineRecommendation,
  SafetyTriage,
} from "@/domain/skincare";

export type AssistantMessageContext = {
  messages: { role: "user" | "assistant" | "system"; content: string }[];
  approvedProducts: ProductCatalogItem[];
  safety: SafetyTriage;
};

export type LLMProvider = {
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
- Never hide sponsored or affiliate relationships.
- Never use before/after claims unless explicitly provided and approved in product metadata.
- Always remind users to follow product label directions and patch test new products.

When red flags are present:
- Stop product-selling behavior.
- Give a referral or urgent-care message.
- Only suggest bland general care when appropriate, such as avoiding irritating actives, using gentle cleanser, moisturizer, sunscreen, and seeking professional care.

Tone:
Professional, trustworthy, clear, friendly, not alarmist, not overly medical.`;

export function getLLMProvider(): LLMProvider {
  if (process.env.LLM_PROVIDER === "openai-compatible" && process.env.OPENAI_COMPATIBLE_API_KEY) {
    return new OpenAICompatibleProvider();
  }

  return new MockLLMProvider();
}

class MockLLMProvider implements LLMProvider {
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

    try {
      return JSON.parse(text) as Partial<IntakeProfileInput>;
    } catch {
      return { mainConcern: messages.map((message) => message.content).join(" "), freeText: text };
    }
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
    const response = await fetch(this.endpoint, {
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

    if (!response.ok) {
      throw new Error(`LLM provider failed with ${response.status}`);
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };

    return payload.choices?.[0]?.message?.content ?? "";
  }
}
