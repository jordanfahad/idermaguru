import { NextResponse } from "next/server";
import { z } from "zod";
import { seedTenant } from "@/data/seed-catalog";

export const TenantRequestSchema = z.object({
  tenantSlug: z.string().optional().default(seedTenant.slug),
});

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function parseJson<T>(request: Request, schema: z.ZodType<T>) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new RequestValidationError(parsed.error.issues.map((issue) => issue.message).join(", "));
  }
  return parsed.data;
}

export class RequestValidationError extends Error {}

export function csvSplit(value: string) {
  return value
    .split(/[|,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
