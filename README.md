# AI Cosmetologist / AI Derma Guru SaaS MVP

Production-oriented MVP for a commercial OTC skincare recommendation platform. The first tenant is
`ai-derma-guru` (`AI Cosmetologist / AI Derma Guru`), but the architecture is multi-tenant for future skincare,
pharmacy, beauty, and wellness merchants.

## Positioning

Use public product names such as **AI Cosmetologist**, **AI Derma Guru**, **AI Skincare Concierge**, or **OTC Skincare
Routine Assistant**. The product is not a medical device and must not diagnose, prescribe, treat
serious disease, or replace a dermatologist or doctor.

Customer disclaimer shown at widget start:

> AI Derma Guru can help with general over-the-counter skincare guidance and product discovery. It does not diagnose
> medical conditions, prescribe medication, or replace a dermatologist or doctor. If symptoms are
> severe, painful, infected, bleeding, rapidly worsening, or involve swelling, breathing difficulty,
> fever, or the eyes, please seek medical care.

## Stack

- Next.js App Router + TypeScript
- PostgreSQL + Prisma ORM
- Deterministic safety triage and recommendation engine (pre-LLM input gate + post-LLM output gate)
- AI provider routing: OpenAI first, Claude (Anthropic) fallback when OpenAI is out of tokens, offline mock last
- Local upload storage abstraction under `.local-storage`
- Stripe-ready plan model stub via `MerchantPlan`

## Key Routes

- `/demo` public AI Derma Guru demo
- `/widget-demo` merchant-site widget simulation
- `/faq`, `/dictionary`, `/privacy-policy`, `/terms-of-use` bilingual content pages
- `/admin` merchant portal
- `/admin/products` product catalog
- `/admin/products/import` CSV import
- `/admin/sponsored` sponsored result curation and embed-code preview
- `/admin/analytics` funnel and attribution metrics
- `/admin/settings` tenant/widget settings
- `/admin/login` demo admin login surface

## APIs

Customer/session:

- `POST /api/chat/start`
- `POST /api/chat/message`
- `POST /api/intake`
- `POST /api/upload-image`
- `DELETE /api/upload-image/:id`
- `POST /api/recommendations`
- `POST /api/session/delete`
- `GET /api/session/export?sessionId=...`

Tracking:

- `POST /api/events/impression`
- `POST /api/events/click`
- `POST /api/events/conversion`
- `GET /api/r/:recommendationItemId`

Admin:

- `GET /api/admin/tenants`
- `POST /api/admin/tenants`
- `GET /api/admin/products`
- `POST /api/admin/products`
- `PUT /api/admin/products/:id`
- `DELETE /api/admin/products/:id`
- `POST /api/admin/products/import-csv`
- `GET /api/admin/analytics`
- `GET /api/admin/sessions`
- `GET /api/admin/recommendations`

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run prisma:generate
npm run prisma:migrate
npm run db:seed
npm run dev
```

If `DATABASE_URL` is not configured, the app still runs with seeded in-memory catalog fallbacks for
demo UI and tests, but persistent sessions, admin writes, analytics, and attribution require
PostgreSQL.

## Environment Variables

```bash
NEXT_PUBLIC_SITE_URL=http://localhost:3000
DATABASE_URL=postgresql://postgres.jqsgtbzjwpbqxinustgq:YOUR_PASSWORD@aws-1-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://postgres.jqsgtbzjwpbqxinustgq:YOUR_PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres
# Leave LLM_PROVIDER unset in production for OpenAI -> Claude -> mock routing.
# Set to "mock" locally to avoid spend; "openai-compatible" or "anthropic" force a single provider.
LLM_PROVIDER=mock
OPENAI_COMPATIBLE_BASE_URL=https://api.openai.com/v1/chat/completions
OPENAI_COMPATIBLE_MODEL=gpt-4.1-mini
OPENAI_COMPATIBLE_API_KEY=
# Claude fallback (used when OpenAI is out of tokens/unavailable):
ANTHROPIC_API_KEY=
ANTHROPIC_SYNTHESIS_MODEL=claude-opus-4-8
ANTHROPIC_CHAT_MODEL=claude-haiku-4-5
IP_HASH_SALT=replace-me
```

The AI layer never picks the safety status, invents products, or recommends outside the tenant
catalog. Routine synthesis/explanations run on the quality-first synthesis model; simple chat turns and
intake classification run on the faster chat model. If no provider key is set (or `LLM_PROVIDER=mock`),
the deterministic offline mock serves every turn so the app stays fully testable without external calls.

Optional existing Supabase compatibility variables can remain for older routes, but the SaaS MVP uses
Prisma/PostgreSQL as the primary data layer.

## Seed Data

The seed script creates:

- Tenant slug: `ai-derma-guru`
- Tenant name: `AI Cosmetologist / AI Derma Guru`
- Domain: `aiderma.guru`
- Starter merchant plan
- 12 generic OTC skincare products with structured metadata and conservative approved claims

## Widget Embed Target

The embeddable advisor ships as a native Web Component (`public/dermaguru-widget.js`). It mounts a
`<dermaguru-widget>` custom element using **Shadow DOM**, so the host store's CSS cannot bleed into the
widget and the widget's CSS cannot leak onto the store. Initial JS is ~7KB gzipped, it lazy-builds the
panel on first open, uses fixed positioning (no layout shift), and supports full RTL/Arabic. Brand
tokens are passed via `data-*` attributes and injected as CSS custom properties; the tenant name and
safety disclaimer are fetched from `GET /api/widget/config`.

```html
<script
  async
  src="https://your-domain.com/dermaguru-widget.js"
  data-tenant="ai-derma-guru"
  data-position="bottom-right"
  data-primary="#1f6f5c"
  data-locale="en"
></script>
```

- RTL/Arabic: add `data-locale="ar"` (or `data-rtl="true"`).
- Branding: `data-primary`, `data-on-primary`, `data-radius`, `data-font`, `data-title`.
- Hostile CSP / no Shadow DOM: add `data-mode="iframe"` (the loader also auto-falls back to the
  `/embed` iframe). The older `skin-advisor-widget.js` iframe loader remains for compatibility.

The widget calls cross-origin endpoints (`/api/widget/config`, `/api/chat/*`, `/api/recommendations`,
`/api/events/*`), which send permissive CORS headers via `proxy.ts`. For a local preview open
`/dermaguru-widget-demo.html` (a mock store) or use `/widget-demo`.

## Safety Architecture

The deterministic triage engine runs before recommendations and LLM explanation. It returns:

- `LOW`
- `CAUTION`
- `REFER_CLINIC`
- `URGENT`

`URGENT` and `REFER_CLINIC` block commercial recommendations. `CAUTION` allows conservative OTC
recommendations with warnings. The LLM can explain recommendations but cannot choose safety status,
invent products, recommend products outside the tenant catalog, or override hard filters.

An **output gate** (`validateAssistantTextForSafety`) scans every model reply on both the
`/api/recommendations` and `/api/chat/message` paths. It re-runs triage on the generated text and
detects diagnostic conclusions, disease names asserted as fact, treat/cure/prevent claims, and
guaranteed-result claims. Anything it flags is replaced with a safe referral/cosmetic-guidance
template before it reaches the shopper.

## Recommendation Scoring

```text
final_score =
  0.35 * concern_match_score
+ 0.20 * ingredient_evidence_score
+ 0.15 * skin_type_fit_score
+ 0.10 * sensitivity_fit_score
+ 0.10 * price_fit_score
+ 0.05 * availability_score
+ 0.05 * commercial_boost_score
```

Commercial boost is capped, never overrides safety filters, and sponsored products are visibly
disclosed.

## Multi-tenant isolation & semantic search

`supabase/migrations/002_tenant_rls_and_pgvector.sql` layers strict tenant isolation and pgvector
search onto the Prisma-owned tables:

- **Row-Level Security** on every tenant-scoped table (`Tenant`, `Product`, `UserSession`,
  `Recommendation`, `Event`, `Conversion`, …) plus session/recommendation children. Policies key off
  the per-request GUC `app.current_tenant_id`, so a connection that hasn't set it sees no tenant rows
  (fail-closed). RLS is **enabled but not forced**, so the existing Prisma owner connection keeps
  working; to enforce isolation, route tenant traffic through a non-owner role and wrap queries in
  `withTenantContext()` (`src/lib/tenant-context.ts`). For a Supabase-JWT deployment, swap the GUC
  comparison for `auth.jwt() ->> 'tenant_id'`.
- **pgvector** embeddings on `Product` and a curated `kb_chunks` knowledge base (global rows +
  optional per-tenant overrides), with `match_products` / `match_kb_chunks` RPCs for cosine
  similarity retrieval. Dimension defaults to 1536 (OpenAI `text-embedding-3-small`).

Apply Prisma migrations first, then this SQL migration (it intentionally manages the pgvector
columns/tables outside the Prisma schema). The embedding columns stay empty until an ingestion job
populates them; the deterministic engine remains the grounding source until then.

## Tests

```bash
npm test
```

Tests cover urgent/referral/caution triage, allergy filtering, pregnancy retinoid exclusion, mild
routine generation, and sponsored unsafe product exclusion.

## Deployment

Set production env vars in Vercel, including `DATABASE_URL` and `DIRECT_URL`, then:

```bash
npm run build
npx vercel deploy --prod
```

Run migrations and seed against the production database before opening the widget to customers.
