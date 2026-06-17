import { NextResponse } from "next/server";
import { z } from "zod";
import { trackEvent } from "@/services/analytics";
import { jsonError, parseJson, RequestValidationError } from "../../_shared";

const AddToCartSchema = z.object({
  tenantId: z.string(),
  sessionId: z.string().optional(),
  productId: z.string().optional(),
  recommendationId: z.string().optional(),
  recommendationItemId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request) {
  try {
    const input = await parseJson(request, AddToCartSchema);
    const event = await trackEvent({ ...input, type: "ADD_TO_CART" });
    return NextResponse.json({ event });
  } catch (error) {
    if (error instanceof RequestValidationError) return jsonError(error.message);
    throw error;
  }
}
