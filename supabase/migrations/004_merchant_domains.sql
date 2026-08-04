-- 004_merchant_domains.sql
--
-- Lets a merchant connect their own hostname from the console, instead of an
-- operator editing ADVISOR_HOSTS and redeploying.
--
-- That environment variable works for one merchant and cannot work for the
-- product: a merchant cannot edit it, and every new domain would need a deploy
-- before it resolved to anybody. It stays supported as an override — it is set
-- by whoever runs the deployment, so it outranks a row someone typed — but the
-- table is where domains live from here.
--
-- Purely additive: one enum, one table, its policy. Nothing existing is altered,
-- so this is safe to apply while the site is serving. Idempotent.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'DomainStatus') then
    create type "DomainStatus" as enum ('PENDING', 'VERIFIED');
  end if;
end $$;

create table if not exists public."MerchantDomain" (
  "id"         text primary key,
  "tenantId"   text not null references public."Tenant"("id") on delete cascade,
  -- Lowercased, no port, no scheme. UNIQUE across every tenant on purpose: a
  -- hostname resolves to exactly one merchant, and two rows claiming one host
  -- would make the catalogue a shopper sees depend on row order.
  "host"       text not null unique,
  "status"     "DomainStatus" not null default 'PENDING',
  "verifiedAt" timestamp(3),
  "createdAt"  timestamp(3) not null default current_timestamp,
  "updatedAt"  timestamp(3) not null
);

create index if not exists "MerchantDomain_tenantId_idx"
  on public."MerchantDomain" ("tenantId");

-- Same isolation as every other tenant-scoped table (see 002). Enabled now so
-- the table is not the one that was forgotten when TENANT_DATABASE_URL is
-- finally activated; the owner role Prisma uses today bypasses RLS, so this
-- changes nothing about current behaviour.
alter table public."MerchantDomain" enable row level security;
drop policy if exists tenant_isolation on public."MerchantDomain";
create policy tenant_isolation on public."MerchantDomain"
  for all
  using ("tenantId" = current_setting('app.current_tenant_id', true))
  with check ("tenantId" = current_setting('app.current_tenant_id', true));

-- Resolving a host to its tenant happens BEFORE any tenant id is known, so it
-- runs on the owner client exactly as slug resolution does — see the note in
-- 003 about keeping resolution off the RLS-subject role.
