import { Prisma, type PrismaClient } from "@prisma/client";
import { getTenantPrisma } from "@/server/db";

/**
 * Run `fn` inside a transaction with the Postgres GUC `app.current_tenant_id`
 * set, so the Row-Level Security policies from
 * `supabase/migrations/002_tenant_rls_and_pgvector.sql` scope every query to one
 * tenant.
 *
 * This is the enforcement hook for strict tenant isolation (spec §2). It only
 * has teeth when the connection runs as a role that is *subject* to RLS — the
 * default Prisma owner role bypasses RLS (the migration enables but does not
 * FORCE it), so wiring this in requires pointing tenant traffic at a non-owner
 * database role. Until then it is a safe no-op layer: it sets the GUC and runs
 * the work in a transaction.
 *
 * `set_config(..., true)` makes the setting transaction-local, so it never leaks
 * across pooled connections.
 */
export async function withTenantContext<T>(
  prisma: PrismaClient,
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`select set_config('app.current_tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });
}

/**
 * Convenience wrapper used by the tenant-scoped data paths: grab the tenant
 * Prisma client (getTenantPrisma) and run `fn` inside withTenantContext so the
 * RLS GUC is set for the duration.
 *
 * Returns null when no database is configured (getTenantPrisma() is null) so
 * callers can keep their existing no-DB stub behaviour. Only use this for
 * queries that already know their tenantId — tenant *resolution* (slug -> id,
 * sessionId -> tenantId) must stay on getPrisma(), since a role subject to RLS
 * cannot see across tenants to resolve an id it does not yet know.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T | null> {
  const prisma = getTenantPrisma();
  if (!prisma) return null;

  // While the tenant role is dormant (TENANT_DATABASE_URL unset) getTenantPrisma
  // returns the owner client, which bypasses RLS — so opening a transaction just
  // to set the GUC would add cost for no isolation benefit, and would change the
  // prior non-transactional behaviour. Run directly until the role is activated;
  // once it is, go through withTenantContext so RLS scopes every query.
  if (!process.env.TENANT_DATABASE_URL) {
    return fn(prisma);
  }
  return withTenantContext(prisma, tenantId, fn);
}
