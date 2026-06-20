import { base64UrlDecode, base64UrlEncode, hmacSign, timingSafeEqual } from "@/lib/hmac";

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
  const signature = await hmacSign(payload);
  return `${payload}.${signature}`;
}

export async function verifyAdminSession(cookieValue?: string | null): Promise<AdminSession | null> {
  if (!cookieValue) return null;
  const [payload, signature] = cookieValue.split(".");
  if (!payload || !signature) return null;

  const expected = await hmacSign(payload);
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
