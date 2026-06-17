import { NextResponse } from "next/server";
import { z } from "zod";
import { trackEvent } from "@/services/analytics";
import { jsonError, parseJson, RequestValidationError } from "../../_shared";

const ClickSchema = z.object({
  tenantId: z.string(),
  sessionId: z.string().optional(),
  productId: z.string(),
  recommendationId: z.string().optional(),
  recommendationItemId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request) {
  try {
    const input = await parseJson(request, ClickSchema);
    const event = await trackEvent({ ...input, type: "PRODUCT_CLICK" });
    return NextResponse.json({ event });
  } catch (error) {
    if (error instanceof RequestValidationError) return jsonError(error.message);
    throw error;
  }
}
