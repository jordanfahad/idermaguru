# Putting the advisor on cicabelle.com — the actual steps

`docs/EMBED.md` explains the choices. This is the order to do them in, with the
things that will bite you called out where they bite.

Everything below assumes the branch `claude/peaceful-cori-mj17rm` is deployed.

---

## 0. Three things must be true before any snippet goes anywhere

These are not code. Skipping them produces an advisor that works perfectly and
recommends the wrong products, which is worse than one that fails.

**A tenant with the slug `cicabelle` exists.** The whole embed chain passes that
slug; nothing creates it. If it does not exist the advisor resolves no
catalogue and has nothing to recommend. Check in the admin merchants view, or:

```sql
select id, slug, name from "Tenant" where slug = 'cicabelle';
```

**Its catalogue is synced and current.** The advisor checks each product
against the storefront before showing it, but that is a safety net, not a
sync. Products missing from the last sync are marked out of stock, not deleted.

**`DATABASE_URL` is set in the production environment.** Without it the advisor
now resolves an unknown slug to *no* tenant and recommends nothing. That is
deliberate — it used to resolve every slug to the built-in demo tenant and
serve twelve generic seed products as if they were the shop's — but "the
advisor says it can't help" is the failure you get if the database is missing.

---

## 1. Environment variables (Vercel → Settings → Environment Variables)

Set for **Production**:

| Variable | Value | Why |
|---|---|---|
| `DATABASE_URL`, `DIRECT_URL` | the Supabase connection strings | see above |
| `NEXT_PUBLIC_SITE_URL` | `https://idermaguru.com` | absolute URLs in emails and links |
| `OPENAI_COMPATIBLE_API_KEY` | `sk-…` | the advisor's language model |
| `ANTHROPIC_API_KEY` | `sk-ant-…` | fallback when OpenAI is out of tokens |
| `LLM_PROVIDER` | **unset** | leaving it unset enables OpenAI → Claude → mock |
| `IP_HASH_SALT` | a long random string | rate limiting hashes the caller's address |

`LLM_PROVIDER=mock` is the local default and it must **not** reach production —
it serves canned replies. Unset it rather than setting it to anything.

Optional, and both worth setting for a real launch:

| Variable | Value | Why |
|---|---|---|
| `ADVISOR_HOSTS` | `advisor.cicabelle.com=cicabelle` | pins the tenant to the hostname; see step 3 |
| `MERCHANT_USERS` | `owner@cicabelle.com=cicabelle` | lets the merchant open `/dashboard` |

---

## 2. Pick the install

Three shapes. They are not exclusive — the usual answer is **page first, bubble
second**.

|  | Bubble | Page embed | Subdomain |
|---|---|---|---|
| Effort | one script tag | one iframe in a Shopify page | the above + a DNS record |
| Shopper stays on cicabelle.com | yes | yes | no |
| Microphone prompt says | idermaguru.com | idermaguru.com | **cicabelle.com** |
| Tenant can be edited by the shopper | yes (harmless, but yes) | yes | **no** |
| iOS Safari mic reliability | historically flaky in frames | same | first-party, best |

### Bubble — `layout/theme.liquid`, just before `</body>`

```html
<script
  async
  src="https://idermaguru.com/dermaguru-widget.js"
  data-mode="voice"
  data-tenant="cicabelle"
  data-position="bottom-right"
  data-primary="#8f1d2e"
  data-locale="en"
></script>
```

`data-tenant="cicabelle"` is the part that matters and the part that was
missing. Without it the advisor answers from the seed catalogue — a complete,
confident routine built from products Cicabelle does not sell.

`data-mode="voice"` is now the default, so a snippet without it still installs
the voice advisor. Write it anyway; it says what you meant.

### Page — Online Store → Pages → Add page → HTML (`<>`)

```html
<div style="max-width:1200px;margin:0 auto;padding:0 16px">
  <iframe
    src="https://idermaguru.com/advisor?tenant=cicabelle"
    title="Cicabelle skin advisor"
    allow="microphone; camera; autoplay"
    style="width:100%;height:min(900px,88vh);border:0;border-radius:20px;display:block"
    loading="lazy"
  ></iframe>
</div>
```

Then Navigation → Main menu → add an item pointing at `/pages/skin-advisor`.

`allow="microphone; camera; autoplay"` is not optional and each entry earns its
place. Without `microphone` the advisor loads, looks right and cannot hear
anybody. Without `camera` the "let the advisor look at your skin" button is
shown, is tappable, and does nothing. Both fail **silently**, and both work on
our own pages — which is exactly how they reach a merchant unnoticed.

Arabic: add `&lang=ar`.

---

## 3. The subdomain (recommended, and it is a DNS change not a code change)

Point `advisor.cicabelle.com` at this deployment:

1. Vercel → Project → Settings → Domains → add `advisor.cicabelle.com`.
2. In Cicabelle's DNS, add the CNAME Vercel gives you.
3. Set `ADVISOR_HOSTS=advisor.cicabelle.com=cicabelle` and redeploy.

What that buys, beyond the microphone prompt saying the merchant's name:

- **The hostname decides the tenant.** `/api/voice-agent` ignores the request
  body's slug on a host that names a merchant. `data-tenant` lives in the
  storefront's HTML where a shopper can edit it; a Host header is our routing.
- **Nothing else of ours is reachable on their brand.** `src/proxy.ts` serves
  only the advisor, the legal pages, and the APIs the advisor itself calls on
  an advisor host. Blocked API paths 404. This is why the variable exists at
  all — before it, pointing DNS at us also published our admin login on the
  merchant's domain.

Once it resolves, the page embed can drop `?tenant=` and use
`https://advisor.cicabelle.com` as the iframe `src`.

---

## 4. Check it actually works

On a real iPhone, on the real domain, over HTTPS — not the simulator:

- [ ] The bubble opens and the advisor **speaks the greeting** within a second.
- [ ] Tapping the mic prompts for permission and the advisor **hears you**.
- [ ] It recommends **Cicabelle products** — open one and confirm the URL is
      cicabelle.com. This is the check that catches a wrong or missing tenant,
      and nothing else will.
- [ ] "Show your skin" opens the camera. (If it silently does nothing, `allow`
      is missing `camera`.)
- [ ] **Close the launcher, then look at the browser's recording indicator.**
      It must go out. The advisor must stop talking.
- [ ] "Add routine to cart" opens a Cicabelle cart in a new tab with the
      routine in it.
- [ ] Arabic: `?lang=ar` or `data-locale="ar"` — the advisor answers in Arabic
      and the layout is right-to-left.

---

## 5. What is still open

- **Four off-brand rows in the catalogue.** From the repo's brand registry the
  candidates are the bare `acm` handle (mapped to K18, a hair brand), `dental
  -floss`, and the two IPL hair-removal handsets — none of which are skincare.
  They are rows in the merchant's catalogue, not code, so removing them is an
  admin/re-sync job against the live database. Worth confirming with the
  merchant before deleting: product `category` is free-form text and the engine
  matches on it, so there is no hard gate stopping a non-skincare row from
  surfacing if it happens to be tagged with a skin concern.
- **`MerchantUser` accounts.** `MERCHANT_USERS` is an env allowlist that fails
  closed and needs no migration. The intended replacement is a row bound to a
  tenant — see `docs/SECURITY-AUDIT.md`, "Residual / follow-ups".
- **`POST /api/billing/portal`** still trusts a client `customerId`; it is
  super-admin-only for now.
