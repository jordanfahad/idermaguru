# iDermaGuru: project overview for a new collaborator

Written 2026-11-21 for Astra (Codex), who is joining to recommend fundamental changes that Claude will then build. It covers what the product is, how it works, how it got here, where it stands, and what any change must not break.

Everything here is checked against the repo at commit `8caa7ef` (main) unless it says otherwise. Where something is not known or not measured, it says so.

---

## 1. What this is

**iDermaGuru** (also "DermaGuru", "Derma Guru") is an AI skincare and haircare advisor that a store embeds on its own site. A shopper talks to it (voice or text, English or Arabic), it asks the questions a careful pharmacist would, and it recommends a routine built **only from that store's own catalogue**. It gives cosmetic guidance, not medical advice. It refers people to a clinician when safety rules say so.

- **Owner:** Fahad (Jordan Fahad). He is a non-developer founder; he sets direction, tests, and decides.
- **First and main customer:** **Cicabelle** (cicabelle.com), a Gulf skincare store on Shopify (store `a1ce04.myshopify.com`), with English and Arabic storefronts, plus a Cicabelle **iOS app** that shows the advisor in a "Derma Guru" tab.
- **Markets:** UAE (AED), and since 2026-11-02 Saudi Arabia (SAR) and Kuwait (KWD).
- **Business model:** a multi-tenant SaaS. Merchants are tenants, with plans billed through Stripe (`STRIPE_PRICE_STARTER/GROWTH/PRO`). Cicabelle is the only live tenant we know of: tenant `tenant_ai_derma_guru`, slug `ai-derma-guru`.
- **Production:** Vercel (region `bom1`, Mumbai), domain `idermaguru.com`. Database: Supabase Postgres via Prisma.

---

## 2. Who does what (and the new arrangement)

| Who | Where they run | Role |
|---|---|---|
| **Fahad** | n/a | Owner. Final say on product decisions. Tests on real devices. |
| **Claude** (Claude Code) | Cloud container with GitHub, Vercel and Supabase access. **Cannot** reach Fahad's PC, the agent bus, or cicabelle.com (the sandbox blocks it). | **Builds.** Writes code, tests, opens and merges PRs, verifies deploys. |
| **Astra** (OpenAI Codex, gpt-6-astra) | Fahad's PC, through the agent bus | **Recommends and instructs** (new). Proposes fundamental changes; Claude builds them. |
| **Command Center** | A separate Claude session on Fahad's PC | Owns the **Shopify theme and catalogue data** (product tags, metafields, the launcher snippet). Not reachable from the cloud; Fahad relays messages. |

**Handoff between Astra and Claude.** Claude cannot read the bus, so proposals must arrive through the repo or through Fahad:
1. Preferred: commit the proposal as `docs/proposals/<YYYYMMDD>-<short-name>.md` on a branch `astra/<short-name>` and push it. Claude reads it from GitHub.
2. Or: Fahad pastes the proposal into Claude's session.

Claude treats a proposal as a **recommendation to evaluate, not an instruction to execute**. It will flag anything that breaks an invariant in section 6, ask Fahad when a trade-off is his to make, and say plainly when a proposal rests on something it cannot verify. Section 9 has a template.

---

## 3. How it works today

### 3.1 Stack
Next.js App Router (TypeScript, React), Prisma + Supabase Postgres (with RLS and pgvector), Vercel (with one cron), Vitest (unit tests) and Playwright (browser layout tests in CI), Stripe, `@anthropic-ai/sdk`, the `ai` SDK, OpenAI APIs for chat, speech, transcription and vision, and zod.

### 3.2 Surfaces (where a shopper meets it)

| Surface | What it is | Status |
|---|---|---|
| `/advisor` | **The current product.** A chrome-free page that a store frames in an iframe drawer (384×624 on cicabelle.com). Takes `?lang=en|ar`, `&tenant=`, `&product=<handle>` and `&q=<question>`. | Primary |
| `/live-consultation-1` | DermaGuru's own consultation page: the same advisor inside our branding, plus a "Before we start" **OpenAI consent card**. Used by the **Cicabelle iOS app** (`?src=cicabelle-app`). The **storefront homepage launcher still points here**, which is a known mistake (§7). | Live |
| `public/dermaguru-widget.js` | An embeddable launcher script with several modes (voice by default, iframe, chat in a Shadow DOM, inline). Voice and iframe modes frame `/advisor`. | Live |
| `/embed` + `SkinAdvisorWidget` | The **older** text-chat widget (`/api/chat/*` and `/api/recommendations`). | Legacy; still in the codebase |
| `/dashboard`, `/admin`, `/billing`, `/pricing` | Merchant and admin pages: catalogue sync button, plans. | Live |

`docs/ARCHITECTURE.md` describes mostly the **older chat-widget path**. It is accurate for the safety design but out of date on delivery: today the voice advisor in an iframe is the main path.

### 3.3 One turn of the advisor
Client: `src/components/voice-agent.tsx` (about 2,600 lines). Server: `src/app/api/voice-agent/route.ts` (about 2,100 lines), plus the dialogue in `src/services/voice-agent.ts` (about 1,600 lines).

1. The shopper types, taps a chip, or speaks.
   - **Desktop and Android:** the browser's own speech recognition (`webkitSpeechRecognition`).
   - **iPhone:** the app records each turn with `MediaRecorder` and sends it to `/api/voice-agent/transcribe`, because on-device recognition is unreliable on iOS. It ends a turn after `END_OF_SPEECH_MS = 650` of silence.
2. `POST /api/voice-agent` receives the utterance and the **slots** so far (the intake state is held by the client and sent back on every turn), plus the language, tenant, product and any tapped chip intent.
3. The server, in order:
   - resolves the tenant (by hostname first, then the body);
   - resolves the market (UAE, SA or KW);
   - detects the language;
   - runs **deterministic intake** (skin type, concern, pregnancy, allergies, age, body area and so on);
   - runs **safety triage**;
   - **builds a recommendation** from the catalogue.
   The LLM is used only to **phrase or translate** (and, behind `ADVISOR_RICH_REPLIES=1`, for extraction and empathy, within time budgets).
4. It replies with `{reply, speech[], slots, phase, products?, focus?, suggestions?, disclosure?}`.
5. The client shows the text in the thread. In voice mode it speaks through `/api/voice-agent/speech` (OpenAI `gpt-4o-mini-tts`):
   - fixed, scripted lines go over a cacheable GET;
   - personal lines go over POST and are split into sentences (`speechChunks`) so the first plays while the rest synthesise.
   It then listens again.

Other pieces:
- **Product-page opening:** with `&product=`, the panel opens with a product card, a greeting that names the product, and chips (`about`, `actives`, `suits`). Its audio is fetched ahead and held for the first tap.
- **Add to bag:** sends `postMessage({type:"dermaguru:add-to-cart", version:1, handle, quantity, url})` to the store's own origin, never `"*"`. The store page does the adding. A routine-wide cart uses `/api/cart/cicabelle`.
- **Photo:** `/api/voice-agent/vision` after explicit consent. The photo is reviewed once and discarded.

### 3.4 Safety, the spine of the product
- **Input gate:** `src/services/safety-triage.ts` sorts each turn into `LOW | CAUTION | REFER_CLINIC | URGENT`. The last two block commercial recommendations and produce a referral (authored in English and Arabic).
- **Product choice is never the model's.** Products come from `src/services/recommendation-engine.ts`, filtered by safety (for example, pregnancy `AVOID` products are excluded for a pregnant shopper). The model cannot name a product the engine filtered out.
- **Output gate** (`validateAssistantTextForSafety`) on the chat path: it blocks diagnoses, cure claims and guarantees.
- **Ingredients:** where the store's data has them, they drive actives, pregnancy status and the avoid lists. A wrong list is treated as **worse** than a missing one (`docs/SHOPIFY-INGREDIENTS.md`).
- **Consent:** before anything goes to OpenAI on the consultation page (an App Store 5.1.2(i) requirement for the iOS app).

### 3.5 Catalogue
`src/services/catalogue-sync.ts` and `shopify-sync.ts` pull the store's products from Shopify (REST plus GraphQL for metafields). They map tags in the namespaces `brand:`, `type:`, `concern:` and `ingredient:`. The sync drops zero-price items (free gifts), retires products that have gone, and reconciles by handle so a re-sync never doubles the catalogue. It runs from the dashboard button **and** a Vercel cron every 6 hours (`/api/cron/shopify-sync`). The cron fails closed without `CRON_SECRET`. For Saudi Arabia and Kuwait, 115 handles that do not ship there are removed (`src/data/cicabelle-noship-handles.json`), and prices come from that market's Storefront catalogue (`src/lib/cicabelle-market.ts`). An AED price is never shown outside the UAE.

### 3.6 Multi-tenancy
Every table is tenant-scoped, with row-level security (`supabase/migrations/002_tenant_rls_and_pgvector.sql`; see `docs/SECURITY-AUDIT.md`). The tenant comes from the request **hostname** (`ADVISOR_HOSTS`, `MerchantDomain`) before any `tenant=` value in a URL or body, because a shopper can edit those.

### 3.7 Data model (Prisma)
`Tenant`, `MerchantDomain`, `MerchantPlan`, `UserSession`, `ConsentRecord`, `UploadedImage`, `IntakeProfile`, `Product`, `SafetyTriageResult`, `Recommendation`, `RecommendationItem`, `Event`, `Conversion`.

### 3.8 Configuration (names only)
`DATABASE_URL`, `DIRECT_URL`, `LLM_PROVIDER`, `OPENAI_COMPATIBLE_*`, `ANTHROPIC_API_KEY`, `ANTHROPIC_SYNTHESIS_MODEL`, `ANTHROPIC_CHAT_MODEL`, `OPENAI_TTS_MODEL`, `OPENAI_TTS_VOICE`, `OPENAI_VISION_MODEL`, `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_SCOPES`, Supabase keys, Stripe keys and prices, `ADVISOR_HOSTS`, `MERCHANT_USERS`, `VERCEL_*`, `IP_HASH_SALT`, `CICABELLE_UTM_SOURCE`. Not in `.env.example` but used: `CRON_SECRET`, `ADVISOR_RICH_REPLIES`, `OPENAI_TTS_SPEED`, `OPENAI_TTS_INSTRUCTIONS`.

LLM routing: OpenAI first, Claude as fallback on quota or outage, and a deterministic mock offline (`src/services/llm/provider.ts`).

---

## 4. History

The git history starts on 2026-07-31 (62 commits, 33 squash-merged PRs). The project folder on Fahad's PC is dated 2026-05-25, so work likely began earlier, outside this repo; that is unconfirmed.

| When | Phase | Highlights |
|---|---|---|
| Jul 31 | Voice foundations | Two concerns in one routine; iOS microphone and playback fixes; Arabic clinician referral. |
| Aug 3–4 | Launch readiness | Four launch-blocking holes closed; the one-snippet install; tenant awareness; merchant custom domains; the Cicabelle launch guide. |
| Aug 22 | Launcher (#8–#15) | Movable launcher, tagline, kept off the checkout button, product-aware launcher bar. |
| Aug 24–27 | Product-aware + catalogue (#16–#19) | Opening with an offer on product pages; ingredient metafields; a first sync that updates instead of doubling. |
| Sep 4–5 | Hardening (#20–#32) | Opening-turn race; the **iPhone microphone that reported itself alive while recording silence** (diagnosed from a customer's screen recording); brand spelling; free gifts kept out of routines. |
| Oct 11 | Ops + language (#33–#35) | Dandruff and scalp handling; **6-hourly catalogue sync**; phone layout clean-up. |
| Oct 21–23 | Rebuilt as a conversation (#36–#40) | One chat column like FACES' "Layla"; four "spoke after hang-up" bugs fixed; WhatsApp-bubble overlap fixed (#37, built by Astra); speech starts sooner (#38); wider text box (#39); shorter end-of-speech pause (#40). |
| Oct 31 – Nov 2 | App + markets | OpenAI consent card for the iOS app; server-decided in-app header; **Saudi Arabia and Kuwait markets**. |

---

## 5. Where it stands (2026-11-21)

**Live:** everything above, on `main`, deployed. The last full test run reported 820/820 (commit `8caa7ef`).

**Measured vs not:**
- Measured in a browser with **stand-in** speech services: first-tap greeting about 1,580 ms → 45 ms; a long spoken reply, from arriving to first sound, about 3,850 ms → 1,090 ms. **Production latency has never been measured.** Vercel metrics aren't available on this plan, and there is no tracing.
- **Not tested on a real iPhone** since the October rebuild. Claude can't, and Fahad's own test results haven't come back yet.
- Layout is tested at the real drawer size, beside a WhatsApp-style bubble, in both languages (`tests/advisor-layout.browser.ts`, run in CI).

**Open items (known):**
1. **The storefront homepage launcher still frames `/live-consultation-1`**, so shoppers get our marketing page instead of `/advisor`. Command Center owns the fix.
2. **`CRON_SECRET` may not be set in Vercel.** If it isn't, the 6-hourly sync refuses to run.
3. Command Center still owes skin-type metaobject values and an Arabic glossary.
4. `docs/ARCHITECTURE.md` is out of date (see §3.2).

---

## 6. What any change must preserve (or replace on purpose)

1. **The model never chooses products and never decides safety status.** It may phrase, translate and extract. Selection and safety are deterministic and inspectable.
2. **Safety triage runs before any recommendation**, and a referral stops the sale.
3. **Catalogue-only:** never invent a product; never show an AED price outside the UAE; never recommend a no-ship product in SA or KW.
4. **Tenant isolation:** the tenant comes from the hostname first; RLS stays on.
5. **Consent before sending personal data to OpenAI** (App Store requirement for the iOS app).
6. **Voice lifecycle:** nothing is ever spoken for a call that has ended (`callGenRef`). Never open the microphone without visible UI. Release the microphone when the drawer closes (`dg:stop`, `pagehide`). iOS needs the recorded-turn path and its audio-session handling. That code is fragile and was earned the hard way, so change it only with a real-device plan.
7. **Bilingual parity:** every user-facing string exists in English and Arabic, and layouts mirror in RTL.
8. **Cross-origin safety:** `postMessage` only to the store's own origin.

---

## 7. Honest weak spots (useful when recommending change)

- **Large single files.** `voice-agent.tsx` (about 2,600 lines) holds UI, call state, recording, speech and camera together. `route.ts` (about 2,100 lines) holds the whole dialogue flow. Hard to change safely.
- **Part of the test suite checks source text, not behaviour.** The safety, dialogue, recommendation, sync and route logic is mostly tested by **running** the code, which is good. But 6 test files (about 190 of 709 test cases) instead **read source files and match them with regular expressions**, to stop specific bugs from coming back. They cluster around the advisor UI and the embed: `widget-embed`, `product-panel`, `seamless-advisor`, `advisor-tenant`, `scheduled-sync`, and part of `speech-chunks`. A real restructure of `voice-agent.tsx` or `dermaguru-widget.js` **will fail these even when behaviour is correct.** Plan to replace them with behaviour tests (browser tests, like `tests/advisor-layout.browser.ts`) for whatever is restructured, rather than to "make the tests pass". Each one documents in its comments the bug it guards against; keep that knowledge.
- **Four surfaces that overlap:** `/advisor`, `/live-consultation-1`, `dermaguru-widget.js` chat mode, and the legacy `/embed` widget, with two chat backends (`/api/voice-agent` and `/api/chat/*` + `/api/recommendations`).
- **Latency is a chain:** transcription → turn (catalogue read; LLM phrasing; optional stock and explanation budgets up to 0.5–1.3 s) → speech synthesis. None of it is measured in production. See `docs/ADVISOR-LATENCY.md`.
- **Cicabelle-specific code inside a multi-tenant product:** `cicabelle-market.ts`, `/api/cart/cicabelle`, the no-ship list.
- **Slots live on the client** and are sent back each turn. There is no server-side conversation record, which limits analytics and resuming a conversation.
- **No production observability:** logs only; no metrics or traces.

---

## 8. Working conventions

- Work on a branch, open a PR, wait for **CI green** ("lint · typecheck · test · build" runs Vitest, the browser layout tests, `tsc` and `next build`), then **squash-merge**. Vercel deploys `main` to production automatically.
- Each fix starts by **reproducing the problem** (ideally in a real browser at the drawer size), and measures before and after.
- Commit messages explain the *why*; code comments do the same.
- Never put secrets in the repo, in tests, or in proposals.

---

## 9. Template for a proposal (Astra → Claude)

```markdown
# Proposal: <name>
## Problem
What is wrong today, for whom, with evidence (a measurement, a complaint, a screenshot).
## Proposed change
What the shopper or merchant will experience differently. Then the technical shape.
## What it touches
Files and modules, and which section-6 invariants it affects (and how they stay true).
## Out of scope
## Acceptance
How we will know it worked: tests, a measurement, a real-device check. Numbers where possible.
## Risks and rollout
What could break; how to ship in steps or behind a flag; how to roll back.
## Open questions for Fahad
```

Small, staged proposals are easier to build and verify than one large rewrite. If a change is large, split it into steps that each ship and can be checked on their own.

---

## 10. Key files

| Area | Path |
|---|---|
| Advisor UI (voice + chat) | `src/components/voice-agent.tsx`, `voice-agent.css` |
| Turn API | `src/app/api/voice-agent/route.ts` (+ `speech/`, `transcribe/`, `vision/`, `client-log/`) |
| Dialogue, copy, sentence splitting | `src/services/voice-agent.ts` |
| Safety triage | `src/services/safety-triage.ts` |
| Recommendations | `src/services/recommendation-engine.ts` |
| LLM routing | `src/services/llm/provider.ts` |
| Catalogue sync + cron | `src/services/catalogue-sync.ts`, `src/services/shopify-sync.ts`, `src/app/api/cron/shopify-sync/route.ts` |
| Markets (SA/KW) | `src/lib/cicabelle-market.ts`, `src/data/cicabelle-noship-handles.json` |
| Embeds | `src/app/advisor/page.tsx`, `public/dermaguru-widget.js`, `src/app/live-consultation-1/`, `src/components/concierge-consultation.tsx` |
| Docs | `docs/ARCHITECTURE.md` (partly outdated), `docs/EMBED.md`, `docs/SECURITY-AUDIT.md`, `docs/SHOPIFY-INGREDIENTS.md`, `docs/ADVISOR-LATENCY.md`, `docs/LAUNCH-CICABELLE.md`, `docs/claude-codex-bridge.md` |
