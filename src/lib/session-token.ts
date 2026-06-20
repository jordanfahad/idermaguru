import { hmacSign, timingSafeEqual } from "@/lib/hmac";

const SESSION_TOKEN_PREFIX = "st";

/**
 * An HMAC proof that the bearer created `sessionId`. Issued by POST
 * /api/chat/start and required by the session export/delete endpoints: a
 * sessionId is a cuid, not an authorization, so possessing one must not be
 * enough to read or erase that session's PII. The shopper widget stores the
 * token returned at session start and sends it back as the `x-session-token`
 * header (or `?token=`).
 */
export async function createSessionToken(sessionId: string): Promise<string> {
  return hmacSign(`${SESSION_TOKEN_PREFIX}:${sessionId}`);
}

export async function verifySessionToken(
  token: string | null | undefined,
  sessionId: string | null | undefined,
): Promise<boolean> {
  if (!token || !sessionId) return false;
  const expected = await hmacSign(`${SESSION_TOKEN_PREFIX}:${sessionId}`);
  return timingSafeEqual(token, expected);
}
