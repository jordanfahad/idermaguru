import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  tenantPrisma?: PrismaClient;
};

export function getPrisma() {
  if (!process.env.DATABASE_URL) {
    return null;
  }

  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = new PrismaClient();
  }

  return globalForPrisma.prisma;
}

/**
 * Prisma client for tenant-SCOPED traffic. When TENANT_DATABASE_URL is set it
 * connects as the non-owner `dermaguru_app` role provisioned in
 * supabase/migrations/003, which is *subject* to the RLS policies from 002.
 * Pair it with withTenantContext (src/lib/tenant-context.ts) so the database —
 * not just application code — filters every row to one tenant.
 *
 * Falls back to the owner client when TENANT_DATABASE_URL is unset, so RLS stays
 * dormant and the app behaves exactly as before until the role is activated.
 * Tenant *resolution* (slug -> tenant, sessionId -> tenant) must keep using
 * getPrisma(): the non-owner role cannot see across tenants to resolve an id it
 * does not yet know. See docs/SECURITY-AUDIT.md.
 */
export function getTenantPrisma() {
  const url = process.env.TENANT_DATABASE_URL;
  if (!url) {
    return getPrisma();
  }

  if (!globalForPrisma.tenantPrisma) {
    globalForPrisma.tenantPrisma = new PrismaClient({ datasources: { db: { url } } });
  }

  return globalForPrisma.tenantPrisma;
}
