import { NextResponse } from "next/server";
import { z } from "zod";
import { trackEvent } from "@/services/analytics";
import { resolveEventTenantId } from "@/services/tenant-scope";
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
    const tenantId = await resolveEventTenantId(input.sessionId, input.tenantId);
    if (!tenantId) return jsonError("A valid sessionId is required for event tracking.", 403);
    const event = await trackEvent({ ...input, tenantId, type: "PRODUCT_CLICK" });
    return NextResponse.json({ event });
  } catch (error) {
    if (error instanceof RequestValidationError) return jsonError(error.message);
    throw error;
  }
}
