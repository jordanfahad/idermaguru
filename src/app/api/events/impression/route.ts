import { NextResponse } from "next/server";
import { z } from "zod";
import { trackEvent } from "@/services/analytics";
import { resolveEventTenantId } from "@/services/tenant-scope";
import { jsonError, parseJson, RequestValidationError } from "../../_shared";

const EventSchema = z.object({
  tenantId: z.string(),
  sessionId: z.string().optional(),
  productId: z.string().optional(),
  recommendationId: z.string().optional(),
  recommendationItemId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request) {
  try {
    const input = await parseJson(request, EventSchema);
    const tenantId = await resolveEventTenantId(input.sessionId, input.tenantId);
    if (!tenantId) return jsonError("A valid sessionId is required for event tracking.", 403);
    const event = await trackEvent({ ...input, tenantId, type: "PRODUCT_IMPRESSION" });
    return NextResponse.json({ event });
  } catch (error) {
    if (error instanceof RequestValidationError) return jsonError(error.message);
    throw error;
  }
}
