import { getPrisma } from "@/server/db";

/**
 * The tenant that owns a shopper session, resolved server-side. Shopper writes
 * (events, conversions, recommendations, uploads) must key off this rather than
 * a client-supplied tenant id/slug — otherwise a caller can attach data to, or
 * forge analytics into, any tenant simply by naming it. Returns null when the
 * session does not exist or there is no database configured.
 */
export async function getSessionTenantId(sessionId?: string | null): Promise<string | null> {
  if (!sessionId) return null;
  const prisma = getPrisma();
  if (!prisma) return null;
  const session = await prisma.userSession.findUnique({
    where: { id: sessionId },
    select: { tenantId: true },
  });
  return session?.tenantId ?? null;
}

/**
 * Tenant for an analytics event. With a database the tenant is taken from the
 * session and the client-supplied value is ignored; with no database (local dev
 * with stubbed persistence) there is no data plane to isolate, so the supplied
 * value is accepted. Returns null when a DB is present but the session is
 * missing, so the caller can reject the write.
 */
export async function resolveEventTenantId(
  sessionId?: string | null,
  clientTenantId?: string | null,
): Promise<string | null> {
  const prisma = getPrisma();
  if (!prisma) return clientTenantId ?? null;
  return getSessionTenantId(sessionId);
}

/**
 * Tenant for a conversion. Prefers the session; falls back to the tenant of the
 * referenced click event, since server-to-server conversions may carry only a
 * clickId. Returns null when none resolve and a DB is present.
 */
export async function resolveConversionTenantId(
  sessionId?: string | null,
  clickEventId?: string | null,
  clientTenantId?: string | null,
): Promise<string | null> {
  const prisma = getPrisma();
  if (!prisma) return clientTenantId ?? null;
  const fromSession = await getSessionTenantId(sessionId);
  if (fromSession) return fromSession;
  if (clickEventId) {
    const event = await prisma.event.findUnique({
      where: { id: clickEventId },
      select: { tenantId: true },
    });
    return event?.tenantId ?? null;
  }
  return null;
}
