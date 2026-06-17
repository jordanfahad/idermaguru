import { createHash } from "node:crypto";

export function hashIp(ip?: string | null) {
  if (!ip) return null;
  const salt = process.env.IP_HASH_SALT ?? "local-development-salt";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

export function getClientIp(headers: Headers) {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip") ??
    null
  );
}

export const DEFAULT_IMAGE_RETENTION_DAYS = 30;
