# DermaGuru — Build Spec

> **Status:** authored by the build agent from the product directive + existing `docs/ARCHITECTURE.md`.
> This is the source of truth for the rebuild. Where this spec and older docs/code disagree, **this spec wins**.
> **Visual reference:** [`redesign/`](./redesign/) (`01-widget-en.png`, `02-widget-ar.png`, `03-landing-system.png`).

---

## 0. One-paragraph definition

DermaGuru is a **multi-tenant, embeddable AI skincare _advisor_** that merchants drop onto their store. A
shopper describes a concern in natural language (English or Arabic); the advisor replies in a calm,
on-brand chat and recommends **only products that the merchant actually sells**, with a short "why," AED
pricing, and an add-to-cart deep link. It is a **cosmetic / over-the-counter beauty advisor — never a
medical or diagnostic tool.** Safety is the spine: a deterministic gate runs **before and after** every AI
turn, red-flag inputs are routed to "see a professional," and a "not medical advice" line is always on
screen.

---

## 1. Non-negotiables (read first)

These are hard constraints. A change that violates any of these is a defect, regardless of how good it looks.

1. **Advisor, not clinician.** No diagnosis, no disease naming as fact, no "treat / cure / prevent," no
   prescription-strength actives guidance, no guaranteed outcomes. Cosmetic, OTC, educational framing only.
2. **Defense-in-depth safety.** Deterministic **input gate** → grounded LLM → deterministic **output gate**.
   The AI may *explain* a recommendation; it may **never** choose the safety status, invent a product, or
   recommend outside the tenant's catalog.
3. **Red-flag → referral.** `URGENT` / `REFER_CLINIC` triage blocks all commercial recommendations and shows
   a referral message. (Severe/painful/infected/bleeding/rapidly worsening, swelling, breathing difficulty,
   fever, eye involvement, pregnancy-contraindicated actives, etc.)
4. **Grounded only.** Every recommended SKU comes from retrieval over the merchant's real catalog. No
   hallucinated products, prices, or claims.
5. **Persistent disclaimer + consent.** "Educational beauty guidance — not medical advice." is always
   visible; first-use consent is recorded.
6. **Bilingual parity.** English (LTR) and Arabic (RTL) are first-class and visually mirrored — same
   component, `data-locale="ar"`.
7. **Privacy by default.** No PII in logs; IP is salted-hashed; public consultation snapshots are **off** by
   default (PDPL/GDPR). Shopper sessions are anonymous; data export/delete supported.
8. **Stripe is TEST-mode only** until explicitly told otherwise. Never commit secrets.
9. **Deploy only to the existing Vercel project** that owns `idermaguru.com`; keep Deployment Protection on.

---

## 2. Brand & naming

- **Platform / product:** **DermaGuru** (domain `idermaguru.com`). Public-facing advisor names allowed:
  *AI Cosmetologist, AI Derma Guru, AI Skincare Concierge, OTC Skincare Routine Assistant*.
- **Flagship tenant (demo):** **Cicabelle** — the Vercel project is `cicabelle-ai-beauty-guru`; the widget is
  shown branded as Cicabelle. Treat Cicabelle as *tenant #1*, DermaGuru as *the platform that powers it*.
- Per-tenant theming is real: the English demo uses botanical **teal**; the Arabic demo uses **rose**. Both
  are just `--dg-primary` token values.

> If the intended platform name is **not** DermaGuru, this is the one assumption to correct — it only changes
> copy and the logotype, not the architecture.

---

## 3. Design system (the redesign)

Replaces the **three competing visual identities** currently in `globals.css` (calm teal advisor + neon
"brutalist" live-search + pink commerce home) with **one** language: **"clinical-calm / quiet-luxe."**

### 3.1 Color tokens
| Token | Value | Use |
| --- | --- | --- |
| `--dg-ink` | `#1A1714` | Primary text, dark buttons |
| `--dg-muted` | `#6E6660` | Secondary text |
| `--dg-faint` | `#A39B92` | Placeholders, captions |
| `--dg-sand` / `--dg-paper` | `#FAF8F5` / `#F1EEE9` | Canvas / tinted surfaces |
| `--dg-surface` | `#FFFFFF` | Cards, panels |
| `--dg-line` | `rgba(20,17,16,0.09)` | Hairlines |
| `--dg-primary` | `#1F6F5C` (teal) · per-tenant | Brand, CTAs |
| `--dg-primary-dk` / `-tint` | `#12473A` / `#E7F1EE` | Brand depth / wash |
| _(tenant 2)_ rose | `#B75D6E` / `#8A4250` / `#F6E9EC` | Demo Arabic tenant |
| `--dg-gold` | `#9A6B2F` on `#F6EDDC` | **Sponsored** disclosure |
| `--dg-safe` | `#0F7A55` on `#E9F8EF` | Trust / grounded states |
| `--dg-warn` | ink `#7A3F25`, wash `#FFF6EF`, rule `#D2754B` | **Referral / red-flag** state |

Semantic colors (safe/warn/gold) are **fixed** across tenants; only `--dg-primary` (+ derived) is themeable.

### 3.2 Type
- **Display:** editorial serif (ship **Fraunces** or **Instrument Serif**; raster fallback Georgia). Headlines,
  hero, section titles. Warm, trustworthy, "skincare editorial."
- **UI / body:** **Inter** (system sans fallback). 13–16px, line-height 1.5.
- **Arabic:** a high-quality Arabic UI face (ship **IBM Plex Sans Arabic** or **Noto Sans Arabic**); never
  rely on Latin fonts for Arabic.

### 3.3 Shape, depth, motion
- Radii: cards **18–22**, pills **999**, inner elements **12**. Spacing on a 4px grid.
- Shadows: soft, layered, low-opacity, large-blur (no hard "brutalist" offsets). One elevation for the floating
  panel, a lighter one for the launcher.
- Motion: 150–220ms ease-out; panel opens with a small scale+fade; messages fade-up; respect
  `prefers-reduced-motion`.

### 3.4 Components (canonical)
Launcher pill · advisor panel (header + disclaimer bar + chat + composer) · bot/user bubbles · intake chips ·
**product card** (swatch, step label, name, one-line "why", AED price, Add) · **sponsored tag** (gold) ·
**referral card** (warn, side rule, shield) · trust chips · primary/ghost buttons. See the three artboards.

### 3.5 Accessibility
WCAG 2.2 AA contrast; full keyboard path; visible focus rings; ARIA roles on the chat log/inputs; 44px hit
targets; `dir="rtl"` + logical properties for Arabic; reduced-motion honored.

---

## 4. Architecture

```
Shopper ──> <dermaguru-widget> (Shadow DOM, ~7KB) ──cross-origin──> proxy/CORS
              └─ iframe /embed fallback (hostile CSP)
                                   │
                         Next.js App Router (Vercel)
                                   │
        ┌──────────────┬──────────┴───────────┬─────────────────┐
   Supabase Postgres   Anthropic Claude    Stripe (TEST)     Storage
   (RLS + pgvector)    (primary AI)        billing           (Supabase bucket)
                       └─ deterministic mock fallback
```

**Stack decisions (changes from current code):**
- **Data:** **Supabase Postgres** is the single data layer. **Remove Prisma.** Use `@supabase/supabase-js`
  (+ typed schema). Keep/port the existing `supabase/migrations` (RLS + pgvector + `match_*` RPCs).
- **AI:** **Anthropic Claude is primary** (`@anthropic-ai/sdk`). **Remove the OpenAI-first path.** Keep the
  deterministic **mock** as the offline/CI fallback. Routing via `getLLMProvider()` → `FallbackLLMProvider`
  (Claude → mock).
- **Embeddings:** pgvector. Use an embedding model to populate `Product`/`kb_chunks` vectors; until populated,
  the deterministic engine is the grounding source. (Embedding provider is configurable; default to a small,
  cheap model. Vector dimension must match the migration.)
- **Billing:** Stripe **TEST** keys/prices only.
- **Hosting:** the existing Vercel project (`prj_xwlbBYLUueW8bHADufcWTnsH0C09`, owns `idermaguru.com`),
  git-linked, production branch `main`, Deployment Protection ON.

---

## 5. Multi-tenant data model & grounding

- One Supabase Postgres; **Row-Level Security on every tenant-scoped table** keyed off the per-request GUC
  `app.current_tenant_id` (fail-closed: no tenant set ⇒ no rows). Tenant traffic runs through a non-owner role
  wrapped in `withTenantContext()`. JWT deployments may swap to `auth.jwt()->>'tenant_id'`.
- **pgvector** on `Product` + a curated `kb_chunks` knowledge base (global rows + per-tenant overrides), with
  `match_products` / `match_kb_chunks` cosine-similarity RPCs.
- Core tables (port from current schema): `Tenant`, `MerchantPlan`, `Product`, `UserSession`, `ChatMessage`,
  `Recommendation`(+items), `Event`(impression/click), `Conversion`, `KbChunk`, `Consent`.
- **Grounding rule:** recommendations = retrieval over the tenant's catalog → deterministic scoring → optional
  LLM explanation. The LLM is given the retrieved SKUs as the **only** allowed products.

**Recommendation score (unchanged, keep tuned):**
```
final = 0.35·concern_match + 0.20·ingredient_evidence + 0.15·skin_type_fit
      + 0.10·sensitivity_fit + 0.10·price_fit + 0.05·availability + 0.05·commercial_boost
```
Commercial boost is capped, never overrides safety filters; sponsored items are visibly disclosed.

---

## 6. AI layer (Claude)

- **Provider:** Anthropic Claude via `@anthropic-ai/sdk` (Messages API). System prompt carries the advisor
  persona, the catalog/grounding context, and the hard safety rules. Use **prompt caching** on the stable
  system+grounding prefix; consider **tool use** for structured routine output.
- **Model routing (env-overridable):**
  - `ANTHROPIC_SYNTHESIS_MODEL=claude-opus-4-8` — routine synthesis / explanations (quality-first).
  - `ANTHROPIC_CHAT_MODEL=claude-haiku-4-5` — chat turns + intake classification (fast/cheap).
  - Optional mid-tier `claude-sonnet-4-6` for balance.
- **Fallback:** `FallbackLLMProvider` falls to the deterministic **mock** on `ProviderUnavailableError`
  (quota/rate-limit/auth/server/network). Genuine request bugs (e.g. 400) propagate — never swallowed.
  `LLM_PROVIDER=mock` forces offline. `LLM_PROVIDER=anthropic` forces Claude→mock.
- **The model never:** picks safety status, invents products/prices/claims, recommends outside the retrieved
  set, or overrides hard filters.

---

## 7. Safety pipeline (detail)

1. **Input gate** `runSafetyTriage(text, locale)` → `LOW | CAUTION | REFER_CLINIC | URGENT` (deterministic,
   bilingual keyword + pattern rules). `URGENT`/`REFER_CLINIC` ⇒ referral, **no** commerce. `CAUTION` ⇒
   conservative OTC + warnings.
2. **Grounded generation** — Claude explains only retrieved SKUs.
3. **Output gate** `validateAssistantTextForSafety(text)` — re-runs triage on the model's reply **and**
   detects diagnostic conclusions, disease-as-fact, treat/cure/prevent, and guaranteed-result claims. Flagged
   output is replaced with a safe template. Wired into **both** `/api/recommendations` and `/api/chat/message`.
4. **UI** — persistent "not medical advice" line, first-use consent, sponsored disclosure, referral card.

---

## 8. APIs (App Router route handlers)

- **Session/chat:** `POST /api/chat/start`, `POST /api/chat/message`, `POST /api/intake`,
  `POST /api/recommendations`, `POST /api/upload-image` (+ `DELETE`), `POST /api/session/delete`,
  `GET /api/session/export`.
- **Widget:** `GET /api/widget/config` (tenant name, tokens, disclaimer, locale). CORS/OPTIONS via `proxy`.
- **Tracking:** `POST /api/events/{impression,click,conversion}`, `GET /api/r/:itemId` (redirect + attribution).
- **Admin (merchant portal):** tenants, products (+CSV import), analytics, sessions, recommendations,
  sponsored curation, settings.
- **Billing:** `POST /api/billing/checkout` (Stripe Checkout, TEST), `POST /api/billing/webhook`
  (`whsec_…`, TEST), customer-portal link.

All shopper-facing endpoints: anonymous, rate-limited, salted-hash IP, permissive CORS for the widget origin.

---

## 9. The embeddable widget

- Native Web Component `<dermaguru-widget>` in an **open Shadow DOM** (host CSS can't bleed in; widget CSS
  can't leak out). ~7KB initial JS, lazy-builds the panel on first open, fixed positioning (no layout shift).
- Brand via `data-*` → CSS custom properties: `data-primary`, `data-on-primary`, `data-radius`, `data-font`,
  `data-title`, `data-position`, `data-locale` / `data-rtl`, `data-mode="iframe"`.
- Tenant name + disclaimer from `GET /api/widget/config`. Hostile-CSP ⇒ auto-fallback to `/embed` iframe.

```html
<script async src="https://idermaguru.com/dermaguru-widget.js"
  data-tenant="cicabelle" data-primary="#1F6F5C" data-locale="en" data-position="bottom-right"></script>
```

---

## 10. Environment variables

Secrets are set in Vercel (Production + Preview) and `.env.local` — **never committed**. TEST mode for Stripe.

```bash
NEXT_PUBLIC_SITE_URL=https://idermaguru.com
# Supabase (replaces Prisma)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=     # anon/publishable
SUPABASE_SERVICE_ROLE_KEY=                # server-only
# Anthropic (primary AI)
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=                        # sk-ant-… server-only
ANTHROPIC_SYNTHESIS_MODEL=claude-opus-4-8
ANTHROPIC_CHAT_MODEL=claude-haiku-4-5
# Stripe — TEST keys only
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=       # pk_test_…
STRIPE_SECRET_KEY=                        # sk_test_…  server-only
STRIPE_WEBHOOK_SECRET=                    # whsec_…    (test webhook)
STRIPE_PRICE_STARTER=                     # price_…    (test)
STRIPE_PRICE_GROWTH=                      # price_…    (test)
STRIPE_PRICE_PRO=                         # price_…    (test)
# Misc
IP_HASH_SALT=
PUBLIC_SNAPSHOTS_ENABLED=false
CICABELLE_UTM_SOURCE=ai-beauty-guru
```
**Removed:** `OPENAI_COMPATIBLE_*` (OpenAI dropped), `DATABASE_URL` / `DIRECT_URL` (Prisma dropped).

---

## 11. Deployment

- **Target:** existing Vercel project `cicabelle-ai-beauty-guru` (`prj_xwlbBYLUueW8bHADufcWTnsH0C09`,
  team `team_fmDgkjHCTrg1iNgFZ4iysyxQ`) — it owns `idermaguru.com` / `www.idermaguru.com`. **Never create a new
  project.** A pinned `.vercel/project.json` (projectId + orgId) guarantees CLI deploys can't fork a new one.
- **Git:** connect `jordanfahad/idermaguru` to that project; **Production Branch = `main`**. Pushes to feature
  branches create protected **Preview** deploys; `idermaguru.com` updates only on merge to `main`.
- **Protection:** Deployment Protection stays **ON** (login wall) — the demo is not public.
- **Migrations** run against Supabase before traffic.

---

## 12. Definition of Done (acceptance)

- [ ] One unified design system; the 3 legacy identities are gone. Matches the artboards in `redesign/`.
- [ ] Prisma & OpenAI fully removed; Supabase + Claude(+mock) in place; `npm run build` + `npm test` green.
- [ ] Safety: input gate, grounded generation, output gate wired on `/api/recommendations` **and**
      `/api/chat/message`; red-flag → referral; disclaimer + consent always present. Safety tests pass.
- [ ] Grounding: zero recommendations outside the tenant catalog (test-enforced).
- [ ] Bilingual EN/AR parity incl. RTL mirror and Arabic font.
- [ ] Widget: Shadow DOM, brand tokens, iframe fallback, ~7KB, no layout shift.
- [ ] Multi-tenant RLS verified fail-closed; Stripe **TEST** checkout + webhook working.
- [ ] Privacy: salted-hash IP, snapshots off, export/delete working.
- [ ] Deployed to the existing project; domain intact; protection ON.

### Test matrix (must keep/extend)
URGENT & REFER_CLINIC referral · allergy filtering · pregnancy retinoid exclusion · CAUTION conservative
routine · sponsored-unsafe exclusion · output-gate rewrite of diagnosis/cure/guarantee text · grounding
(no off-catalog SKU) · RLS fail-closed · RTL render.

---

## 13. Build phases

1. **Foundations** — remove Prisma; Supabase client + typed schema; port migrations; env wiring; mock-only AI
   so everything builds/tests without spend.
2. **Design system** — tokenize `globals.css` to the one system; rebuild shared UI + the redesigned screens.
3. **Widget** — reskin `<dermaguru-widget>` to the new system; verify Shadow DOM, RTL, tokens, iframe fallback.
4. **AI** — Claude primary (Opus synthesis / Haiku chat) with mock fallback; prompt caching; structured output.
5. **Safety** — re-verify both gates + referral end-to-end; expand tests.
6. **Billing** — Stripe TEST checkout, webhook, plans/portal.
7. **Ship** — pin `.vercel/project.json`; connect git; deploy Preview → review → merge `main`. Protection ON.
</content>
