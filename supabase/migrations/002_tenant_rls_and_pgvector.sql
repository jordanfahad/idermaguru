-- 002_tenant_rls_and_pgvector.sql
--
-- Layers strict multi-tenant Row-Level Security and pgvector semantic search onto
-- the Prisma-owned tables (spec §2 isolation, §5/§6.3 grounding). Idempotent.
--
-- Enforcement model
-- -----------------
-- Tenant isolation keys off a per-request Postgres GUC, `app.current_tenant_id`.
-- Policies allow a row only when it belongs to the current tenant:
--     using ("tenantId" = current_setting('app.current_tenant_id', true))
-- `current_setting(name, true)` returns NULL when unset, so a connection that has
-- NOT set the GUC sees no tenant rows (fail-closed) — for roles that are subject
-- to RLS.
--
-- IMPORTANT: RLS is enabled but NOT forced. The table OWNER (the Prisma
-- DATABASE_URL role) bypasses RLS, so the existing app keeps working unchanged.
-- To actually enforce isolation, route shopper/tenant traffic through a
-- non-owner role (e.g. a dedicated `dermaguru_tenant` login or Supabase's
-- authenticated/anon roles) and set the GUC per request — see
-- `src/lib/tenant-context.ts` (withTenantContext) for the Prisma pattern. If you
-- deploy via the Supabase client with JWTs instead, swap the GUC comparison for
-- `auth.jwt() ->> 'tenant_id'` in these policies.
--
-- Run order: apply Prisma migrations first (they own these tables), then this
-- file. The pgvector columns/tables added here are intentionally outside the
-- Prisma schema; do not let `prisma migrate dev` drop them.

create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- Tenant isolation RLS
-- ---------------------------------------------------------------------------

-- Tenant-keyed tables (carry "tenantId", except "Tenant" which is keyed by "id").
do $$
declare
  tbl text;
  tenant_tables text[] := array[
    'MerchantPlan', 'UserSession', 'Product', 'Recommendation', 'Event', 'Conversion'
  ];
begin
  -- "Tenant" itself is keyed on its own id.
  execute 'alter table public."Tenant" enable row level security';
  execute 'drop policy if exists tenant_isolation on public."Tenant"';
  execute $p$
    create policy tenant_isolation on public."Tenant"
      for all
      using ("id" = current_setting('app.current_tenant_id', true))
      with check ("id" = current_setting('app.current_tenant_id', true))
  $p$;

  foreach tbl in array tenant_tables loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('drop policy if exists tenant_isolation on public.%I', tbl);
    execute format($p$
      create policy tenant_isolation on public.%I
        for all
        using ("tenantId" = current_setting('app.current_tenant_id', true))
        with check ("tenantId" = current_setting('app.current_tenant_id', true))
    $p$, tbl);
  end loop;
end $$;

-- Session-scoped children (isolated through their parent "UserSession").
do $$
declare
  tbl text;
  session_children text[] := array[
    'ConsentRecord', 'UploadedImage', 'IntakeProfile', 'SafetyTriageResult'
  ];
begin
  foreach tbl in array session_children loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('drop policy if exists tenant_isolation on public.%I', tbl);
    execute format($p$
      create policy tenant_isolation on public.%I
        for all
        using (exists (
          select 1 from public."UserSession" s
          where s.id = %I."sessionId"
            and s."tenantId" = current_setting('app.current_tenant_id', true)
        ))
        with check (exists (
          select 1 from public."UserSession" s
          where s.id = %I."sessionId"
            and s."tenantId" = current_setting('app.current_tenant_id', true)
        ))
    $p$, tbl, tbl, tbl);
  end loop;
end $$;

-- "RecommendationItem" is isolated through its parent "Recommendation".
alter table public."RecommendationItem" enable row level security;
drop policy if exists tenant_isolation on public."RecommendationItem";
create policy tenant_isolation on public."RecommendationItem"
  for all
  using (exists (
    select 1 from public."Recommendation" r
    where r.id = "RecommendationItem"."recommendationId"
      and r."tenantId" = current_setting('app.current_tenant_id', true)
  ))
  with check (exists (
    select 1 from public."Recommendation" r
    where r.id = "RecommendationItem"."recommendationId"
      and r."tenantId" = current_setting('app.current_tenant_id', true)
  ));

-- ---------------------------------------------------------------------------
-- pgvector: product embeddings + curated knowledge base (§5/§6.3)
-- Dimension 1536 = OpenAI text-embedding-3-small (the primary provider). Adjust
-- the dimension here and in the match_* functions if you change embedders.
-- ---------------------------------------------------------------------------

alter table public."Product" add column if not exists embedding vector(1536);
create index if not exists product_embedding_idx
  on public."Product" using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Curated skincare/ingredient KB: tenant_id NULL = global/shared; non-null = a
-- tenant override (spec §2.1). Managed outside Prisma.
create table if not exists public.kb_chunks (
  id uuid primary key default gen_random_uuid(),
  tenant_id text,
  title text not null,
  content text not null,
  source text,
  tags text[] not null default '{}',
  embedding vector(1536),
  created_at timestamptz not null default now()
);
create index if not exists kb_chunks_tenant_idx on public.kb_chunks (tenant_id);
create index if not exists kb_chunks_embedding_idx
  on public.kb_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

alter table public.kb_chunks enable row level security;
drop policy if exists kb_tenant_read on public.kb_chunks;
create policy kb_tenant_read on public.kb_chunks
  for select
  using (tenant_id is null or tenant_id = current_setting('app.current_tenant_id', true));

-- ---------------------------------------------------------------------------
-- Semantic retrieval RPCs (SECURITY INVOKER → RLS applies; also filter by tenant
-- explicitly as defense in depth). Cosine similarity = 1 - distance.
-- ---------------------------------------------------------------------------

create or replace function public.match_products(
  p_tenant_id text,
  p_query_embedding vector(1536),
  p_match_count int default 6
)
returns table (id text, name text, similarity float)
language sql
stable
as $$
  select p.id, p.name, 1 - (p.embedding <=> p_query_embedding) as similarity
  from public."Product" p
  where p."tenantId" = p_tenant_id
    and p."inStock" = true
    and p.embedding is not null
  order by p.embedding <=> p_query_embedding
  limit greatest(1, least(p_match_count, 50));
$$;

create or replace function public.match_kb_chunks(
  p_tenant_id text,
  p_query_embedding vector(1536),
  p_match_count int default 5
)
returns table (id uuid, title text, content text, similarity float)
language sql
stable
as $$
  select k.id, k.title, k.content, 1 - (k.embedding <=> p_query_embedding) as similarity
  from public.kb_chunks k
  where (k.tenant_id is null or k.tenant_id = p_tenant_id)
    and k.embedding is not null
  order by k.embedding <=> p_query_embedding
  limit greatest(1, least(p_match_count, 50));
$$;
