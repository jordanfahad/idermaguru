import { NextResponse } from "next/server";
import { z } from "zod";
import { trackEvent } from "@/services/analytics";
import { resolveConversionTenantId } from "@/services/tenant-scope";
import { withTenant } from "@/lib/tenant-context";
import { asPrismaJson } from "@/server/json";
import { jsonError, parseJson, RequestValidationError } from "../../_shared";

const ConversionSchema = z.object({
  tenantId: z.string(),
  sessionId: z.string().optional(),
  clickId: z.string().optional(),
  orderId: z.string(),
  revenue: z.number().nonnegative(),
  currency: z.string().default("AED"),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request) {
  try {
    const input = await parseJson(request, ConversionSchema);
    const tenantId = await resolveConversionTenantId(input.sessionId, input.clickId, input.tenantId);
    if (!tenantId) return jsonError("A valid sessionId or clickId is required.", 403);
    const conversion =
      (await withTenant(tenantId, (tx) =>
        tx.conversion.create({
          data: {
            tenantId,
            sessionId: input.sessionId,
            clickEventId: input.clickId,
            orderId: input.orderId,
            revenue: input.revenue,
            currency: input.currency,
            metadataJson: asPrismaJson(input.metadata ?? {}),
          },
        }),
      )) ?? { id: crypto.randomUUID(), ...input };

    await trackEvent({
      tenantId,
      sessionId: input.sessionId,
      type: "PURCHASE_COMPLETED",
      metadata: { orderId: input.orderId, revenue: input.revenue, currency: input.currency },
    });

    return NextResponse.json({ conversion });
  } catch (error) {
    if (error instanceof RequestValidationError) return jsonError(error.message);
    throw error;
  }
}
