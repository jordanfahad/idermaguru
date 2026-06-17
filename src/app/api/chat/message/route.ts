import { NextResponse } from "next/server";
import { z } from "zod";
import { seedTenant } from "@/data/seed-catalog";
import { listTenantProducts } from "@/services/catalog";
import { getLLMProvider } from "@/services/llm/provider";
import { runSafetyTriage } from "@/services/safety-triage";
import { jsonError, parseJson, RequestValidationError } from "../../_shared";

const MessageSchema = z.object({
  tenantSlug: z.string().default(seedTenant.slug),
  sessionId: z.string().optional(),
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant", "system"]),
      content: z.string().min(1),
    }),
  ),
});

export async function POST(request: Request) {
  try {
    const input = await parseJson(request, MessageSchema);
    const provider = getLLMProvider();
    const products = await listTenantProducts(input.tenantSlug);
    const intake = await provider.summarizeIntake(input.messages);
    const safety = runSafetyTriage({
      mainConcern: intake.mainConcern ?? input.messages.at(-1)?.content ?? "general routine building",
      ...intake,
    });
    const message = await provider.generateAssistantMessage({
      messages: input.messages,
      approvedProducts: products,
      safety,
    });

    return NextResponse.json({ message, intake, safety });
  } catch (error) {
    if (error instanceof RequestValidationError) return jsonError(error.message);
    throw error;
  }
}
