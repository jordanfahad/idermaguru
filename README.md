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
- Deterministic safety triage and recommendation engine
- Mock LLM provider by default
- OpenAI-compatible LLM provider stub via environment variables
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
LLM_PROVIDER=mock
OPENAI_COMPATIBLE_BASE_URL=https://api.openai.com/v1/chat/completions
OPENAI_COMPATIBLE_MODEL=gpt-4.1-mini
OPENAI_COMPATIBLE_API_KEY=
IP_HASH_SALT=replace-me
```

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

Future CDN embed target:

```html
<script
  src="https://your-domain.com/skin-advisor-widget.js"
  data-tenant="ai-derma-guru"
  data-theme="light"
  data-locale="en"
></script>
```

For local development, use `/widget-demo`.

## Safety Architecture

The deterministic triage engine runs before recommendations and LLM explanation. It returns:

- `LOW`
- `CAUTION`
- `REFER_CLINIC`
- `URGENT`

`URGENT` and `REFER_CLINIC` block commercial recommendations. `CAUTION` allows conservative OTC
recommendations with warnings. The LLM can explain recommendations but cannot choose safety status,
invent products, recommend products outside the tenant catalog, or override hard filters.

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
