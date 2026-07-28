# Putting the advisor on cicabelle.com

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

This matters because the existing one-line install (`dermaguru-widget.js` with
no `data-mode`) mounts the **chat widget**. Shipping that to cicabelle.com would
put the old advisor live. Use `data-mode="voice"`, or the page embed below.

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
| Microphone | First-party, just works | Needs `allow="microphone"` on the frame — silent failure without it |
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
    src="https://idermaguru.com/advisor"
    title="Cicabelle skin advisor"
    allow="microphone; autoplay"
    style="width:100%;height:min(900px,88vh);border:0;border-radius:20px;display:block"
    loading="lazy"
  ></iframe>
</div>
```

Then **Navigation → Main menu → Add menu item** pointing at
`/pages/skin-advisor`.

Arabic: `https://idermaguru.com/advisor?lang=ar`.

`allow="microphone; autoplay"` is not optional. Without it the advisor loads,
looks correct, and cannot hear anybody — with no error message.

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
  data-tenant="cicabelle"
  data-position="bottom-right"
  data-primary="#8f1d2e"
  data-locale="en"
></script>
```

`data-mode="voice"` is the important attribute — it is what selects the advisor
you have been testing. Leave it off and you get the old chat widget.

The advisor is only loaded when a shopper opens the bubble, so the storefront
pays nothing on page views that ignore it.

| Attribute | Meaning |
|---|---|
| `data-mode="voice"` | **Required.** Selects the voice advisor. |
| `data-tenant` | Which catalogue to recommend from. |
| `data-position` | `bottom-right` (default) or `bottom-left`. |
| `data-primary` | Launcher colour. |
| `data-locale` | `en` or `ar`. |

---

## Before it goes on the storefront

- **`data-tenant` must be the Cicabelle tenant slug.** Wrong slug, wrong
  catalogue — the advisor will confidently recommend another store's products.
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
`allow="microphone"` is still required.

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
