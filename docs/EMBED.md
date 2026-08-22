# Putting the advisor on cicabelle.com

> Doing it, in order, with the environment variables and the checks:
> **[docs/LAUNCH-CICABELLE.md](./LAUNCH-CICABELLE.md)**. This page is the
> reasoning behind the choices it asks you to make.

## Read this first: there are two advisors in this repo

They are not the same product and they do not share a code path.

| | Voice advisor | Chat widget |
|---|---|---|
| Where | `/live-consultation-1`, `/advisor` | `/embed`, `dermaguru-widget.js` default mode |
| API | `/api/voice-agent` | `/api/chat/*`, `/api/recommendations` |
| Component | `VoiceAgent` | `SkinAdvisorWidget` |

Everything built recently — the distress handling, "whereabouts is it?", the
body and intimate routing, the allergy read-back, "make it more intense", the
sold-out check — is in the **voice advisor** only. The chat widget is the older
build and has none of it.

A snippet with no `data-mode` used to mount the **chat widget**, which is how
the install shown on the merchant dashboard shipped the old advisor while the
voice one reached nobody. The default is now voice: the chat build is opt-in
via `data-mode="chat"` (or `data-mode="iframe"`), so a snippet copied from an
older page still installs the right product. `data-mode="voice"` is still worth
writing — it says what you meant.

---

## Which one: a widget or its own page?

**Give it its own page, and add the bubble second.** Not "either".

A voice advisor asks for a microphone, talks back, and puts a six-to-nine step
routine on screen. A 384px bubble in the corner of a product page is a bad room
for that, and the microphone is harder to get inside a frame. A page has none of
those problems, can be linked from the nav, an email, or an ad, and is where a
shopper who actually wants a consultation is willing to spend four minutes.

The bubble's job is different: it catches the shopper who was not looking for an
advisor. It is worth having — second.

|  | Own page | Floating bubble |
|---|---|---|
| Microphone and camera | First-party, just work | Need `allow="microphone; camera"` on the frame — silent failure without it |
| Room for a 9-step routine | Yes | Cramped on a phone |
| Linkable from nav / email / ads | Yes | No |
| Catches a browsing shopper | No | Yes |
| iOS Safari mic in a cross-origin frame | Reliable | Historically flaky |

That last row is the deciding one. If the microphone is the point, the page is
the safer home for it.

---

## Option 1 — Its own page (recommended)

In Shopify: **Online Store → Pages → Add page**, title it *Skin Advisor*, switch
the editor to HTML (`<>`), and paste:

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

Then **Navigation → Main menu → Add menu item** pointing at
`/pages/skin-advisor`.

Arabic: add `&lang=ar` — `https://idermaguru.com/advisor?tenant=ai-derma-guru&lang=ar`.

`ai-derma-guru`, not `cicabelle`, because that is the slug the 461 Cicabelle
products actually sit under — see
[LAUNCH-CICABELLE.md](./LAUNCH-CICABELLE.md), step 0. There is no `cicabelle`
tenant, and naming one resolves an empty catalogue.

It is also the slug the API defaults to, so omitting `?tenant=` lands on the
same products today. Write it anyway: when the catalogue moves onto its own
tenant, or a second merchant appears, the default stops being Cicabelle. On
`advisor.cicabelle.com` it can be left off for good — the hostname says who the
shop is, in a way the page cannot contradict.

`allow="microphone; camera; autoplay"` is not optional, and every entry in it
earns its place. Without `microphone` the advisor loads, looks correct, and
cannot hear anybody — with no error message. Without `camera` the "let the
advisor look at your skin" button is still shown and still tappable, and does
nothing when pressed. A cross-origin frame is granted neither by default, and
in both cases the failure is silent on the merchant's page while working
perfectly on ours — which is exactly how they get shipped.

### If you would rather it were not an iframe

Point a subdomain at this deployment — `advisor.cicabelle.com` — in Vercel under
**Domains**. Then it is a first-party page of the store's brand, the microphone
prompt says *cicabelle.com*, and there is no frame at all. This is the best
version of the experience and it is a DNS change, not a code change.

---

## Option 2 — Floating bubble on every page

**Online Store → Themes → Edit code → `layout/theme.liquid`**, just before
`</body>`:

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

`data-mode="voice"` is worth writing even though it is now the default — it says
which advisor you meant, and a snippet that says so cannot be changed under you.
Leaving it off used to install the old chat widget; today it installs voice, and
`data-mode="chat"` is how you ask for the older build on purpose.

The advisor is only loaded when a shopper opens the bubble, so the storefront
pays nothing on page views that ignore it.

| Attribute | Meaning |
|---|---|
| `data-mode="voice"` | The default since the launcher was fixed. Write it anyway. |
| `data-tenant` | **Required.** Whose catalogue to recommend from. Overruled by `ADVISOR_HOSTS` when the advisor is served on a host that names a merchant. |
| `data-position` | `bottom-right` (default) or `bottom-left`. |
| `data-offset-bottom` | How far up from the bottom edge. Default `20px`. |
| `data-offset-side` | How far in from the left/right edge. Default `20px`. |
| `data-label` | What the launcher is called. Defaults to the translated "Skincare advisor". |
| `data-tagline` | A second, smaller line under the label. Empty by default — no second line. |
| `data-launcher` | `pill` (default) or `icon` — a round button with the words in a bubble beside it. Voice mode only. |
| `data-primary` | Launcher colour. |
| `data-locale` | `en` or `ar`. |

### Saying what the advisor is for

The pill named the thing without saying it would talk back. `data-tagline`
adds a call-to-action under the name:

```html
data-label="Skincare advisor" data-tagline="Talk to our advisor"
```

Both lines sit inside the one button, so it stays a single tap target and the
pill is only as wide as its longer line. The tagline is hidden while the
advisor is open — by then the shopper has already done what it asked — and the
label swaps to "Close advisor", with the accessible name following the visible
one. Leave `data-tagline` off and the launcher is exactly what it was.

Text is capped at 60 characters and whitespace is collapsed. The launcher is
fixed-position and cannot be scrolled away from, so a paragraph pasted in here
would cover the storefront on a phone.

Arabic is handled: with `data-locale="ar"` the button is marked RTL and the two
lines align to the right edge. Leaving `data-label` off falls back to the
translated default rather than English.

### Two shapes: `pill` and `icon`

```
pill (default)                    icon
╭──────────────────────╮          ╭──────────────────────╮  ╭─────╮
│ Skincare advisor     │          │ Skincare advisor     │  │  ◍  │
│ Talk to our advisor  │          │ Talk to our advisor  │  ╰─────╯
╰──────────────────────╯          ╰──────────────────────╯
one coloured button               light bubble + round brand button
```

`data-launcher="icon"` is the shape most storefront chat widgets use, and the
one to pick if the page already has a WhatsApp bubble — two coloured pills side
by side compete, a bubble and a circle read as a pair.

The circle takes `data-primary` and its glyph takes `data-on-primary`. The
glyph is inline SVG, not a fetched asset: an external image is a request the
storefront pays for and one that can fail, leaving a coloured circle with
nothing in it. It swaps to a × while the advisor is open, and the bubble hides.

The bubble sits on the inward side — left of the circle at `bottom-right`,
right of it at `bottom-left` — and is capped at `min(240px, 58vw)` so it cannot
span a phone.

**Voice mode only.** `data-mode="chat"` draws its launcher from a stylesheet and
has no icon rendering, so it ignores `data-launcher` rather than half-applying
it. Since voice is the default mode, this only matters if you asked for chat by
name.

### When the corner is already taken

Most storefronts already have something bottom-right — a WhatsApp bubble, a
chat launcher, a sticky add-to-cart. `data-position` only offers the other
corner, which is not always the answer, so the two offsets move the launcher
along either axis while keeping the side you want:

```html
data-position="bottom-right" data-offset-bottom="96px"   <!-- above a bubble -->
data-position="bottom-right" data-offset-bottom="45vh"   <!-- mid-right     -->
```

Both take a non-negative CSS length in `px`, `%`, `vh`, `vw`, `rem` or `em`.
Anything else — a `calc()`, a negative, a value with a `;` in it — is ignored
and the launcher falls back to the default corner rather than the value being
pasted into a style attribute.

Raising the launcher shortens the panel by the same amount, because the panel
opens upward from the button. A large offset therefore buys position at the
cost of panel height: at `45vh` the panel is roughly `55vh` tall. Check it on a
short viewport — a landscape phone is the worst case — before shipping it.

---

## Before it goes on the storefront

- **`data-tenant` must be the Cicabelle tenant slug**, and for the bubble it is
  the only thing that says so. It rides the frame's URL to `/advisor` and back
  to the API with every turn. Wrong slug, wrong catalogue — the advisor will
  confidently recommend another store's products.
- **Better: pin the tenant to a hostname.** Add `advisor.cicabelle.com=ai-derma-guru`
  to `ADVISOR_HOSTS` and that host decides, overruling whatever the page says.
  `data-tenant` lives in the storefront's HTML, where a shopper can edit it; a
  Host header is our own routing. With DNS pointed at us there is no reason not
  to.
- **The catalogue must be synced and current.** The advisor checks each
  recommended product against the storefront before showing it, but that is a
  safety net, not a substitute for a sync.
- **Test the microphone on a real iPhone**, not the simulator, on the real
  domain over HTTPS.
- **Check the routine panel on a phone.** It scrolls itself into view when a
  routine arrives; inside a short iframe it can only scroll as far as the frame
  allows, which is why the page embed above is `88vh` and not `600px`.
- **Legal.** The advisor states it is not a doctor and does not diagnose. That
  copy is part of the product and should not be edited out of a merchant page
  wrapping it — DermaGuru is a cosmetic advisor under UAE Federal Decree-Law
  No. 38 of 2024.

## What the shopper actually sees

Where they end up depends on which setup, and the difference is worth being
deliberate about.

**Own page framing the advisor (Option 1).** They click *Skin Advisor* in the
Cicabelle nav and land on `cicabelle.com/pages/skin-advisor`. The Shopify
header, menu and cart icon are still there; the advisor sits in the middle of
that page. **The URL bar still says `cicabelle.com`. They have not left the
store.** This is the recommended setup precisely because of that.

**Linking straight at the subdomain.** They click *Skin Advisor* and the browser
navigates to `advisor.cicabelle.com`. The URL bar changes and the Shopify
header, menu and cart go with it — the advisor is the whole page. The
microphone is first-party and nothing can block it, which is the appeal, but
the shopper is off the storefront until they come back. Worth it only if you
want the advisor to be its own destination, e.g. as an ad landing page.

**Bubble.** They stay exactly where they are and a panel opens over the page.

Note the subdomain is used *inside* the frame in Option 1 — the shopper never
sees it in the URL bar, but the microphone prompt says `advisor.cicabelle.com`
rather than `idermaguru.com`, which is the whole point of pointing it. A
subdomain is still a different origin from `cicabelle.com`, so
`allow="microphone; camera"` is still required.

### Clicking a product, and the cart

Both already work and neither breaks out of the frame:

- **A product card** opens the Cicabelle product page in a **new tab**
  (`target="_blank"`). The consultation stays open in the original tab.
- **"Add routine to cart"** hits `/api/cart/cicabelle`, which resolves each
  product to its Shopify variant id and redirects to a cart permalink —
  `cicabelle.com/cart/<variant>:1,<variant>:1,…` — so the whole routine lands in
  the real Shopify cart in one go, with UTM tags attached. Also a new tab.

Because both open a new tab, a shopper can add the routine and still come back
to a live consultation. That is the behaviour to keep.

## What is not built yet

- **Adding to the cart without leaving the frame.** The button above works, but
  it hands the shopper to Shopify's cart page in a new tab rather than
  incrementing the cart badge in place. Doing it silently needs the AJAX Cart
  API called from the storefront origin — so either a `postMessage` bridge to
  the parent page, or the subdomain setup plus a proxy. Neither exists today.
- **A Shopify app listing.** This is a script tag and an iframe, not an app —
  nothing to submit and no review to pass, which is why it can go live today.

---

## Setting up `advisor.cicabelle.com`

Do this **after** the advisor is live on production — the subdomain serves
`/advisor`, and pointing DNS at a build that does not have that route yet gives
you a 404 on the one page it exists for.

1. **Vercel → the project → Settings → Domains → Add.** Enter
   `advisor.cicabelle.com`. Vercel shows the record to create.
2. **Wherever cicabelle.com's DNS lives** (Shopify admin → Domains → manage →
   DNS settings, if Shopify holds it) add the CNAME Vercel gave you —
   `advisor` → `cname.vercel-dns.com`.
3. **Wait for the certificate.** Vercel issues it automatically, usually within
   a few minutes of the record resolving.
4. **Optional but tidier:** set `ADVISOR_HOSTS=advisor.cicabelle.com` in the
   project's environment variables. Without it, any `advisor.*` host is treated
   as an advisor host, which is the right default but less explicit.

### What that host will and will not serve

The middleware treats an advisor host as a single-purpose surface:

| Path | Behaviour |
|---|---|
| `/` | **Is** the advisor. Rewritten internally, so the address bar stays `advisor.cicabelle.com` — no `/advisor` on the end. |
| `/advisor`, `/api/*`, `/privacy-policy`, `/terms-of-use` | Served |
| Anything else — `/admin`, `/dashboard`, `/pricing`, `/login`, the marketing site | Redirected to `/` |

That last row is the point. Without it a Cicabelle-branded subdomain would also
serve DermaGuru's marketing site, pricing page and **admin login**. Guarded by
`tests/advisor-host.test.ts`.

Nothing about `idermaguru.com` changes.
