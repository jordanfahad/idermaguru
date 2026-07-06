-- 003_app_role_and_rls_activation.sql
--
-- Provisions the non-owner database role that ACTIVATES the tenant RLS policies
-- defined in 002. Those policies are ENABLEd, but the Prisma owner role
-- (DATABASE_URL) bypasses RLS, so today isolation is enforced only in
-- application code (see docs/SECURITY-AUDIT.md). Routing tenant-scoped traffic
-- through this role — via TENANT_DATABASE_URL + withTenantContext, which sets
-- the `app.current_tenant_id` GUC — makes the database itself reject
-- cross-tenant rows, as defense in depth behind the app-level checks. Idempotent.
--
-- This migration is SAFE to apply on its own: it only creates a NOLOGIN role
-- that nothing connects as until you complete activation. It does not FORCE RLS,
-- so the owner connection keeps working unchanged.
--
-- Activation (run once, out of band, with the password kept in your secret store):
--   1. alter role dermaguru_app with login password '<<strong unique secret>>';
--   2. Set TENANT_DATABASE_URL to a connection string for dermaguru_app, and
--      route tenant-scoped queries through getTenantPrisma() + withTenantContext.
--   3. Keep tenant *resolution* queries (slug -> tenant, sessionId -> tenant) on
--      the owner client getPrisma(): a role subject to RLS cannot see across
--      tenants to resolve an id it does not yet know. Only tenant-scoped
--      reads/writes use the tenant role.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'dermaguru_app') then
    -- NOLOGIN until activation sets a password; NOINHERIT and never BYPASSRLS so
    -- the role stays fully subject to the 002 policies.
    create role dermaguru_app nologin noinherit;
  end if;
end $$;

grant usage on schema public to dermaguru_app;

-- DML only, and no table ownership, so RLS applies to this role.
grant select, insert, update, delete on all tables in schema public to dermaguru_app;
grant usage, select on all sequences in schema public to dermaguru_app;

-- Cover tables/sequences that later Prisma migrations create.
alter default privileges in schema public
  grant select, insert, update, delete on tables to dermaguru_app;
alter default privileges in schema public
  grant usage, select on sequences to dermaguru_app;

-- Allow the role to call the semantic-retrieval RPCs from 002 (they already
-- filter by tenant internally and run SECURITY INVOKER, so RLS still applies).
grant execute on function public.match_products(text, vector, int) to dermaguru_app;
grant execute on function public.match_kb_chunks(text, vector, int) to dermaguru_app;
