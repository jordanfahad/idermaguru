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

  function styles() {
    return [
      ":host{all:initial}",
      "*{box-sizing:border-box}",
      ".dg{position:fixed;z-index:2147483647;font-family:var(--dg-font, -apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif);color:var(--dg-ink,#1c1a19);line-height:1.45}",
      ".dg.pos-br{inset:auto 20px 20px auto}",
      ".dg.pos-bl{inset:auto auto 20px 20px}",
      ".dg[dir=rtl].pos-br{inset:auto auto 20px 20px}",
      ".dg[dir=rtl].pos-bl{inset:auto 20px 20px auto}",
      ".launch{display:inline-flex;align-items:center;gap:9px;border:0;cursor:pointer;background:var(--dg-primary,#1f6f5c);color:var(--dg-on-primary,#fff);font-weight:650;font-size:15px;min-height:52px;padding:0 20px;border-radius:999px;box-shadow:0 10px 30px rgba(20,17,15,.22);transition:transform .18s ease, box-shadow .18s ease}",
      ".launch:hover{transform:translateY(-1px);box-shadow:0 16px 38px rgba(20,17,15,.28)}",
      ".launch:focus-visible{outline:3px solid var(--dg-primary,#1f6f5c);outline-offset:3px}",
      ".dot{width:9px;height:9px;border-radius:50%;background:var(--dg-on-primary,#fff);opacity:.9}",
      ".panel{display:flex;flex-direction:column;width:min(384px,calc(100vw - 32px));height:min(624px,calc(100vh - 110px));background:var(--dg-bg,#fff);border:1px solid rgba(20,17,15,.08);border-radius:var(--dg-radius,18px);box-shadow:0 30px 80px rgba(20,17,15,.24);overflow:hidden;margin-bottom:14px;opacity:0;transform:translateY(8px) scale(.98);transition:opacity .2s ease, transform .2s ease}",
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
        primary: this.getAttribute("data-primary") || "#1f6f5c",
        onPrimary: this.getAttribute("data-on-primary") || "#ffffff",
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
      container.style.setProperty("--dg-primary", this.cfg.primary);
      container.style.setProperty("--dg-on-primary", this.cfg.onPrimary);
      container.style.setProperty("--dg-radius", this.cfg.radius);
      if (this.cfg.font) container.style.setProperty("--dg-font", this.cfg.font);
      this.container = container;

      this.launchLabel = el("span", { text: t(this.cfg.locale, "launch") });
      this.launch = el(
        "button",
        { class: "launch", type: "button", "aria-label": t(this.cfg.locale, "launch"), "aria-expanded": "false" },
        [el("span", { class: "dot" }), this.launchLabel],
      );
      this.launch.addEventListener("click", this.toggle.bind(this));

      container.appendChild(this.launch);
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
      if (!this.state.started) this.start();
      if (this.input) this.input.focus();
    }

    close() {
      this.state.open = false;
      this.launch.setAttribute("aria-expanded", "false");
      this.launchLabel.textContent = t(this.cfg.locale, "launch");
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
      this.container.insertBefore(this.panel, this.launch);
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
  function mountIframe(origin, tenant, position) {
    var root = el("div", {});
    root.style.cssText =
      "position:fixed;z-index:2147483647;bottom:20px;" + (position === "bottom-left" ? "left:20px" : "right:20px");
    var frame = el("iframe", { title: "DermaGuru skincare advisor" });
    frame.src = origin + "/embed?tenant=" + encodeURIComponent(tenant);
    frame.style.cssText =
      "border:0;width:min(384px,calc(100vw - 32px));height:min(624px,calc(100vh - 110px));border-radius:18px;box-shadow:0 30px 80px rgba(20,17,15,.24);background:#fff";
    root.appendChild(frame);
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

    var origin;
    try {
      origin = new URL(script.src).origin;
    } catch (e) {
      origin = location.origin;
    }
    var tenant = script.getAttribute("data-tenant") || "ai-derma-guru";
    var position = script.getAttribute("data-position") || "bottom-right";
    var mode = script.getAttribute("data-mode");

    if (!supportsCE || mode === "iframe") {
      mountIframe(origin, tenant, position);
      return;
    }

    var node = document.createElement(TAG);
    node.setAttribute("data-origin", origin);
    ["tenant", "position", "primary", "on-primary", "radius", "font", "locale", "rtl", "title"].forEach(function (a) {
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
