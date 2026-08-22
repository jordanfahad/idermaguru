/*!
 * DermaGuru embeddable widget — native Web Component (Shadow DOM).
 *
 * Drop-in install (no code, any store):
 *   <script async src="https://your-domain.com/dermaguru-widget.js"
 *           data-tenant="ai-derma-guru"
 *           data-position="bottom-right"
 *           data-primary="#1f6f5c"
 *           data-locale="en"></script>
 *
 * Placement: data-position picks the corner ("bottom-right" | "bottom-left").
 * data-offset-bottom and data-offset-side move the launcher along each axis
 * from that corner, taking any non-negative CSS length in px/%/vh/vw/rem/em
 * (default 20px each). A storefront that already has a launcher in the corner
 * can lift ours clear of it without giving up the side it wants:
 *
 *   data-position="bottom-right" data-offset-bottom="45vh"   mid-right
 *   data-position="bottom-right" data-offset-bottom="96px"   above a bubble
 *
 * Wording: data-label renames the launcher; data-tagline puts a sentence in a
 * card BESIDE it. The launcher carries its own name and stays the one line it
 * has always been — a tagline stacked inside it turns the button into a block
 * of brand colour that reads as an advert. Omit data-tagline and there is no
 * card and no row: the launcher is mounted bare, exactly as it was.
 *
 *   data-label="Skincare advisor" data-tagline="Talk to our advisor"
 *
 * Shape: data-launcher="icon" swaps the coloured pill for a round button with
 * those words in a light bubble beside it — the shape most storefront chat
 * widgets use, and the one to pick when the page already has a WhatsApp bubble
 * (two coloured pills compete; a bubble and a circle read as a pair). Voice
 * mode only; the chat mode's launcher comes from a stylesheet and ignores it.
 *
 * Product pages: data-mode="inline" renders a bar WHERE THE TAG SITS rather
 * than a launcher over the page, so it goes in a product template and lands in
 * the layout. data-product tells the advisor what the shopper is looking at —
 * a handle, a URL, an id or an SKU — and it opens already knowing:
 *
 *   <script async src="…/dermaguru-widget.js"
 *           data-mode="inline"
 *           data-product="{{ product.handle }}"
 *           data-tagline="Need advice on this product?"></script>
 *
 * Pages: data-hide-on takes a comma-separated list of paths the widget must
 * not appear on, matched by whole path segment. Set it for the cart at least —
 * a fixed launcher lands on top of a cart page's sticky checkout button, and
 * by then the shopper has decided anyway:
 *
 *   data-hide-on="/cart,/checkout"
 *
 * Isolation: the UI mounts inside a Shadow DOM custom element, so the host
 * store's CSS cannot bleed in and the widget's CSS cannot leak out. For hostile
 * CSP / no-Shadow-DOM environments, set data-mode="iframe" (or it auto-falls back).
 *
 * The widget is a cosmetic skincare ADVISOR, not a medical tool. It shows the
 * "not medical advice" disclaimer and a first-use consent before any chat.
 */
(function () {
  "use strict";

  var TAG = "dermaguru-widget";
  if (window.customElements && customElements.get(TAG)) return;

  var I18N = {
    en: {
      launch: "Skincare advisor",
      close: "Close advisor",
      disclaimer: "Educational beauty guidance — not medical advice.",
      consentTitle: "Before we start",
      consentBody:
        "This is educational beauty guidance to help you build an over-the-counter routine. It does not diagnose, treat, or replace a doctor or dermatologist.",
      consentButton: "I understand — continue",
      greeting: "Hi! Tell me your main skin concern and I’ll suggest a simple routine from this store.",
      placeholder: "e.g. dry skin and dullness",
      send: "Send",
      routine: "Build my routine",
      addToCart: "Add to cart",
      sponsored: "Sponsored",
      thinking: "Thinking…",
      error: "Something went wrong reaching the advisor. Please try again in a moment.",
      empty: "I couldn’t find a confident match in this catalog yet. Try describing your concern a little differently.",
    },
    ar: {
      launch: "مستشار العناية بالبشرة",
      close: "إغلاق",
      disclaimer: "إرشادات تجميلية تثقيفية — ليست نصيحة طبية.",
      consentTitle: "قبل أن نبدأ",
      consentBody:
        "هذه إرشادات تجميلية تثقيفية لمساعدتك في بناء روتين من المنتجات المتاحة دون وصفة. لا تُشخّص أو تعالج أو تحل محل الطبيب أو طبيب الجلدية.",
      consentButton: "أوافق — تابع",
      greeting: "مرحبًا! أخبرني بأهم ما يشغلك في بشرتك وسأقترح روتينًا بسيطًا من هذا المتجر.",
      placeholder: "مثال: جفاف وبهتان البشرة",
      send: "إرسال",
      routine: "اقترح روتيني",
      addToCart: "أضِف إلى السلة",
      sponsored: "مُموّل",
      thinking: "جارٍ التفكير…",
      error: "تعذّر الوصول إلى المستشار. حاول مرة أخرى بعد لحظات.",
      empty: "لم أجد تطابقًا مؤكدًا في هذا الكتالوج بعد. حاول وصف اهتمامك بطريقة مختلفة قليلًا.",
    },
  };

  function t(locale, key) {
    var pack = I18N[locale] || I18N.en;
    return pack[key] != null ? pack[key] : I18N.en[key];
  }

  function el(tag, props, children) {
    var node = document.createElement(tag);
    if (props) {
      for (var k in props) {
        if (k === "class") node.className = props[k];
        else if (k === "text") node.textContent = props[k];
        else if (k === "html") node.innerHTML = props[k];
        else if (k.indexOf("aria") === 0 || k === "role" || k === "dir" || k === "type" || k === "alt" || k === "loading")
          node.setAttribute(k, props[k]);
        else node[k] = props[k];
      }
    }
    (children || []).forEach(function (c) {
      if (c) node.appendChild(c);
    });
    return node;
  }

  function money(value, currency) {
    var n = Number(value);
    if (!isFinite(n)) return "";
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "AED" }).format(n);
    } catch (e) {
      return (currency || "AED") + " " + n.toFixed(2);
    }
  }

  /*
   * How far the launcher sits from the edges it is pinned to.
   *
   * The default 20px corner is wrong for a storefront that already has
   * something in that corner — a WhatsApp bubble, a cookie bar, a sticky
   * add-to-cart. Flipping to the opposite corner is not always the answer, so
   * `data-offset-bottom` / `data-offset-side` let the launcher be nudged along
   * either axis while staying on the side the merchant wants it on.
   *
   * Sanitised, not trusted: these values reach an inline `style` string, and
   * `data-*` lives in the storefront's HTML where anyone with devtools can edit
   * it. Only a bare non-negative number plus a known unit gets through;
   * anything else falls back to the 20px default rather than being pasted into
   * CSS. A shopper editing their own page can only alter their own view, but a
   * value that silently breaks the layout would look like our bug.
   */
  var LENGTH = /^\d+(\.\d+)?(px|%|vh|vw|rem|em)$/;

  function cssLength(value, fallback) {
    var v = (value == null ? "" : String(value)).trim();
    return LENGTH.test(v) ? v : fallback;
  }

  /*
   * What the launcher says.
   *
   * The pill read "Skincare advisor" and nothing else, which names the thing
   * without saying it will talk back — so `data-label` renames it and
   * `data-tagline` adds a second line under it.
   *
   * Capped rather than trusted. These go in as text, so there is nothing to
   * escape, but the launcher is a fixed-position element the shopper cannot
   * scroll away from: a merchant who pastes a paragraph in gets a pill that
   * covers the storefront on a phone, and it would be our bug to look at.
   * Whitespace is collapsed for the same reason a newline would otherwise
   * become a third line nobody designed.
   */
  var LABEL_MAX = 60;

  function labelText(value, fallback) {
    var v = (value == null ? "" : String(value)).replace(/\s+/g, " ").trim();
    return v ? v.slice(0, LABEL_MAX) : fallback;
  }

  /*
   * Pages the widget must stay off.
   *
   * A floating launcher is fixed to the viewport, so on any page with its own
   * sticky footer it lands on top of it. On cicabelle.com/cart that footer is
   * the subtotal and the checkout button — the advisor was covering the one
   * control the page exists to offer. No shape of launcher fixes that; the
   * answer is not to be there.
   *
   * Matched on whole path segments, not `startsWith`: "/cart" has to hide
   * "/cart" and "/cart/anything" while leaving "/cartridges" alone, and a
   * plain prefix test would take a product page down with it.
   *
   * Absent means hide nowhere, so an install that has not asked for this keeps
   * showing the advisor everywhere exactly as it does today.
   */
  function hiddenHere(list, path) {
    if (!list) return false;
    var here = String(path || "/").toLowerCase();
    return String(list)
      .split(",")
      .some(function (raw) {
        var p = raw.trim().toLowerCase();
        if (!p) return false;
        if (p.charAt(0) !== "/") p = "/" + p;
        if (p.length > 1 && p.charAt(p.length - 1) === "/") p = p.slice(0, -1);
        return here === p || here === p + "/" || here.indexOf(p + "/") === 0;
      });
  }

  /*
   * The glyphs for the circular launcher.
   *
   * Inline rather than an <img>: an external asset is a second request the
   * storefront pays for, and a request that can fail — leaving a coloured
   * circle with nothing in it and no way to tell what it does. currentColor
   * means both follow data-on-primary without a second attribute.
   *
   * A speech bubble rather than a microphone. The advisor does listen, but a
   * microphone on a storefront reads as "this is recording you" — the wrong
   * first impression for a button nobody has pressed yet.
   */
  var ICON_CHAT =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">' +
    '<path d="M12 3.2c-4.86 0-8.8 3.3-8.8 7.36 0 2.26 1.22 4.28 3.13 5.62-.14 1.16-.6 2.2-1.35 3.06a.6.6 0 0 0 .6.98c1.9-.44 3.34-1.28 4.25-1.94.7.15 1.43.23 2.17.23 4.86 0 8.8-3.3 8.8-7.95S16.86 3.2 12 3.2Z" fill="currentColor"/>' +
    "</svg>";

  var ICON_CLOSE =
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">' +
    '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>' +
    "</svg>";

  // The inline bar's marks. A spark rather than the speech bubble: in the flow
  // of a product page this is an offer of advice, not a chat window, and every
  // storefront that does this well marks it the same way.
  var ICON_SPARK =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">' +
    '<path d="M12 2.6l1.9 5.4 5.5 2-5.5 2-1.9 5.4-1.9-5.4-5.5-2 5.5-2L12 2.6Z" fill="currentColor"/>' +
    '<path d="M18.6 15.2l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" fill="currentColor" opacity=".7"/>' +
    "</svg>";

  /*
   * Whether this shopper has asked their system not to animate things.
   *
   * Read once: the query is cheap but this is consulted while building, and
   * the setting does not change mid-page-view in any way worth chasing. The
   * stylesheet-driven modes honour the same preference through a media query;
   * the inline bar's styles are inline, so it has to ask.
   */
  var REDUCED_MOTION = (function () {
    try {
      return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (e) {
      return false;
    }
  })();

  var ICON_CHEVRON =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">' +
    '<path d="M7 10l5 5 5-5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' +
    "</svg>";

  function styles() {
    return [
      ":host{all:initial}",
      "*{box-sizing:border-box}",
      ".dg{position:fixed;z-index:2147483647;font-family:var(--dg-font, -apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif);color:var(--dg-ink,#1c1a19);line-height:1.45}",
      ".dg.pos-br{inset:auto var(--dg-offset-x,20px) var(--dg-offset-y,20px) auto}",
      ".dg.pos-bl{inset:auto auto var(--dg-offset-y,20px) var(--dg-offset-x,20px)}",
      ".dg[dir=rtl].pos-br{inset:auto auto var(--dg-offset-y,20px) var(--dg-offset-x,20px)}",
      ".dg[dir=rtl].pos-bl{inset:auto var(--dg-offset-x,20px) var(--dg-offset-y,20px) auto}",
      ".launch{display:inline-flex;align-items:center;gap:9px;border:0;cursor:pointer;background:var(--dg-primary,#1f6f5c);color:var(--dg-on-primary,#fff);font-weight:650;font-size:15px;min-height:52px;padding:0 20px;border-radius:999px;box-shadow:0 10px 30px rgba(20,17,15,.22);transition:transform .18s ease, box-shadow .18s ease}",
      ".launch:hover{transform:translateY(-1px);box-shadow:0 16px 38px rgba(20,17,15,.28)}",
      ".launch:focus-visible{outline:3px solid var(--dg-primary,#1f6f5c);outline-offset:3px}",
      ".dot{width:9px;height:9px;border-radius:50%;background:var(--dg-on-primary,#fff);opacity:.9;flex:none}",
      // The tagline sits BESIDE the launcher, so the pill stays one line. The
      // row is only created when there is a tagline; without one the launcher
      // is the container's direct child exactly as it always was.
      ".row{display:flex;align-items:center;gap:10px;justify-content:flex-end}",
      ".dg.pos-bl .row,.dg[dir=rtl].pos-br .row{flex-direction:row-reverse;justify-content:flex-start}",
      // A card, not bare text: this floats over whatever the shopper has
      // scrolled to, and unbacked words over a product photo are unreadable.
      // Translucent and muted so it reads as an aside rather than competing
      // with the launcher it sits next to.
      ".tagline{background:rgba(255,255,255,.82);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);color:#57514b;border-radius:13px;padding:8px 12px;font-weight:500;font-size:13px;line-height:1.35;box-shadow:0 4px 14px rgba(20,17,15,.10);border:1px solid rgba(20,17,15,.05);max-width:min(240px,58vw)}",
      // The panel opens upward from the launcher, so its ceiling has to follow
      // the launcher up. Left at a flat 100vh-110px, an offset that lifts the
      // launcher to mid-screen pushes the panel's header — and its close
      // button — off the top of the viewport, with no way to scroll to it.
      // At the default 20px offset this is still exactly 100vh - 110px.
      ".panel{display:flex;flex-direction:column;width:min(384px,calc(100vw - 32px));height:min(624px,calc(100vh - var(--dg-offset-y,20px) - 90px));background:var(--dg-bg,#fff);border:1px solid rgba(20,17,15,.08);border-radius:var(--dg-radius,18px);box-shadow:0 30px 80px rgba(20,17,15,.24);overflow:hidden;margin-bottom:14px;opacity:0;transform:translateY(8px) scale(.98);transition:opacity .2s ease, transform .2s ease}",
      ".panel.open{opacity:1;transform:none}",
      ".hd{display:flex;align-items:flex-start;gap:10px;padding:16px 16px 12px;border-bottom:1px solid rgba(20,17,15,.07)}",
      ".hd .mark{width:34px;height:34px;border-radius:10px;background:var(--dg-primary,#1f6f5c);color:var(--dg-on-primary,#fff);display:flex;align-items:center;justify-content:center;font-weight:750;flex:none}",
      ".hd .meta{flex:1;min-width:0}",
      ".hd .name{font-weight:700;font-size:15px;letter-spacing:-.01em;margin:1px 0 2px}",
      ".hd .sub{font-size:11px;color:var(--dg-muted,#7a746d)}",
      ".x{border:0;background:transparent;cursor:pointer;font-size:20px;line-height:1;color:var(--dg-muted,#7a746d);padding:4px;border-radius:8px}",
      ".x:hover{background:rgba(20,17,15,.06);color:var(--dg-ink,#1c1a19)}",
      ".x:focus-visible{outline:2px solid var(--dg-primary,#1f6f5c);outline-offset:1px}",
      ".body{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px;scrollbar-width:thin}",
      ".msg{max-width:86%;padding:11px 13px;border-radius:14px;font-size:14px;white-space:pre-wrap;word-wrap:break-word}",
      ".msg.bot{align-self:flex-start;background:var(--dg-surface,#f4f2ee);border-end-start-radius:5px}",
      ".msg.me{align-self:flex-end;background:color-mix(in srgb, var(--dg-primary,#1f6f5c) 14%, #fff);border-end-end-radius:5px}",
      ".msg.refer{align-self:flex-start;background:#fff7f3;border:1px solid #f3d6c6;border-inline-start:3px solid #d2754b}",
      ".consent{align-self:stretch;background:var(--dg-surface,#f4f2ee);border:1px solid rgba(20,17,15,.08);border-radius:14px;padding:14px}",
      ".consent h4{margin:0 0 6px;font-size:13px;font-weight:700}",
      ".consent p{margin:0 0 12px;font-size:12.5px;color:var(--dg-muted,#5f5a54)}",
      ".btn{display:inline-flex;align-items:center;justify-content:center;border:0;cursor:pointer;background:var(--dg-primary,#1f6f5c);color:var(--dg-on-primary,#fff);font-weight:650;font-size:13.5px;padding:10px 14px;border-radius:11px;transition:filter .15s ease}",
      ".btn:hover{filter:brightness(1.06)}",
      ".btn:focus-visible{outline:3px solid var(--dg-primary,#1f6f5c);outline-offset:2px}",
      ".chips{display:flex;flex-wrap:wrap;gap:8px}",
      ".chip{border:1px solid color-mix(in srgb,var(--dg-primary,#1f6f5c) 35%,#fff);background:#fff;color:var(--dg-ink,#1c1a19);border-radius:999px;padding:7px 12px;font-size:12.5px;cursor:pointer}",
      ".chip:hover{background:var(--dg-surface,#f4f2ee)}",
      ".chip:focus-visible{outline:2px solid var(--dg-primary,#1f6f5c);outline-offset:2px}",
      ".cards{display:flex;flex-direction:column;gap:10px}",
      ".card{display:flex;gap:11px;border:1px solid rgba(20,17,15,.09);border-radius:14px;padding:10px;background:#fff}",
      ".card .thumb{width:60px;height:60px;border-radius:10px;object-fit:cover;background:var(--dg-surface,#f4f2ee);flex:none}",
      ".card .info{flex:1;min-width:0}",
      ".card .nm{font-size:13.5px;font-weight:650;margin:1px 0 2px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}",
      ".card .pr{font-size:13px;font-weight:700;color:var(--dg-primary,#1f6f5c)}",
      ".card .rs{font-size:12px;color:var(--dg-muted,#6b6660);margin:4px 0 8px}",
      ".spons{font-size:9.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#9a6b2f;background:#fbf1e3;border-radius:5px;padding:2px 6px}",
      ".foot{display:flex;gap:8px;align-items:center;padding:12px;border-top:1px solid rgba(20,17,15,.07)}",
      ".foot input{flex:1;min-width:0;border:1px solid rgba(20,17,15,.16);border-radius:11px;padding:11px 12px;font:inherit;font-size:14px;color:inherit;background:#fff}",
      ".foot input:focus{outline:2px solid var(--dg-primary,#1f6f5c);outline-offset:0;border-color:transparent}",
      ".send{flex:none;width:44px;height:44px;border-radius:11px;border:0;cursor:pointer;background:var(--dg-primary,#1f6f5c);color:var(--dg-on-primary,#fff);font-size:17px}",
      ".send:focus-visible{outline:3px solid var(--dg-primary,#1f6f5c);outline-offset:2px}",
      ".typing{display:inline-flex;gap:4px;align-items:center}",
      ".typing i{width:6px;height:6px;border-radius:50%;background:var(--dg-muted,#9a948c);animation:dgb 1s infinite ease-in-out}",
      ".typing i:nth-child(2){animation-delay:.15s}.typing i:nth-child(3){animation-delay:.3s}",
      "@keyframes dgb{0%,80%,100%{opacity:.3;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}",
      "@media (prefers-reduced-motion: reduce){*{transition:none!important;animation:none!important}}",
    ].join("");
  }

  class DermaGuruWidget extends HTMLElement {
    connectedCallback() {
      if (this._mounted) return;
      this._mounted = true;

      var locale = (this.getAttribute("data-locale") || "en").toLowerCase().slice(0, 2);
      var rtl = this.getAttribute("data-rtl") === "true" || locale === "ar";
      this.cfg = {
        origin: this.getAttribute("data-origin") || location.origin,
        tenant: this.getAttribute("data-tenant") || "ai-derma-guru",
        locale: locale,
        rtl: rtl,
        position: this.getAttribute("data-position") === "bottom-left" ? "bl" : "br",
        offsetY: cssLength(this.getAttribute("data-offset-bottom"), "20px"),
        offsetX: cssLength(this.getAttribute("data-offset-side"), "20px"),
        primary: this.getAttribute("data-primary") || "#1f6f5c",
        onPrimary: this.getAttribute("data-on-primary") || "#ffffff",
        label: labelText(this.getAttribute("data-label"), t(locale, "launch")),
        tagline: labelText(this.getAttribute("data-tagline"), ""),
        radius: this.getAttribute("data-radius") || "18px",
        font: this.getAttribute("data-font") || "",
        name: this.getAttribute("data-title") || "Skincare Advisor",
      };
      this.state = {
        open: false,
        started: false,
        sending: false,
        history: [],
        tenantId: null,
        sessionId: null,
        sessionToken: null,
        lastConcern: "",
        disclaimer: "",
      };

      var root = this.attachShadow({ mode: "open" });
      root.appendChild(el("style", { text: styles() }));

      var container = el("div", { class: "dg pos-" + this.cfg.position, dir: this.cfg.rtl ? "rtl" : "ltr" });
      container.style.setProperty("--dg-offset-y", this.cfg.offsetY);
      container.style.setProperty("--dg-offset-x", this.cfg.offsetX);
      container.style.setProperty("--dg-primary", this.cfg.primary);
      container.style.setProperty("--dg-on-primary", this.cfg.onPrimary);
      container.style.setProperty("--dg-radius", this.cfg.radius);
      if (this.cfg.font) container.style.setProperty("--dg-font", this.cfg.font);
      this.container = container;

      this.launchLabel = el("span", { text: this.cfg.label });
      this.launch = el(
        "button",
        { class: "launch", type: "button", "aria-label": this.cfg.label, "aria-expanded": "false" },
        [el("span", { class: "dot" }), this.launchLabel],
      );
      this.launch.addEventListener("click", this.toggle.bind(this));

      // Same rule as the voice launcher: the button carries its own name and
      // the tagline sits beside it, so the launcher stays the one-line pill it
      // has always been. Without a tagline there is no row at all, which keeps
      // the arrangement identical for everyone already installed.
      if (this.cfg.tagline) {
        this.launchTagline = el("span", { class: "tagline", text: this.cfg.tagline });
        this.row = el("div", { class: "row" }, [this.launchTagline, this.launch]);
        container.appendChild(this.row);
      } else {
        this.row = this.launch;
        container.appendChild(this.launch);
      }
      root.appendChild(container);

      this._onKey = (e) => {
        if (e.key === "Escape" && this.state.open) this.close();
      };
      document.addEventListener("keydown", this._onKey);
    }

    disconnectedCallback() {
      if (this._onKey) document.removeEventListener("keydown", this._onKey);
    }

    toggle() {
      this.state.open ? this.close() : this.open();
    }

    open() {
      if (!this.panel) this.buildPanel();
      this.state.open = true;
      this.launch.setAttribute("aria-expanded", "true");
      this.panel.style.display = "flex";
      requestAnimationFrame(() => this.panel.classList.add("open"));
      this.launchLabel.textContent = t(this.cfg.locale, "close");
      this.launch.setAttribute("aria-label", t(this.cfg.locale, "close"));
      if (this.launchTagline) this.launchTagline.style.display = "none";
      if (!this.state.started) this.start();
      if (this.input) this.input.focus();
    }

    close() {
      this.state.open = false;
      this.launch.setAttribute("aria-expanded", "false");
      this.launchLabel.textContent = this.cfg.label;
      this.launch.setAttribute("aria-label", this.cfg.label);
      // "" rather than a value: hands the card back to the stylesheet instead
      // of pinning it to whatever display happened to be right today.
      if (this.launchTagline) this.launchTagline.style.display = "";
      if (this.panel) {
        this.panel.classList.remove("open");
        var p = this.panel;
        setTimeout(() => {
          if (!this.state.open) p.style.display = "none";
        }, 200);
      }
      this.launch.focus();
    }

    buildPanel() {
      var loc = this.cfg.locale;
      var initial = (this.cfg.name || "S").trim().charAt(0).toUpperCase();

      this.headName = el("div", { class: "name", text: this.cfg.name });
      var x = el("button", { class: "x", type: "button", "aria-label": t(loc, "close"), text: "×" });
      x.addEventListener("click", this.close.bind(this));
      var header = el("div", { class: "hd" }, [
        el("div", { class: "mark", text: initial }),
        el("div", { class: "meta" }, [this.headName, el("div", { class: "sub", text: t(loc, "disclaimer") })]),
        x,
      ]);

      this.body = el("div", { class: "body", role: "log", "aria-live": "polite" });

      this.input = el("input", { type: "text", "aria-label": t(loc, "placeholder"), placeholder: t(loc, "placeholder") });
      this.input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") this.submit();
      });
      var send = el("button", { class: "send", type: "button", "aria-label": t(loc, "send"), text: "↑" });
      send.addEventListener("click", this.submit.bind(this));
      this.foot = el("div", { class: "foot" }, [this.input, send]);
      this.foot.style.display = "none";

      this.panel = el("div", { class: "panel", role: "dialog", "aria-modal": "false", "aria-label": this.cfg.name }, [
        header,
        this.body,
        this.foot,
      ]);
      this.panel.style.display = "none";
      // Before the ROW, not the button: with a tagline the button is nested
      // inside the row, so inserting against it would put the panel in the
      // row and lay it out beside the launcher instead of above it.
      this.container.insertBefore(this.panel, this.row);
    }

    addMsg(role, text) {
      var cls = role === "user" ? "msg me" : role === "refer" ? "msg refer" : "msg bot";
      var node = el("div", { class: cls, text: text });
      this.body.appendChild(node);
      this.body.scrollTop = this.body.scrollHeight;
      return node;
    }

    showConsent() {
      var loc = this.cfg.locale;
      var card = el("div", { class: "consent" }, [
        el("h4", { text: t(loc, "consentTitle") }),
        el("p", { text: this.state.disclaimer || t(loc, "consentBody") }),
      ]);
      var btn = el("button", { class: "btn", type: "button", text: t(loc, "consentButton") });
      btn.addEventListener("click", () => {
        try {
          localStorage.setItem("dg-consent-" + this.cfg.tenant, "1");
        } catch (e) {}
        card.remove();
        this.beginChat();
      });
      card.appendChild(btn);
      this.body.appendChild(card);
    }

    start() {
      this.state.started = true;
      var consented = false;
      try {
        consented = localStorage.getItem("dg-consent-" + this.cfg.tenant) === "1";
      } catch (e) {}
      if (consented) this.beginChat();
      else this.showConsent();
    }

    beginChat() {
      var loc = this.cfg.locale;
      this.foot.style.display = "flex";
      this.addMsg("bot", t(loc, "greeting"));
      var chip = el("button", { class: "chip", type: "button", text: t(loc, "routine") });
      chip.addEventListener("click", () => {
        this.recommend(this.state.lastConcern || (this.input && this.input.value.trim()) || "");
      });
      this.body.appendChild(el("div", { class: "chips" }, [chip]));
      this.input.focus();

      // Anonymous session for analytics + profile/reorder features (no PII).
      this.api("/api/chat/start", { tenantSlug: this.cfg.tenant, locale: loc, sourceUrl: location.href })
        .then((data) => {
          if (!data) return;
          this.state.sessionId = data.sessionId || null;
          this.state.sessionToken = data.sessionToken || null;
          this.state.tenantId = data.tenant && data.tenant.id ? data.tenant.id : null;
          if (data.disclaimer) this.state.disclaimer = data.disclaimer;
        })
        .catch(() => {});
    }

    submit() {
      var text = (this.input.value || "").trim();
      if (!text || this.state.sending) return;
      this.input.value = "";
      this.state.lastConcern = text;
      this.addMsg("user", text);
      this.state.history.push({ role: "user", content: text });
      this.sendTyping(true);
      this.state.sending = true;

      this.api("/api/chat/message", {
        tenantSlug: this.cfg.tenant,
        sessionId: this.state.sessionId,
        messages: this.state.history,
      })
        .then((data) => {
          this.sendTyping(false);
          this.state.sending = false;
          if (!data) return this.addMsg("refer", t(this.cfg.locale, "error"));
          var blocked = data.safety && data.safety.recommendationAllowed === false;
          var reply = data.message || t(this.cfg.locale, "greeting");
          this.addMsg(blocked ? "refer" : "bot", reply);
          if (!blocked) this.state.history.push({ role: "assistant", content: reply });
        })
        .catch(() => {
          this.sendTyping(false);
          this.state.sending = false;
          this.addMsg("refer", t(this.cfg.locale, "error"));
        });
    }

    recommend(concern) {
      if (this.state.sending) return;
      var c = (concern || "").trim();
      if (!c) {
        this.input.focus();
        this.addMsg("bot", t(this.cfg.locale, "placeholder"));
        return;
      }
      this.sendTyping(true);
      this.state.sending = true;
      this.api("/api/recommendations", { tenantSlug: this.cfg.tenant, sessionId: this.state.sessionId, concern: c })
        .then((data) => {
          this.sendTyping(false);
          this.state.sending = false;
          if (!data) return this.addMsg("refer", t(this.cfg.locale, "error"));
          var rec = data.recommendation || {};
          var items = rec.items || [];
          var blocked = rec.safety && rec.safety.recommendationAllowed === false;
          if (blocked || !items.length) {
            this.addMsg("refer", rec.summary || t(this.cfg.locale, "empty"));
            return;
          }
          if (data.explanation) this.addMsg("bot", data.explanation);
          this.renderCards(items, data.id);
        })
        .catch(() => {
          this.sendTyping(false);
          this.state.sending = false;
          this.addMsg("refer", t(this.cfg.locale, "error"));
        });
    }

    renderCards(items, recommendationId) {
      var loc = this.cfg.locale;
      var wrap = el("div", { class: "cards" });
      items.forEach((item) => {
        var p = item.product || {};
        var nm = el("div", { class: "nm" }, [el("span", { text: p.name || "Product" })]);
        if (item.sponsored) nm.appendChild(el("span", { class: "spons", text: t(loc, "sponsored") }));

        var info = el("div", { class: "info" }, [nm, el("div", { class: "pr", text: money(p.price, p.currency) })]);
        if (item.reason) info.appendChild(el("div", { class: "rs", text: item.reason }));
        var cta = el("button", { class: "btn", type: "button", text: t(loc, "addToCart") });
        cta.addEventListener("click", () => {
          this.track("/api/events/click", p.id, recommendationId, item.id);
          this.track("/api/events/add-to-cart", p.id, recommendationId, item.id);
          if (p.url) window.open(p.url, "_blank", "noopener");
        });
        info.appendChild(cta);

        var children = [];
        if (p.imageUrl) children.push(el("img", { class: "thumb", src: p.imageUrl, alt: "", loading: "lazy" }));
        children.push(info);
        wrap.appendChild(el("div", { class: "card" }, children));
        this.track("/api/events/impression", p.id, recommendationId, item.id);
      });
      this.body.appendChild(wrap);
      this.body.scrollTop = this.body.scrollHeight;
    }

    sendTyping(on) {
      if (on) {
        this._typing = el("div", { class: "msg bot", "aria-label": t(this.cfg.locale, "thinking") }, [
          el("span", { class: "typing", html: "<i></i><i></i><i></i>" }),
        ]);
        this.body.appendChild(this._typing);
        this.body.scrollTop = this.body.scrollHeight;
      } else if (this._typing) {
        this._typing.remove();
        this._typing = null;
      }
    }

    api(path, payload) {
      return fetch(this.cfg.origin + path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }).then((r) => (r.ok ? r.json() : null));
    }

    track(path, productId, recommendationId, recommendationItemId) {
      if (!this.state.tenantId || !productId) return; // events require resolved ids
      var body = { tenantId: this.state.tenantId, sessionId: this.state.sessionId, productId: productId };
      if (recommendationId) body.recommendationId = recommendationId;
      if (recommendationItemId) body.recommendationItemId = recommendationItemId;
      try {
        fetch(this.cfg.origin + path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          keepalive: true,
        }).catch(() => {});
      } catch (e) {}
    }
  }

  // ---- iframe fallback (hostile CSP / no Shadow DOM) -----------------------
  function mountIframe(origin, tenant, position, offsets) {
    var offsetY = (offsets && offsets.y) || "20px";
    var offsetX = (offsets && offsets.x) || "20px";
    var root = el("div", {});
    root.style.cssText =
      "position:fixed;z-index:2147483647;bottom:" +
      offsetY +
      ";" +
      (position === "bottom-left" ? "left:" : "right:") +
      offsetX;
    var frame = el("iframe", { title: "DermaGuru skincare advisor" });
    frame.src = origin + "/embed?tenant=" + encodeURIComponent(tenant);
    // This mode pins an open panel rather than a launcher, so the offset eats
    // into its height directly — same reasoning as the shadow-DOM panel above.
    frame.style.cssText =
      "border:0;width:min(384px,calc(100vw - 32px));height:min(624px,calc(100vh - " +
      offsetY +
      " - 90px));border-radius:18px;box-shadow:0 30px 80px rgba(20,17,15,.24);background:#fff";
    root.appendChild(frame);
    document.body.appendChild(root);
  }

  // ---- voice advisor (data-mode="voice") ----------------------------------
  /*
   * The talking advisor, in a launcher the shopper opens.
   *
   * Three things this does that the chat modes above do not, and each of them
   * is the difference between working and not:
   *
   *  - allow="microphone" on the frame. A cross-origin iframe gets no
   *    microphone unless the host page delegates it, and the failure is silent:
   *    the shopper taps the mic and nothing at all happens.
   *  - The frame is built on first open, not on page load. The advisor is a
   *    React application; loading it on every page view of a storefront is a
   *    cost the merchant pays on traffic that never opens it.
   *  - A real launcher button. The plain iframe mode pins an open panel to the
   *    corner of every page, which is a lot of storefront to give up.
   */
  /*
   * The advisor as a bar inside the page, rather than floating over it.
   *
   * data-mode="inline" renders where the script tag sits, so a merchant puts
   * it in their product template and it lands in the layout — above the
   * add-to-cart, under the price, wherever they choose. Three things follow
   * from being in the flow instead of fixed to the viewport:
   *
   *  - It cannot cover anything. The floating launcher landed on cart pages'
   *    sticky checkout button; a bar in the document moves the page down
   *    instead, which is what data-hide-on had to work around.
   *  - It can be about the product. A launcher that appears on every page can
   *    only offer a general invitation; a bar placed in a product template
   *    knows which product it is under, and data-product carries that through
   *    so the advisor opens already knowing.
   *  - It is visible without being pressed. A shopper reads the page; the
   *    invitation is in what they are already reading rather than in a corner
   *    they have learned to ignore.
   *
   * The panel it opens is the same advisor in the same frame as the launcher —
   * only the thing that opens it differs.
   */
  function mountInline(origin, cfg) {
    var loc = cfg.locale === "ar" ? "ar" : "en";
    var open = false;
    var frame = null;

    var label = labelText(cfg.label, t(loc, "launch"));
    var tagline = labelText(cfg.tagline, "");
    var primary = cfg.primary || "#1f6f5c";
    var onPrimary = cfg.onPrimary || "#fff";

    var root = el("div", {});
    root.style.cssText = "margin:14px 0;font:500 14px/1.4 system-ui,sans-serif";
    if (loc === "ar") root.setAttribute("dir", "rtl");

    var bar = el("button", { type: "button" });
    bar.style.cssText =
      "display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;cursor:pointer;" +
      "border:0;border-radius:14px;padding:13px 16px;text-align:" + (loc === "ar" ? "right" : "left") + ";" +
      "font:inherit;background:" + primary + ";color:" + onPrimary + ";" +
      // Width, padding and radius — the three things that change as the bar
      // draws itself in to an icon. Not position: pinning changes that, and
      // animating it would slide the bar across the page from where it was.
      (REDUCED_MOTION ? "" : "transition:width .26s ease,padding .26s ease,border-radius .26s ease;");

    var glyph = el("span", { html: ICON_SPARK });
    glyph.style.cssText = "flex:none;display:flex;align-items:center";
    bar.appendChild(glyph);

    var words = el("span", {});
    // nowrap so the sentence clips as the bar narrows rather than reflowing
    // into a taller stack on its way down to an icon.
    words.style.cssText =
      "flex:1;min-width:0;white-space:nowrap;" + (REDUCED_MOTION ? "" : "transition:opacity .18s ease;");
    // The tagline leads here, not the name. On a product page the useful line
    // is the offer — "need advice on this?" — and the advisor's name is the
    // answer to it rather than the headline.
    var lead = el("span", { text: tagline || label });
    lead.style.cssText = "display:block;font-weight:600";
    words.appendChild(lead);
    if (tagline) {
      var sub = el("span", { text: label });
      sub.style.cssText = "display:block;font-weight:500;font-size:12.5px;opacity:.82;margin-top:1px";
      words.appendChild(sub);
    }
    bar.appendChild(words);

    var chevron = el("span", { html: ICON_CHEVRON });
    chevron.style.cssText =
      "flex:none;display:flex;align-items:center;opacity:.9;" +
      (REDUCED_MOTION ? "" : "transition:opacity .18s ease,transform .2s ease;");
    bar.appendChild(chevron);

    // Hidden until opened, and built on first open like the launcher's — the
    // advisor is a React application and a product page should not pay for it
    // on every view.
    var panel = el("div", {});
    panel.style.cssText =
      "display:none;overflow:hidden;margin-top:10px;border-radius:16px;" +
      "height:min(620px,80vh);border:1px solid rgba(20,17,15,.10);background:#fff";

    bar.setAttribute("aria-expanded", "false");
    bar.addEventListener("click", function () {
      open = !open;
      if (open && !frame) {
        frame = el("iframe", { title: label });
        frame.setAttribute("allow", "microphone; camera; autoplay; clipboard-write");
        frame.src =
          origin +
          "/advisor?lang=" +
          encodeURIComponent(loc) +
          (cfg.tenant ? "&tenant=" + encodeURIComponent(cfg.tenant) : "") +
          // What the shopper is looking at. Encoded because a merchant may
          // pass a full URL rather than a handle.
          (cfg.product ? "&product=" + encodeURIComponent(cfg.product) : "");
        frame.style.cssText = "border:0;width:100%;height:100%;display:block";
        panel.appendChild(frame);
      }
      panel.style.display = open ? "block" : "none";
      // Same hang-up as the launcher: hiding a frame does not stop the
      // document inside it, and a shopper who has collapsed the bar must not
      // be left with a live microphone on a product page.
      if (!open && frame && frame.contentWindow) {
        try {
          frame.contentWindow.postMessage({ type: "dg:stop" }, origin);
        } catch (e) {
          // Not loaded yet — nothing to stop.
        }
      }
      bar.setAttribute("aria-expanded", open ? "true" : "false");
      chevron.style.transform = open ? "rotate(180deg)" : "";
      // Released here rather than waiting for the next scroll: the panel hangs
      // off the bar in the document, so a bar still pinned to the bottom of
      // the screen would leave the conversation it just opened stranded up the
      // page with nothing pointing at it.
      if (open) setPinned(false);
      // Scrolls the advisor into view rather than opening it below the fold,
      // which on a phone is indistinguishable from the button doing nothing.
      if (open && panel.scrollIntoView) {
        try {
          panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
        } catch (e) {
          panel.scrollIntoView();
        }
      }
    });

    /*
     * Pinning, and why the bar sits inside a slot.
     *
     * Read once on the way down the page, an inline bar is then gone. So once
     * its place in the document passes the top of the viewport it pins to the
     * bottom of the screen — and tucks away again while the shopper is
     * scrolling DOWN through the description, returning the moment they scroll
     * up. Out of the way while they are reading; there the instant they look
     * for it.
     *
     * `slot` is what makes that possible without the page lurching. A pinned
     * bar is position:fixed and therefore out of the flow, so the space it
     * occupied would collapse and every pixel below it would jump upward — on
     * a phone, mid-scroll, that reads as the page glitching. The slot keeps
     * the height while the bar is away.
     */
    var slot = el("div", {});
    slot.appendChild(bar);
    root.appendChild(slot);
    root.appendChild(panel);

    // How high the pinned bar sits. data-offset-bottom already exists, is
    // already validated and already means exactly this, so a storefront whose
    // corner is taken — Cicabelle has a WhatsApp bubble down there — raises it
    // with the attribute it has for the floating launcher rather than a second
    // one invented for this mode.
    /*
     * Pinned, the bar has two shapes.
     *
     * Expanded it is the full sentence. It says that once — for five seconds —
     * and then draws itself in to the left until only the spark is left: a
     * button the width of its own icon, out of everyone's way.
     *
     * Hiding it outright was the first attempt and it was wrong. An offer the
     * shopper cannot see is an offer they do not have. Drawing in keeps it
     * reachable at every point of the page while giving the page back.
     *
     * Scrolling down draws it in at once — they are reading, not looking for
     * us. Scrolling up puts the sentence back for another five seconds,
     * because coming back up a page is what looking for something looks like.
     */
    var PEEK_MS = 5000;
    var PUCK = 56;

    var pinBottom = cssLength(cfg.offsetY, "12px");
    var pinned = false;
    var drawnIn = false;
    var lastY = 0;
    var ticking = false;
    var peekTimer = null;

    function stopPeekTimer() {
      if (peekTimer) {
        clearTimeout(peekTimer);
        peekTimer = null;
      }
    }

    function shape() {
      if (!pinned) return;
      if (drawnIn) {
        bar.style.width = PUCK + "px";
        bar.style.padding = "0";
        bar.style.borderRadius = "999px";
        bar.style.justifyContent = "center";
        words.style.opacity = "0";
        chevron.style.opacity = "0";
      } else {
        bar.style.width = "calc(100vw - 24px)";
        bar.style.padding = "13px 16px";
        bar.style.borderRadius = "14px";
        bar.style.justifyContent = "";
        words.style.opacity = "1";
        chevron.style.opacity = ".9";
      }
    }

    function drawIn(next) {
      if (next === drawnIn) return;
      drawnIn = next;
      shape();
    }

    /** Show the whole sentence, then draw back in on its own. */
    function peek() {
      drawIn(false);
      stopPeekTimer();
      peekTimer = setTimeout(function () {
        peekTimer = null;
        drawIn(true);
      }, PEEK_MS);
    }

    function setPinned(next) {
      if (next === pinned) return;
      pinned = next;
      if (pinned) {
        // Measured before the bar leaves the flow, or there is nothing to
        // measure.
        slot.style.height = (bar.offsetHeight || 0) + "px";
        bar.style.position = "fixed";
        // Anchored on the left edge only. With both edges pinned the width
        // could not be animated at all, and drawing in to the left is the
        // entire gesture.
        bar.style.left = "12px";
        bar.style.right = "auto";
        bar.style.bottom = pinBottom;
        bar.style.height = PUCK + "px";
        // So the sentence clips as the bar narrows instead of reflowing into
        // a taller and taller stack on its way down to an icon.
        bar.style.overflow = "hidden";
        // Under the advisor's own launcher z-index, above a storefront's
        // ordinary furniture.
        bar.style.zIndex = "2147482000";
        bar.style.boxShadow = "0 10px 30px rgba(20,17,15,.24)";
        drawnIn = false;
        shape();
        peek();
      } else {
        stopPeekTimer();
        drawnIn = false;
        slot.style.height = "";
        bar.style.position = "";
        bar.style.left = "";
        bar.style.right = "";
        bar.style.bottom = "";
        bar.style.height = "";
        bar.style.overflow = "";
        bar.style.width = "100%";
        bar.style.padding = "13px 16px";
        bar.style.borderRadius = "14px";
        bar.style.justifyContent = "";
        bar.style.zIndex = "";
        bar.style.boxShadow = "";
        words.style.opacity = "1";
        chevron.style.opacity = ".9";
      }
    }

    function onScroll() {
      // Coalesced to one frame. This runs on every scroll event of a
      // merchant's storefront, and reading layout in the event itself is how a
      // widget makes somebody else's page feel broken.
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        var y = window.pageYOffset || (document.documentElement && document.documentElement.scrollTop) || 0;
        var dy = y - lastY;
        lastY = y;

        // Never pinned while the advisor is open: the panel hangs off the bar,
        // and a bar that flies to the bottom of the screen without it would
        // leave the conversation stranded up the page.
        if (open) {
          setPinned(false);
          return;
        }

        var wasPinned = pinned;
        setPinned(slot.getBoundingClientRect().bottom < 0);
        if (!pinned) return;
        // Pinning happens on the way DOWN the page, so without this the very
        // frame that summons the bar also draws it in and the sentence is
        // never read. The first five seconds belong to the peek; the scroll
        // direction only starts deciding on the frame after.
        if (!wasPinned) return;
        // A threshold rather than a sign test: a pixel of rubber-banding at
        // the end of a scroll would otherwise flicker it in and out.
        if (dy > 6) {
          // Reading, not looking for us — and no timer left to wait on.
          stopPeekTimer();
          drawIn(true);
        } else if (dy < -6) {
          peek();
        }
      });
    }

    if (window.addEventListener) {
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onScroll, { passive: true });
    }

    // Where the script tag sits, so the merchant chooses the position by
    // choosing where to paste. insertBefore rather than appendChild to body:
    // the point of this mode is that it lands in the layout.
    if (cfg.script && cfg.script.parentNode) cfg.script.parentNode.insertBefore(root, cfg.script);
    else document.body.appendChild(root);
  }

  function mountVoice(origin, cfg) {
    var offsetY = cfg.offsetY || "20px";
    var offsetX = cfg.offsetX || "20px";
    var side = (cfg.position === "bottom-left" ? "left:" : "right:") + offsetX;
    var loc = cfg.locale === "ar" ? "ar" : "en";
    var open = false;
    var frame = null;

    var openText = t(loc, "launch");
    var closeText = t(loc, "close");
    var labelOpen = labelText(cfg.label, openText);
    var tagline = labelText(cfg.tagline, "");
    var iconMode = cfg.launcher === "icon";

    var root = el("div", {});
    root.style.cssText = "position:fixed;z-index:2147483647;bottom:" + offsetY + ";" + side;

    var panel = el("div", {});
    // Height is measured from the launcher, not the floor: the panel stacks
    // above the button, so an offset that lifts the button has to take the
    // same distance off the panel or its top runs past the viewport. At the
    // default 20px and no tagline this is the original 100vh - 120px.
    //
    // The tagline used to stack inside the pill and cost a line of height, so
    // this allowance grew to compensate. Now it sits BESIDE the launcher, so
    // it costs no height in either shape and the allowance is a constant
    // again — the same 100px, and the same panel, as before any of this.
    var chrome = "100px";
    panel.style.cssText =
      "display:none;overflow:hidden;margin-bottom:12px;border-radius:20px;" +
      "width:min(420px,calc(100vw - 32px));height:min(680px,calc(100vh - " +
      offsetY +
      " - " +
      chrome +
      "));" +
      "box-shadow:0 30px 80px rgba(20,17,15,.28);background:#fff";

    var primary = cfg.primary || "#1f6f5c";
    var onPrimary = cfg.onPrimary || "#fff";
    var atLeft = cfg.position === "bottom-left";

    /*
     * One rule for both shapes: the LAUNCHER carries only its own name, and
     * the tagline lives outside it, in a card beside it.
     *
     * The first attempt stacked the tagline inside the pill, which turned the
     * launcher into a two-line block of brand colour — next to a storefront's
     * existing chat widget it read as an advert rather than as an invitation.
     * Every widget that does this well (WhatsApp's among them) keeps the
     * button a button and puts the sentence beside it.
     *
     * `button` is what gets the click; `applyState` is how the mount redraws
     * itself for open/closed. Everything past this point talks to those two
     * and never to the shape, so the toggle logic is written once.
     */
    var button;
    var setLauncherText;

    if (iconMode) {
      var circle = el("button", { type: "button", html: ICON_CHAT });
      circle.style.cssText =
        "flex:none;width:60px;height:60px;border-radius:50%;border:0;cursor:pointer;" +
        "display:flex;align-items:center;justify-content:center;" +
        "background:" + primary + ";color:" + onPrimary + ";" +
        "box-shadow:0 12px 30px rgba(20,17,15,.22)";
      button = circle;
      setLauncherText = function (isOpen) {
        circle.innerHTML = isOpen ? ICON_CLOSE : ICON_CHAT;
      };
    } else {
      var pill = el("button", { type: "button" });
      pill.style.cssText =
        "cursor:pointer;border:0;border-radius:999px;padding:14px 20px;" +
        "font:600 15px/1 system-ui,sans-serif;white-space:nowrap;" +
        "background:" + primary + ";color:" + onPrimary + ";" +
        "box-shadow:0 12px 30px rgba(20,17,15,.22)";
      // A single span, so the pill is the one line it always was.
      var line = el("span", { text: labelOpen });
      pill.appendChild(line);
      button = pill;
      setLauncherText = function (isOpen) {
        // Assigning to pill.textContent would delete the span and leave a bare
        // string, which is fine until something else needs to live in there.
        line.textContent = isOpen ? closeText : labelOpen;
      };
    }

    /*
     * The card beside the launcher.
     *
     * It carries the tagline. It also carries the label when the launcher
     * itself shows no text — a circle with a glyph says nothing about what it
     * is, so the words have to be somewhere.
     *
     * A card rather than bare text: this floats over whatever the storefront
     * has scrolled to, and unbacked text over a product photo is unreadable.
     */
    var bubble = null;
    var bubbleLines = [];
    // Only the label is ever bold, and only in icon mode where the button has
    // no text of its own. The tagline is an aside — set at the weight of the
    // pill it sits next to, it stops reading as a quiet invitation and starts
    // competing with the launcher for the same attention.
    if (iconMode && labelOpen) bubbleLines.push([labelOpen, true]);
    if (tagline) bubbleLines.push([tagline, false]);

    if (bubbleLines.length) {
      bubble = el("div", {});
      // Translucent rather than solid white, with the blur that makes the
      // translucency look deliberate instead of washed out. The alpha is kept
      // high because this floats over product photography, where a genuinely
      // transparent card would leave the words unreadable.
      bubble.style.cssText =
        "background:rgba(255,255,255,.82);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);" +
        "color:#57514b;border-radius:13px;padding:8px 12px;" +
        "box-shadow:0 4px 14px rgba(20,17,15,.10);border:1px solid rgba(20,17,15,.05);" +
        "max-width:min(240px,58vw);text-align:" + (atLeft ? "left" : "right");
      bubbleLines.forEach(function (entry, i) {
        var span = el("span", { text: entry[0] });
        span.style.cssText =
          "display:block;font:" + (entry[1] ? "600 13px" : "500 13px") + "/1.35 system-ui,sans-serif;" +
          (entry[1] ? "color:#3d3833;" : "") +
          (i ? "margin-top:1px;" : "");
        bubble.appendChild(span);
      });
    }

    /*
     * What actually sits in the corner.
     *
     * With no card there is nothing to lay out, so the launcher is mounted
     * bare — byte for byte the arrangement every existing install already has.
     * With a card it becomes a row, and the card goes on the INWARD side so
     * the launcher stays hard against the edge it is pinned to and the card
     * never points off-screen.
     */
    var mount = button;
    if (bubble) {
      mount = el("div", {});
      mount.style.cssText =
        "display:flex;align-items:center;gap:10px;justify-content:" + (atLeft ? "flex-start" : "flex-end");
      if (!atLeft) mount.appendChild(bubble);
      mount.appendChild(button);
      if (atLeft) mount.appendChild(bubble);
    } else if (!iconMode) {
      // Preserved from before the row existed: a lone pill pushes itself to
      // the pinned edge rather than sitting flush left inside a wider box.
      button.style.cssText += ";display:block;margin-" + (atLeft ? "right" : "left") + ":auto";
    }

    var applyState = function (isOpen) {
      setLauncherText(isOpen);
      // An icon launcher has no visible text at all, so its accessible name is
      // the only name it has. Both shapes track the swap for the same reason:
      // a control announced as "Skincare advisor" that closes the advisor is
      // wrong to everyone not looking at it.
      button.setAttribute("aria-label", isOpen ? closeText : labelOpen);
      // The card is an invitation to open the advisor. Once it is open the
      // invitation has been accepted, and leaving it there covers the panel.
      if (bubble) bubble.style.display = isOpen ? "none" : "";
    };

    button.setAttribute("aria-expanded", "false");
    if (loc === "ar") button.setAttribute("dir", "rtl");
    applyState(false);

    button.addEventListener("click", function () {
      open = !open;
      if (open && !frame) {
        frame = el("iframe", { title: t(loc, "launch") });
        // Without this the advisor loads, looks right, and cannot hear anybody.
        // "camera" belongs here for the same reason: the skin photo is offered
        // by a visible button, and without the delegation pressing it fails
        // silently on the merchant's page while working on ours.
        frame.setAttribute("allow", "microphone; camera; autoplay; clipboard-write");
        // Whose catalogue to recommend from travels in the URL. Without it the
        // advisor answered every shopper from the seed catalogue, so the bubble
        // on a merchant's storefront recommended products that were not theirs.
        // A subdomain pointed at us overrides this server-side; on the shared
        // origin it is the only thing that says who the shop is.
        frame.src =
          origin +
          "/advisor?lang=" +
          encodeURIComponent(loc) +
          (cfg.tenant ? "&tenant=" + encodeURIComponent(cfg.tenant) : "") +
          // Set when the floating launcher is on a product page too: a
          // merchant who puts data-product on the theme-wide snippet with a
          // Liquid expression gets a launcher that knows the product it is
          // sitting on, and an empty one everywhere else.
          (cfg.product ? "&product=" + encodeURIComponent(cfg.product) : "");
        frame.style.cssText = "border:0;width:100%;height:100%;display:block";
        panel.appendChild(frame);
      }
      panel.style.display = open ? "block" : "none";
      // Closing the launcher has to STOP the advisor, not just hide her.
      // Hiding an iframe does not pause the document inside it — visibility
      // follows the top-level page — so the old behaviour left a shopper who
      // had tapped Close with an open microphone, an advisor still talking out
      // of a panel they could no longer see, and the browser's recording
      // indicator lit on someone else's storefront. The frame is kept (the
      // conversation survives being reopened); only the call is hung up.
      if (!open && frame && frame.contentWindow) {
        try {
          frame.contentWindow.postMessage({ type: "dg:stop" }, origin);
        } catch (e) {
          // A frame that has not finished loading has nothing to stop yet.
        }
      }
      applyState(open);
      button.setAttribute("aria-expanded", open ? "true" : "false");
    });

    root.appendChild(panel);
    root.appendChild(mount);
    document.body.appendChild(root);
  }

  // ---- register + auto-mount ----------------------------------------------
  var supportsCE = "customElements" in window && "attachShadow" in Element.prototype;
  if (supportsCE) customElements.define(TAG, DermaGuruWidget);

  function autoMount() {
    var script =
      document.currentScript ||
      (function () {
        var all = document.getElementsByTagName("script");
        for (var i = all.length - 1; i >= 0; i--) {
          if ((all[i].src || "").indexOf("dermaguru-widget.js") !== -1) return all[i];
        }
        return null;
      })();
    if (!script || script.getAttribute("data-dg-mounted")) return;
    script.setAttribute("data-dg-mounted", "1");

    // Checked before anything is built, and before the mode is even read: this
    // has to hold for every rendering, and a launcher that mounts and then
    // hides has still cost the shopper the work of loading it.
    if (hiddenHere(script.getAttribute("data-hide-on"), location.pathname)) return;

    var origin;
    try {
      origin = new URL(script.src).origin;
    } catch (e) {
      origin = location.origin;
    }
    var tenant = script.getAttribute("data-tenant") || "ai-derma-guru";
    var position = script.getAttribute("data-position") || "bottom-right";
    var offsetY = cssLength(script.getAttribute("data-offset-bottom"), "20px");
    var offsetX = cssLength(script.getAttribute("data-offset-side"), "20px");
    var mode = script.getAttribute("data-mode");
    var product = script.getAttribute("data-product");

    // A bar in the page rather than a launcher over it. Checked before the
    // others because it is the only mode whose position is decided by where
    // the tag was pasted, so it needs the tag itself.
    if (mode === "inline") {
      mountInline(origin, {
        script: script,
        tenant: tenant,
        product: product,
        // How high the bar sits once it pins itself to the bottom of the
        // screen — the same attribute, and the same meaning, as it has for the
        // floating launcher.
        offsetY: script.getAttribute("data-offset-bottom"),
        label: script.getAttribute("data-label"),
        tagline: script.getAttribute("data-tagline"),
        locale: script.getAttribute("data-locale") || "en",
        primary: script.getAttribute("data-primary"),
        onPrimary: script.getAttribute("data-on-primary"),
      });
      return;
    }

    // Voice is what this product IS, so it is what a snippet gets unless it
    // asks for the older text advisor by name. It used to be the other way
    // round, and the snippet on the merchant dashboard carried no data-mode at
    // all — so the one copy-paste a merchant is actually given installed the
    // chat widget, and the voice advisor shipped to nobody.
    if (mode !== "chat" && mode !== "iframe") {
      mountVoice(origin, {
        position: position,
        offsetY: offsetY,
        offsetX: offsetX,
        label: script.getAttribute("data-label"),
        tagline: script.getAttribute("data-tagline"),
        launcher: script.getAttribute("data-launcher"),
        product: product,
        tenant: tenant,
        locale: script.getAttribute("data-locale") || "en",
        primary: script.getAttribute("data-primary"),
        onPrimary: script.getAttribute("data-on-primary"),
      });
      return;
    }

    if (!supportsCE || mode === "iframe") {
      mountIframe(origin, tenant, position, { y: offsetY, x: offsetX });
      return;
    }

    var node = document.createElement(TAG);
    node.setAttribute("data-origin", origin);
    [
      "tenant",
      "position",
      "offset-bottom",
      "offset-side",
      "label",
      "tagline",
      "primary",
      "on-primary",
      "radius",
      "font",
      "locale",
      "rtl",
      "title",
    ].forEach(function (a) {
      var v = script.getAttribute("data-" + a);
      if (v != null) node.setAttribute("data-" + a, v);
    });
    document.body.appendChild(node);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoMount);
  } else {
    autoMount();
  }
})();
