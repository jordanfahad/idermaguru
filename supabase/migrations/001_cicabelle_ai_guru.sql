create table if not exists public.recommendations (
  slug text primary key,
  title text not null,
  concern text not null,
  skin_type text not null,
  summary text not null,
  routine jsonb not null default '[]'::jsonb,
  avoid jsonb not null default '[]'::jsonb,
  seo_title text not null,
  seo_description text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.outbound_clicks (
  id bigint generated always as identity primary key,
  product_id text not null,
  product_name text not null,
  destination_url text not null,
  recommendation_slug text references public.recommendations(slug) on delete set null,
  referrer text,
  user_agent text,
  created_at timestamptz not null default now()
);

create table if not exists public.partner_domains (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  domain text not null unique,
  display_name text not null,
  created_at timestamptz not null default now()
);

alter table public.recommendations enable row level security;
alter table public.outbound_clicks enable row level security;
alter table public.partner_domains enable row level security;

create policy "Recommendations are public SEO content"
  on public.recommendations
  for select
  using (true);

create policy "Partner domains are visible to their owner"
  on public.partner_domains
  for select
  to authenticated
  using (owner_id = auth.uid());
