import { Prisma, type PrismaClient } from "@prisma/client";

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
