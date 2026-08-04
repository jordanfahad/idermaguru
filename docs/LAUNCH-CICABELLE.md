# Putting the advisor on cicabelle.com — the actual steps

`docs/EMBED.md` explains the choices. This is the order to do them in, with the
things that will bite you called out where they bite.

Everything below assumes the branch `claude/peaceful-cori-mj17rm` is deployed.

---

## 0. Three things must be true before any snippet goes anywhere

These are not code. Skipping them produces an advisor that works perfectly and
recommends the wrong products, which is worse than one that fails.

**Use the slug that actually holds the catalogue — it is `ai-derma-guru`, not
`cicabelle`.** Checked against the live database on 2026-08-04:

```sql
select t.slug, t.name, count(p.id) as products
from "Tenant" t left join "Product" p on p."tenantId" = t.id
group by t.slug, t.name order by products desc;

--  ai-derma-guru | AI Cosmetologist / AI Derma Guru | 461   <- Cicabelle's catalogue
--  sikabale      | Sikabale / Cicabelle             |   0   <- empty placeholder
```

There is **no `cicabelle` tenant**. All 461 products are `cicabelle.com/products/…`
URLs sitting under the tenant named *AI Derma Guru*, which is also the slug the
API defaults to. The `sikabale` row looks like the intended home and has
nothing in it.

So `data-tenant="cicabelle"` — the obvious guess, and what an earlier draft of
this page told you to use — resolves **no tenant at all**. The advisor would
hold an empty catalogue and recommend nothing. Two ways to be right:

- **Today, no data migration:** use `data-tenant="ai-derma-guru"`, or leave the
  attribute off entirely — that slug is the default.
- **Properly, later:** move the 461 rows onto a `cicabelle` tenant and switch
  the slug in one step. Worth doing before a second merchant exists, because
  until then "the default tenant" and "Cicabelle" are the same row and every
  bug in that area hides.

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
| `ADVISOR_HOSTS` | `advisor.cicabelle.com=ai-derma-guru` | pins the tenant to the hostname; see step 3 |
| `MERCHANT_USERS` | `owner@cicabelle.com=ai-derma-guru` | lets the merchant open `/dashboard` |
| `VERCEL_API_TOKEN` + `VERCEL_PROJECT_ID` | from Vercel | turns on self-serve domain connection — step 3b |

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
  data-tenant="ai-derma-guru"
  data-position="bottom-right"
  data-primary="#8f1d2e"
  data-locale="en"
></script>
```

`data-tenant="ai-derma-guru"` is belt-and-braces **today**: that slug is also
what the API defaults to, so omitting it currently lands on the same 461
products. Write it anyway. The moment the catalogue moves onto its own tenant —
or a second merchant is added — the default stops being Cicabelle, and a
snippet that never said whose shop it was will quietly start recommending
somebody else's.

`data-mode="voice"` is now the default, so a snippet without it still installs
the voice advisor. Write it anyway; it says what you meant.

### Page — Online Store → Pages → Add page → HTML (`<>`)

```html
<div style="max-width:1200px;margin:0 auto;padding:0 16px">
  <iframe
    src="https://idermaguru.com/advisor?tenant=ai-derma-guru"
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

Point `advisor.cicabelle.com` at this deployment. **The order matters**, and it
is not the obvious one:

1. **Vercel → Project → Settings → Domains → add `advisor.cicabelle.com`.**
   Do this *first*. Vercel then tells you the exact record it wants, and it is
   the authority on that — for a **subdomain** it normally asks for a
   **CNAME to `cname.vercel-dns.com`**, not the `A → 76.76.21.21` record that
   is for an apex domain. Adding DNS before the domain exists in Vercel gets
   you a certificate error and a negative cache entry to wait out.

2. **Set `ADVISOR_HOSTS=advisor.cicabelle.com=ai-derma-guru` and redeploy —
   still before the DNS record.** Until that variable is set, the host resolves
   *no* tenant: `/advisor` visited directly has no `?tenant=` to fall back on,
   so the advisor answers from whatever the API defaults to. Setting it first
   means the subdomain is correct from its very first request rather than for
   its second deploy.

   (The host is guarded either way — anything starting `advisor.` is treated as
   an advisor host even with the variable unset, so our marketing site and admin
   login are never exposed on their brand. It is the *tenant* that is missing.)

3. **Now add the DNS record** Vercel asked for, and wait for it to resolve.

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

### 3b. Or let the merchant do all of that themselves

Steps 1–3 are what an operator does. They do not scale past the first merchant,
and no merchant should need a Vercel account to put your product on their shop.

Set `VERCEL_API_TOKEN` and `VERCEL_PROJECT_ID`, and **Your own domain** appears
in `/dashboard`. The merchant types `advisor.theirshop.com`, we register it
against the project with our token, and the console shows the single record to
add — a CNAME for a subdomain, an A record for an apex, because a CNAME on an
apex is illegal and some registrars accept it anyway and break the domain's
mail. It polls and flips to **Live** on its own.

The one step that cannot be automated by anyone is the merchant adding that
record: only the owner of a domain can write DNS for it. Shopify, Webflow and
every platform built on Vercel has the same step. What is removed is the Vercel
account, the project settings page, and the guessing.

A connected-and-verified domain resolves to its merchant from the
`MerchantDomain` table, so `ADVISOR_HOSTS` is no longer needed for it —
though an entry there still wins, since it is set by whoever runs the
deployment rather than by someone typing into a form.

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

- **The four off-brand rows are handled, but not permanently.** They were set
  `inStock = false` on 2026-08-04, which is enough — the advisor excludes
  out-of-stock products. **A catalogue re-sync will revive them**, because an
  import writes `inStock` straight from the feed. The durable fix is for the
  merchant to unpublish them in Shopify. They were:

  | Product | Category | Why it does not belong |
  |---|---|---|
  | Antibacterial Charcoal Dental Floss Picks | `dental floss` | oral care |
  | IceCool IPL Laser Hair Removal Handset | `ipl hair removal devices` | a device |
  | Pro IPL Laser Hair Removal Handset | `ipl hair removal devices` | a device |
  | `[draft version] K18 Leave-in Molecular Repair Hair Mask` | `hair care` | a draft duplicate of a live row |

  Hair care generally is **in** scope — the advisor builds hair routines and
  the catalogue carries ~40 legitimate hair rows. The K18 row above is listed
  only because it is a draft that was published by mistake.

  Worth knowing either way: product `category` is free-form text and the engine
  matches on it, so nothing structurally prevents a non-skincare row from
  surfacing if it is tagged with a skin concern.

- **A few miscategorised rows** found while looking: a Some By Mi eye cream
  filed under `eye shadows`, a HaruHaru cleansing gel under `makeup removers`.
  They are real products in the right shop, so they are a ranking-quality
  issue rather than a launch blocker.
- **`MerchantUser` accounts.** `MERCHANT_USERS` is an env allowlist that fails
  closed and needs no migration. The intended replacement is a row bound to a
  tenant — see `docs/SECURITY-AUDIT.md`, "Residual / follow-ups".
- **`POST /api/billing/portal`** still trusts a client `customerId`; it is
  super-admin-only for now.
