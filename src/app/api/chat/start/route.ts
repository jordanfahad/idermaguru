import { NextResponse } from "next/server";
import { z } from "zod";
import { seedTenant } from "@/data/seed-catalog";
import { CUSTOMER_DISCLAIMER } from "@/domain/skincare";
import { getTenantBySlug } from "@/services/catalog";
import { trackEvent } from "@/services/analytics";
import { createSessionToken } from "@/lib/session-token";
import { withTenant } from "@/lib/tenant-context";
import { jsonError, parseJson, RequestValidationError } from "../../_shared";

const StartSchema = z.object({
  tenantSlug: z.string().default(seedTenant.slug),
  anonymousUserId: z.string().optional(),
  locale: z.string().optional(),
  country: z.string().optional(),
  sourceUrl: z.string().optional(),
  utmSource: z.string().optional(),
  utmMedium: z.string().optional(),
  utmCampaign: z.string().optional(),
  referrer: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const input = await parseJson(request, StartSchema);
    const tenant = await getTenantBySlug(input.tenantSlug);
    if (!tenant) return jsonError("Tenant not found.", 404);

    const anonymousUserId = input.anonymousUserId ?? crypto.randomUUID();
    const session =
      (await withTenant(tenant.id, (tx) =>
        tx.userSession.create({
          data: {
            tenantId: tenant.id,
            anonymousUserId,
            locale: input.locale,
            country: input.country,
            sourceUrl: input.sourceUrl,
            utmSource: input.utmSource,
            utmMedium: input.utmMedium,
            utmCampaign: input.utmCampaign,
            referrer: input.referrer,
          },
        }),
      )) ?? { id: crypto.randomUUID(), anonymousUserId };

    await trackEvent({ tenantId: tenant.id, sessionId: session.id, type: "SESSION_STARTED" });

    const sessionToken = await createSessionToken(session.id);

    return NextResponse.json({
      sessionId: session.id,
      sessionToken,
      anonymousUserId,
      tenant,
      disclaimer: tenant.disclosureText || CUSTOMER_DISCLAIMER,
    });
  } catch (error) {
    if (error instanceof RequestValidationError) return jsonError(error.message);
    throw error;
  }
}
