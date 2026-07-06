// Shared HMAC-SHA256 signing for the app's signed tokens (admin sessions and
// shopper session tokens). Web Crypto, so it runs in both the Node and Edge
// runtimes. Keep this the single source of the signing secret so there is one
// place to reason about forgeability.

// Generated once per process. Used only as a dev/test fallback when
// ADMIN_SESSION_SECRET is unset, so tokens are never signed with a public
// constant; they simply do not survive a restart or span instances.
const EPHEMERAL_DEV_SECRET = base64UrlEncodeBytes(crypto.getRandomValues(new Uint8Array(32)));

/**
 * The HMAC secret for all signed app tokens. Requires ADMIN_SESSION_SECRET
 * (>= 16 chars) in production and fails closed if it is missing; in dev/test it
 * falls back to an ephemeral per-process secret.
 */
export function resolveAppSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (secret && secret.length >= 16) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("ADMIN_SESSION_SECRET must be set (>= 16 chars) in production.");
  }
  return EPHEMERAL_DEV_SECRET;
}

export async function hmacSign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(resolveAppSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) {
    result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return result === 0;
}

export function base64UrlEncode(value: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

export function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlDecode(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}
