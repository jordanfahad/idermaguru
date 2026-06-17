export type AdminRole = "merchant" | "super_admin";

export type AdminSession = {
  email: string;
  role: AdminRole;
  exp: number;
};

const SESSION_COOKIE = "adg_admin_session";
const ONE_DAY_SECONDS = 60 * 60 * 24;

export function getAdminSessionCookieName() {
  return SESSION_COOKIE;
}

export function getAdminSessionMaxAge() {
  return ONE_DAY_SECONDS;
}

export async function createAdminSession(email: string, role: AdminRole) {
  const session: AdminSession = {
    email,
    role,
    exp: Math.floor(Date.now() / 1000) + ONE_DAY_SECONDS,
  };
  const payload = base64UrlEncode(JSON.stringify(session));
  const signature = await sign(payload);
  return `${payload}.${signature}`;
}

export async function verifyAdminSession(cookieValue?: string | null): Promise<AdminSession | null> {
  if (!cookieValue) return null;
  const [payload, signature] = cookieValue.split(".");
  if (!payload || !signature) return null;

  const expected = await sign(payload);
  if (!timingSafeEqual(signature, expected)) return null;

  try {
    const session = JSON.parse(base64UrlDecode(payload)) as AdminSession;
    if (!session.email || !session.role || session.exp < Math.floor(Date.now() / 1000)) return null;
    return session;
  } catch {
    return null;
  }
}

export function isSuperAdminCredentials(email: string, password: string) {
  const superEmail = process.env.SUPER_ADMIN_EMAIL ?? "jordan.fahad@gmail.com";
  const superPassword = process.env.SUPER_ADMIN_PASSWORD;
  return email.trim().toLowerCase() === superEmail.toLowerCase() && Boolean(superPassword) && password === superPassword;
}

async function sign(payload: string) {
  const secret = process.env.ADMIN_SESSION_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "local-admin-session-secret";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

function base64UrlEncode(value: string) {
  return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

function base64UrlEncodeBytes(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) {
    result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return result === 0;
}
