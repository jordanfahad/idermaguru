import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

/**
 * The install snippet and the launcher are the parts of this product nobody
 * runs locally: they only execute on a merchant's storefront, in a frame, on
 * someone else's domain. Three defects lived there undetected until a go-live
 * audit went looking —
 *
 *   - the snippet on the merchant dashboard carried no `data-mode`, and the
 *     widget's default was the OLD chat advisor, so the one copy-paste a
 *     merchant is given installed the wrong product;
 *   - closing the launcher only hid the iframe, and hiding a frame does not
 *     pause the document inside it, so the advisor kept listening and talking
 *     with the recording indicator lit on the shop's page;
 *   - `camera` was missing from the frame's `allow`, so the visible "Show your
 *     skin" button failed silently in every embed while working on our own.
 *
 * Each is asserted against the shipped files rather than a copy, because the
 * bug in every case was drift between what we document and what we serve.
 */
const widget = readFileSync(new URL("../public/dermaguru-widget.js", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../src/app/dashboard/page.tsx", import.meta.url), "utf8");
const advisor = readFileSync(new URL("../src/components/voice-agent.tsx", import.meta.url), "utf8");
const embedDoc = readFileSync(new URL("../docs/EMBED.md", import.meta.url), "utf8");

/**
 * The slice of `src` between a start marker and the first end marker after it.
 * Throws rather than returning "" if either is missing, so that renaming the
 * thing under test fails loudly instead of vacuously passing an assertion
 * against an empty string.
 */
function block(src: string, start: string, end: string): string {
  const from = src.indexOf(start);
  if (from === -1) throw new Error(`no "${start}" found — has it been renamed?`);
  const to = src.indexOf(end, from + start.length);
  if (to === -1) throw new Error(`no "${end}" after "${start}"`);
  return src.slice(from, to);
}

describe("the launcher a merchant pastes into their theme", () => {
  it("delegates both permissions the advisor needs, or they fail silently in the frame", () => {
    const allow = widget.match(/setAttribute\("allow",\s*"([^"]+)"\)/);
    expect(allow, "the voice frame must set an allow attribute").not.toBeNull();
    expect(allow![1]).toContain("microphone");
    expect(allow![1]).toContain("camera");
  });

  it("installs the voice advisor unless the snippet asks for chat by name", () => {
    // The branch that mounts voice must be the fall-through, not a special
    // case: a snippet copied from an older doc has no data-mode at all.
    expect(widget).toMatch(/mode\s*!==\s*"chat"\s*&&\s*mode\s*!==\s*"iframe"/);
    expect(widget).not.toMatch(/if\s*\(mode === "voice"\)\s*\{\s*mountVoice/);
  });

  it("tells the advisor to hang up when the launcher closes", () => {
    expect(widget).toContain("dg:stop");
    // Addressed to the frame's own origin, so the message cannot be read by
    // anything else the storefront happens to be running.
    expect(widget).toMatch(/postMessage\(\{\s*type:\s*"dg:stop"\s*\},\s*origin\)/);
  });
});

describe("the snippet shown on the merchant dashboard", () => {
  it("is the one that installs the voice advisor", () => {
    expect(dashboard).toContain('data-mode="voice"');
  });

  it("no longer tells the merchant to paste a tenant slug that does not exist", () => {
    expect(dashboard).not.toContain('data-tenant="your-store"');
    expect(dashboard).not.toContain('data-tenant="cicabelle"');
  });
});

describe("the advisor honours the launcher closing", () => {
  it("listens for the stop message and for the page going away", () => {
    expect(advisor).toContain('"dg:stop"');
    expect(advisor).toContain('addEventListener("pagehide"');
  });

  it("takes that instruction only from the window that framed it", () => {
    expect(advisor).toMatch(/event\.source !== window\.parent/);
  });

  it("stops the microphone and the camera rather than only repainting the interface", () => {
    // The hang-up must actually end capture: a stop that only set phase back
    // to idle would leave both indicator lights on, which is the whole bug.
    // It delegates to the two canonical teardowns rather than repeating them.
    const hangUp = block(advisor, "const hangUp", "const onMessage");
    expect(hangUp).toContain("releaseCall()");
    expect(hangUp).toContain("stopCamera()");
    expect(hangUp).toContain('setPhase("idle")');
  });

  it("releases a microphone that arrives after the hang-up", () => {
    // releaseCall is what hangUp delegates to, so the guarantee lives there:
    // stop the live tracks, and stop whatever a still-pending getUserMedia
    // delivers afterwards — that one kept the indicator lit with nobody
    // holding a reference to the stream.
    const releaseCall = block(advisor, "const releaseCall", "}, [cancelRecordedTurn]);");
    expect(releaseCall).toContain("getTracks().forEach((track) => track.stop())");
    expect(releaseCall).toMatch(/callStreamPromiseRef\.current\?\.then/);
  });

  it("puts the camera light out too", () => {
    // Newly reachable: until the frame delegated `camera`, the photo button
    // could not open a stream inside an embed at all.
    const stopCamera = block(advisor, "function stopCamera", "\n  }");
    expect(stopCamera).toContain("getTracks().forEach((track) => track.stop())");
  });
});

/**
 * Option 1 in EMBED.md is the install we tell merchants to prefer, and it is a
 * hand-written iframe rather than the launcher — so it does not inherit the
 * widget's `allow` and has to carry its own. It was still granting only the
 * microphone after the launcher had been fixed.
 */
describe("the page embed the docs recommend", () => {
  it("delegates the camera as well as the microphone", () => {
    const snippet = block(embedDoc, "<iframe", "</iframe>");
    expect(snippet).toMatch(/allow="[^"]*microphone[^"]*"/);
    expect(snippet).toMatch(/allow="[^"]*camera[^"]*"/);
  });

  it("has no allow= anywhere that grants the microphone but not the camera", () => {
    // Both are needed in every frame, so a snippet naming one and not the
    // other is the drift this file exists to catch.
    for (const [, value] of embedDoc.matchAll(/allow="([^"]+)"/g)) {
      expect(value, `"${value}" grants the microphone but not the camera`).toContain("camera");
    }
  });
});

/**
 * Where the launcher sits.
 *
 * The corner was hardcoded at 20px, so a storefront that already had something
 * in it — Cicabelle has a WhatsApp bubble bottom-right — could only flip the
 * launcher to the opposite corner. `data-offset-bottom` / `data-offset-side`
 * move it along either axis instead.
 *
 * Two things can go wrong and neither shows up in a screenshot of the closed
 * launcher, so both are asserted here: the offset reaching an inline `style`
 * unsanitised, and the panel — which opens UPWARD from the button — keeping a
 * height measured from the floor, which puts its header and close button off
 * the top of the viewport the moment the launcher is raised.
 */
describe("where the launcher sits", () => {
  /**
   * The shipped validator itself, not a copy of it: a regex that silently
   * stopped rejecting things would pass any assertion that only checked the
   * variable was still declared.
   */
  const declared = widget.match(/var LENGTH = (\/.+\/);/);
  const LENGTH = new RegExp(declared![1].slice(1, -1));

  it("declares the validator the offsets are checked against", () => {
    expect(declared, "no LENGTH regex found — has it been renamed?").not.toBeNull();
  });

  it("accepts the lengths a merchant would reasonably write", () => {
    for (const value of ["0px", "20px", "96px", "45vh", "50%", "10vw", "12.5rem", "2em"]) {
      expect(LENGTH.test(value), `${value} should be accepted`).toBe(true);
    }
  });

  it("rejects anything that is not a bare length, so nothing can be pasted into CSS", () => {
    // data-* lives in the storefront's HTML, where it is editable in devtools,
    // and these values land in an inline style string. The semicolon case is
    // the one that matters: it is how a value stops being a length and starts
    // being extra declarations.
    for (const value of [
      "20px;position:static",
      "20px;color:red",
      "calc(100vh - 20px)",
      "-20px",
      "20",
      "20 px",
      "red",
      "expression(alert(1))",
      "",
    ]) {
      expect(LENGTH.test(value), `${value} should be rejected`).toBe(false);
    }
  });

  it("falls back to the old corner when the value is unusable", () => {
    // Rejecting has to mean 20px, not "" — an empty length would produce
    // `bottom:;` and drop the launcher wherever the storefront's layout put it.
    expect(widget).toMatch(/cssLength\(script\.getAttribute\("data-offset-bottom"\), "20px"\)/);
    expect(widget).toMatch(/cssLength\(script\.getAttribute\("data-offset-side"\), "20px"\)/);
  });

  it("applies the offset in all three mount paths, not just the one Cicabelle uses", () => {
    // voice is the shipped default, but a merchant on a hostile CSP silently
    // gets iframe mode, and data-mode="chat" is still documented. An offset
    // honoured in one and ignored in the others is worse than no offset.
    const voice = block(widget, "function mountVoice", "var supportsCE");
    expect(voice).toContain("bottom:");
    expect(voice).toContain("offsetY");
    expect(voice).toContain("offsetX");

    const iframe = block(widget, "function mountIframe", "// ---- voice advisor");
    expect(iframe).toContain("offsetY");
    expect(iframe).toContain("offsetX");

    // The shadow-DOM mode goes through custom properties rather than a style
    // string, since its position lives in a stylesheet.
    expect(widget).toContain("--dg-offset-y");
    expect(widget).toContain("--dg-offset-x");
    expect(widget).toMatch(/\.dg\.pos-br\{inset:auto var\(--dg-offset-x,20px\) var\(--dg-offset-y,20px\) auto\}/);
  });

  it("takes the offset off the panel height, so a raised launcher cannot push it off-screen", () => {
    const voice = block(widget, "function mountVoice", "var supportsCE");
    expect(voice).toMatch(/height:min\(680px,calc\(100vh - /);
    // The subtracted amount is offsetY plus a chrome allowance that grows when
    // a tagline adds a second line to the launcher.
    expect(voice).toMatch(/offsetY \+\s*" - " \+\s*chrome/);

    const iframe = block(widget, "function mountIframe", "// ---- voice advisor");
    expect(iframe).toContain(" - 90px));");

    expect(widget).toContain("height:min(624px,calc(100vh - var(--dg-offset-y,20px) - 90px))");
  });

  it("leaves an unoffset launcher exactly where it was", () => {
    // The default has to resolve to the original arithmetic — 20px + 90px is
    // the 110px the panel used before this existed, and 20px + 100px the 120px
    // the voice panel used. Otherwise every merchant already installed gets a
    // silently resized panel out of a change none of them asked for.
    expect(widget).not.toContain("calc(100vh - 110px)");
    expect(widget).not.toContain("calc(100vh - 120px)");
    for (const fallback of widget.matchAll(/var\(--dg-offset-[xy],([^)]+)\)/g)) {
      expect(fallback[1], "the CSS fallback must stay the original 20px corner").toBe("20px");
    }
  });

  it("forwards both offsets to the custom element", () => {
    // The chat mode is mounted by copying data-* across to the element; an
    // attribute missing from that list is read as absent no matter what the
    // merchant pasted.
    const forwarded = block(widget, '"tenant",', "].forEach");
    expect(forwarded).toContain('"offset-bottom"');
    expect(forwarded).toContain('"offset-side"');
  });
});

/**
 * What the launcher says.
 *
 * It read "Skincare advisor" and nothing else — the name of the thing, with no
 * hint that it talks back. `data-label` renames it and `data-tagline` adds a
 * second line under it.
 *
 * The failure modes here are all state, not rendering: the tagline is an
 * instruction to open the advisor, so it has to disappear once the advisor is
 * open and come back when it closes, and the assistive-technology label has to
 * track the same swap rather than announcing "Skincare advisor" for a button
 * that now closes.
 */
describe("what the launcher says", () => {
  const declared = widget.match(/var LABEL_MAX = (\d+);/);
  const cap = Number(declared![1]);

  it("caps the text rather than trusting it", () => {
    // The launcher is fixed-position and cannot be scrolled away from, so a
    // merchant pasting a paragraph would cover the storefront on a phone.
    expect(declared, "no LABEL_MAX found — has it been renamed?").not.toBeNull();
    expect(cap).toBeGreaterThan(20);
    expect(cap).toBeLessThanOrEqual(80);
    expect(widget).toContain("slice(0, LABEL_MAX)");
  });

  it("collapses whitespace, so a newline cannot become a third line", () => {
    expect(widget).toMatch(/replace\(\/\\s\+\/g, " "\)/);
  });

  it("falls back to the translated default when no label is given", () => {
    // Empty must mean "the old text", not "an empty pill" — an unset attribute
    // is the state every already-installed merchant is in.
    expect(widget).toMatch(/labelText\(cfg\.label, openText\)/);
    expect(widget).toMatch(/labelText\(this\.getAttribute\("data-label"\), t\(locale, "launch"\)\)/);
  });

  it("treats an absent tagline as no second line at all", () => {
    // Falling back to a default string here would put text on every existing
    // merchant's launcher that none of them asked for.
    expect(widget).toMatch(/labelText\(cfg\.tagline, ""\)/);
    expect(widget).toMatch(/labelText\(this\.getAttribute\("data-tagline"\), ""\)/);
  });

  it("keeps the launcher itself to one line", () => {
    // The tagline stacked inside the pill once, turning the launcher into a
    // two-line block of brand colour. It reads as an advert next to a
    // storefront's own chat widget. The button carries its name and nothing
    // else; the tagline lives in the card beside it.
    const voice = block(widget, "function mountVoice", "var supportsCE");
    expect(voice).toMatch(/line\.textContent = isOpen \? closeText : labelOpen/);
    expect(voice, "no second line may be appended to the launcher").not.toMatch(/pill\.appendChild\(line2\)/);
    expect(voice, "the button's textContent must never be assigned wholesale").not.toMatch(
      /\b(button|pill|circle)\.textContent\s*=/,
    );
  });

  it("hides the card while the advisor is open, in every rendering", () => {
    // The card invites the shopper to open the advisor. Once it is open the
    // invitation has been accepted, and leaving it up covers the panel.
    const voice = block(widget, "function mountVoice", "var supportsCE");
    expect(voice).toMatch(/bubble\.style\.display = isOpen \? "none" : ""/);
    expect(widget, "chat mode").toContain('this.launchTagline.style.display = "none"');
    expect(widget, "chat mode").toContain('this.launchTagline.style.display = ""');
  });

  it("keeps the accessible name in step with the visible one", () => {
    // A control announced as "Skincare advisor" while it closes the advisor is
    // wrong to everyone not looking at it. With data-launcher="icon" there is
    // no visible text at all, so this is the only name the button has — which
    // is why it is set once, for both shapes, rather than per branch.
    const voice = block(widget, "function mountVoice", "var supportsCE");
    expect(voice).toMatch(/button\.setAttribute\("aria-label", isOpen \? closeText : labelOpen\)/);
    expect(widget).toContain('this.launch.setAttribute("aria-label", t(this.cfg.locale, "close"))');
    expect(widget).toContain('this.launch.setAttribute("aria-label", this.cfg.label)');
  });

  it("charges the panel nothing for a tagline, because it no longer costs height", () => {
    // While the tagline stacked inside the pill it cost a line and the panel
    // budget grew to compensate. Beside the launcher it costs nothing, so the
    // allowance is a constant again — and a leftover 120px would shrink every
    // tagline user's panel for a line that is not there.
    const voice = block(widget, "function mountVoice", "var supportsCE");
    expect(voice).toContain('var chrome = "100px"');
    expect(widget, "the chat mode's compensating variable must be gone too").not.toContain("--dg-chrome");
  });

  it("puts the card beside the launcher, not under it", () => {
    const voice = block(widget, "function mountVoice", "var supportsCE");
    expect(voice).toMatch(/display:flex;align-items:center;gap:10px/);
    // chat mode does the same through its stylesheet, and mirrors the row for
    // bottom-left and for Arabic rather than pushing the card off-screen
    expect(widget).toMatch(/\.row\{display:flex;align-items:center/);
    expect(widget).toContain(".dg.pos-bl .row,.dg[dir=rtl].pos-br .row{flex-direction:row-reverse");
    expect(voice).toContain('button.setAttribute("dir", "rtl")');
  });

  it("mounts the launcher bare when there is no card", () => {
    // Every install that has not set a tagline must get the exact arrangement
    // it has today — a lone button, no wrapper row introduced around it.
    const voice = block(widget, "function mountVoice", "var supportsCE");
    expect(voice).toContain("var mount = button;");
    expect(voice).toMatch(/if \(bubble\) \{\s*mount = el\("div", \{\}\);/);
    expect(widget, "chat mode too").toContain("this.row = this.launch;");
  });

  it("forwards both to the custom element", () => {
    const forwarded = block(widget, '"tenant",', "].forEach");
    expect(forwarded).toContain('"label"');
    expect(forwarded).toContain('"tagline"');
  });
});

/**
 * The WhatsApp-shaped launcher.
 *
 * The two-line pill reads as an advert sitting next to the storefront's own
 * WhatsApp bubble, which puts its words in a light card BESIDE a round button.
 * `data-launcher="icon"` renders that shape instead.
 *
 * It is opt-in and the pill stays the default: this is a look, and merchants
 * already installed chose the one they have by not choosing anything.
 */
describe("the icon launcher", () => {
  const voice = block(widget, "function mountVoice", "var supportsCE");

  it("is opt-in, so nothing already installed changes shape", () => {
    expect(voice).toContain('var iconMode = cfg.launcher === "icon"');
    // Anything other than the exact string keeps the pill — a typo in a theme
    // should not produce a third, unintended rendering.
    expect(voice).not.toMatch(/cfg\.launcher\s*!==\s*"pill"/);
  });

  it("carries its glyphs inline rather than fetching them", () => {
    // An external asset is a request the storefront pays for and one that can
    // fail, leaving a coloured circle with nothing in it.
    expect(widget).toMatch(/var ICON_CHAT =\s*'<svg/);
    expect(widget).toMatch(/var ICON_CLOSE =\s*'<svg/);
    expect(widget, "the glyphs must follow data-on-primary").toContain("currentColor");
    for (const [, url] of widget.matchAll(/<svg[^>]*>[\s\S]*?(https?:\/\/[^"']+)/g)) {
      expect.fail(`icon markup should not reference ${url}`);
    }
  });

  it("swaps the glyph rather than leaving a chat bubble on a close button", () => {
    expect(voice).toMatch(/circle\.innerHTML = isOpen \? ICON_CLOSE : ICON_CHAT/);
  });

  it("puts the card on the inward side of the launcher", () => {
    // The launcher is what is pinned to the corner; the card points inward. If
    // the order did not flip, bottom-left would push the card off-screen.
    expect(voice).toContain("if (!atLeft) mount.appendChild(bubble);");
    expect(voice).toContain("if (atLeft) mount.appendChild(bubble);");
  });

  it("carries the label in the card, since a glyph says nothing about what it is", () => {
    // In pill mode the launcher shows its own name, so the card holds only the
    // tagline. A circle has no text at all — if the label were not moved into
    // the card, icon mode would be an unlabelled button on a storefront.
    expect(voice).toContain("if (iconMode && labelOpen) bubbleLines.push([labelOpen, true]);");
    expect(voice).toContain("if (tagline) bubbleLines.push([tagline, false]);");
  });

  it("never sets the tagline bold", () => {
    // Only the label is emphasised, and only where the button has no text of
    // its own. At the launcher's own weight the tagline stops reading as a
    // quiet invitation and competes with it for the same attention.
    expect(voice, "the tagline is pushed with strong=false, unconditionally").not.toMatch(
      /bubbleLines\.push\(\[tagline, (true|!?iconMode)\]\)/,
    );
  });

  it("sets the card apart from the launcher rather than matching it", () => {
    // It is an aside beside a brand-coloured button: translucent, muted, and
    // lighter than the thing it sits next to, or it reads as a second button.
    expect(voice).toMatch(/background:rgba\(255,255,255,\.\d+\)/);
    expect(voice, "translucency needs the blur or it just looks washed out").toContain("backdrop-filter:blur");
    expect(widget, "chat mode matches").toMatch(/\.tagline\{background:rgba\(255,255,255,\.\d+\)/);
    // Both renderings agree on the type size, so the two modes do not drift.
    expect(voice).toContain('"600 13px" : "500 13px"');
    expect(widget).toMatch(/\.tagline\{[^}]*font-size:13px/);
  });

  it("keeps the bubble narrow enough for a phone", () => {
    // A fixed-position card at full width would cover the storefront.
    expect(voice).toMatch(/max-width:min\(\d+px,\d+vw\)/);
  });

  it("mounts the row, not the button, so the bubble is not orphaned", () => {
    // The click target is the circle but the thing appended to the corner is
    // the row containing both — appending the button alone would drop the
    // bubble on the floor.
    expect(voice).toContain("root.appendChild(mount);");
    expect(voice).not.toMatch(/root\.appendChild\(button\)/);
  });

  it("routes both renderings through one toggle path", () => {
    // The open/close logic — including the postMessage that stops the mic —
    // must not be duplicated per rendering, or one copy will drift.
    expect(voice).toContain("applyState(open);");
    expect((voice.match(/dg:stop/g) ?? []).length, "one hang-up, not one per mode").toBe(1);
  });

  it("is deliberately NOT forwarded to the chat mode", () => {
    // data-mode="chat" draws its launcher from a stylesheet and has no icon
    // rendering. Forwarding the attribute would accept it and then ignore it,
    // which is worse than not accepting it: the merchant sees their snippet
    // carrying an instruction that does nothing. If icon mode is ever built
    // for chat, this assertion is the thing that should fail.
    const forwarded = block(widget, '"tenant",', "].forEach");
    expect(forwarded).not.toContain('"launcher"');
  });
});

/**
 * Knowing which product the page is about without being told.
 *
 * `data-product` is a line in a theme somebody has to remember to add, and
 * when it is missing the advisor opens with "What's bothering your skin?" on a
 * page that is entirely about one product. That failure never gets reported,
 * because the widget appears, opens, and answers — it just answers as though
 * the page it is standing on did not exist.
 *
 * Executed rather than read, because the reading is the feature: too greedy
 * and a collection page starts claiming to be a product.
 */
describe("reading the product out of the storefront URL", () => {
  const source = widget.slice(widget.indexOf("function productFromPath"), widget.indexOf("/*\n   * Pages the widget"));
  const sandbox: { productFromPath?: (path: string | null | undefined) => string | null } = {};
  vm.runInNewContext(source + "\nthis.productFromPath = productFromPath;", sandbox);
  const productFromPath = sandbox.productFromPath!;

  it("was found in the shipped file", () => {
    expect(typeof productFromPath, "productFromPath not extracted — has it been renamed?").toBe("function");
  });

  it("reads the plain product path", () => {
    expect(productFromPath("/products/snail-mucin")).toBe("snail-mucin");
  });

  it("reads a product reached through a collection", () => {
    // The path Cicabelle actually serves when a shopper taps a product from a
    // collection, and the one that first showed this was broken.
    expect(productFromPath("/collections/korean-beauty/products/snail-mucin")).toBe("snail-mucin");
  });

  it("reads a product under a locale prefix", () => {
    // cicabelle.com/ar is live across 488 products.
    expect(productFromPath("/ar/products/snail-mucin")).toBe("snail-mucin");
    expect(productFromPath("/en-ae/collections/all/products/snail-mucin")).toBe("snail-mucin");
  });

  it("keeps everything after the handle out of it", () => {
    expect(productFromPath("/products/snail-mucin/reviews")).toBe("snail-mucin");
  });

  it("claims nothing on a page that is not a product", () => {
    for (const path of ["/", "/collections/korean-beauty", "/pages/about", "/cart", "/products", "/products/"]) {
      expect(productFromPath(path), `${path} is not a product page`).toBeNull();
    }
  });

  it("survives being handed nothing", () => {
    expect(productFromPath(null)).toBeNull();
    expect(productFromPath("")).toBeNull();
  });
});

/**
 * An explicit attribute still wins, including an explicit nothing.
 *
 * A merchant who wants general advice on a product page needs a way to say so,
 * and `data-product=""` is it — which only works if presence is tested rather
 * than truthiness, since an empty string would otherwise fall through to the
 * guess.
 */
describe("data-product overrides the guess", () => {
  it("tests for the attribute rather than for a non-empty value", () => {
    expect(widget).toContain('script.hasAttribute("data-product")');
  });

  it("falls back to the path only when the attribute is absent", () => {
    expect(widget).toMatch(/hasAttribute\("data-product"\)[\s\S]{0,120}productFromPath\(location\.pathname\)/);
  });
});

/**
 * Pages the widget stays off.
 *
 * A floating launcher is fixed to the viewport, so on a page with its own
 * sticky footer it lands on top of it. On cicabelle.com/cart that footer is
 * the subtotal and the checkout button, and the advisor was sitting over the
 * one control the page exists to offer.
 *
 * The matching is the whole feature, so it is executed here rather than
 * asserted from the source: a rule that is slightly too greedy takes real
 * pages off the storefront, and it does so silently — nobody reports a
 * launcher that failed to appear.
 */
describe("pages the widget stays off", () => {
  const source = widget.slice(widget.indexOf("function hiddenHere"), widget.indexOf("/*\n   * The glyphs"));
  const sandbox: { hiddenHere?: (list: string | null | undefined, path: string) => boolean } = {};
  vm.runInNewContext(source + "\nthis.hiddenHere = hiddenHere;", sandbox);
  const hiddenHere = sandbox.hiddenHere!;

  it("was found in the shipped file", () => {
    expect(typeof hiddenHere, "hiddenHere not extracted — has it been renamed?").toBe("function");
  });

  it("hides the page named and everything under it", () => {
    for (const path of ["/cart", "/cart/", "/cart/1234:1", "/CART"]) {
      expect(hiddenHere("/cart,/checkout", path), `${path} should be hidden`).toBe(true);
    }
  });

  it("does not hide a page that merely starts with the same letters", () => {
    // The one that matters: a plain startsWith would take /cartridges — a real
    // product path — off the storefront, and nobody reports a launcher that
    // failed to appear.
    for (const path of ["/cartridges", "/cartridges/refill-kit"]) {
      expect(hiddenHere("/cart", path), `${path} must stay visible`).toBe(false);
    }
  });

  it("leaves the rest of the storefront alone", () => {
    for (const path of ["/", "/products/k18-hair-mask", "/collections/serums"]) {
      expect(hiddenHere("/cart,/checkout", path), `${path} must stay visible`).toBe(false);
    }
  });

  it('never lets "/" hide the whole store', () => {
    // "/" is a plausible thing for a merchant to type, and under a prefix rule
    // it matches every path there is.
    expect(hiddenHere("/", "/products/x")).toBe(false);
    expect(hiddenHere("/", "/")).toBe(true);
  });

  it("treats an absent or empty list as hiding nothing", () => {
    // Every install that has not asked for this must keep showing the advisor
    // everywhere, exactly as it does today.
    expect(hiddenHere(null, "/cart")).toBe(false);
    expect(hiddenHere(undefined, "/cart")).toBe(false);
    expect(hiddenHere("", "/cart")).toBe(false);
    expect(hiddenHere("/cart,,", "/products/x")).toBe(false);
  });

  it("forgives the ways a merchant might type a path", () => {
    expect(hiddenHere("cart", "/cart"), "leading slash optional").toBe(true);
    expect(hiddenHere("/cart/", "/cart"), "trailing slash tolerated").toBe(true);
    expect(hiddenHere("  /cart , /checkout  ", "/cart"), "whitespace tolerated").toBe(true);
  });

  it("is not the answer the inline bar needs", () => {
    // data-hide-on exists because a FIXED launcher lands on a sticky footer.
    // The inline bar is in the document flow and cannot overlap anything, so
    // it should not be quietly acquiring page rules it does not need — if this
    // ever fails, the collision was solved twice.
    const inline = block(widget, "function mountInline", "function mountVoice");
    expect(inline).not.toContain("hiddenHere");
  });

  it("is checked before anything is built", () => {
    // A launcher that mounts and then hides has still cost the shopper the
    // work of loading it, and the check has to hold for every mount mode —
    // so it sits above the branch that picks one.
    const auto = block(widget, "function autoMount", "if (document.readyState");
    expect(auto).toContain('if (hiddenHere(script.getAttribute("data-hide-on"), location.pathname)) return;');
    expect(
      auto.indexOf("hiddenHere") < auto.indexOf('var mode = script.getAttribute("data-mode")'),
      "the check must come before the mode is even read",
    ).toBe(true);
  });
});

/**
 * The advisor as a bar inside the page.
 *
 * `data-mode="inline"` renders where the script tag sits, so a merchant puts it
 * in their product template and it lands in the layout. Two things follow that
 * a floating launcher cannot do: it cannot cover the page's own controls,
 * because it is in the flow rather than fixed over it; and it can be about the
 * product, because a bar in a product template knows which product it is under.
 */
describe("the inline product bar", () => {
  const inline = block(widget, "function mountInline", "function mountVoice");

  it("renders where the tag was pasted, not in the corner", () => {
    // The whole point of the mode. Appending to body would put it back in a
    // corner and make the merchant's choice of position meaningless.
    expect(inline).toContain("cfg.script.parentNode.insertBefore(root, cfg.script)");
    // The container is never fixed. The BAR is, once pinned, but the thing
    // that lands in the merchant's layout stays in the flow.
    expect(inline).toMatch(/root\.style\.cssText =\s*"margin:/);
    expect(inline).not.toMatch(/root\.style\.position\s*=/);
  });

  it("carries the product through to the advisor", () => {
    expect(inline).toContain('"&product=" + encodeURIComponent(cfg.product)');
  });

  it("encodes it, because a merchant may paste a whole URL", () => {
    // {{ product.url }} is at least as likely to be reached for as
    // {{ product.handle }}, and an unencoded URL would break the query string.
    expect(inline).toMatch(/encodeURIComponent\(cfg\.product\)/);
  });

  it("hangs up the microphone when the bar is collapsed", () => {
    // Same rule as the launcher, and the same bug if it is missed: hiding a
    // frame does not stop the document inside it, so a shopper who collapsed
    // the bar would be left recording on a product page.
    expect(inline).toContain("dg:stop");
    expect(inline).toMatch(/postMessage\(\{ type: "dg:stop" \}, origin\)/);
  });

  it("builds the advisor on first open, not on page load", () => {
    // A product page should not pay for a React application on every view.
    expect(inline).toContain("if (open && !frame)");
  });

  it("delegates the microphone and camera to the frame", () => {
    expect(inline).toMatch(/setAttribute\("allow", "microphone; camera/);
  });

  it("scrolls the advisor into view when it opens", () => {
    // Opening something below the fold is indistinguishable, on a phone, from
    // the button having done nothing.
    expect(inline).toContain("scrollIntoView");
  });

  it("leads with the invitation rather than the advisor's name", () => {
    // On a product page the useful line is the offer — "need advice on this?" —
    // and the name is the answer to it, not the headline.
    expect(inline).toContain("var lead = el(\"span\", { text: tagline || label });");
  });

  it("is routed before the modes that mount into a corner", () => {
    // It is the only mode whose position depends on where the tag was pasted,
    // so it must claim the request before anything appends to body.
    const auto = block(widget, "function autoMount", "if (document.readyState");
    expect(auto.indexOf('mode === "inline"')).toBeGreaterThan(-1);
    expect(
      auto.indexOf('mode === "inline"') < auto.indexOf('mode !== "chat"'),
      "inline must be checked before the voice fall-through",
    ).toBe(true);
  });

  it("lets the floating launcher carry a product too", () => {
    // A merchant who puts data-product on the theme-wide snippet with a Liquid
    // expression gets a launcher that knows the product it is sitting on.
    const voice = block(widget, "function mountVoice", "var supportsCE");
    expect(voice).toContain('"&product=" + encodeURIComponent(cfg.product)');
  });
});

/**
 * The inline bar changing shape where it stands.
 *
 * Expanded it is the whole sentence; five seconds after the shopper reaches it
 * it draws in to the left until only the spark is left — still there, still
 * tappable, no longer a paragraph of brand colour in the middle of a product
 * page.
 *
 * It does NOT pin itself to the bottom of the screen. That was tried and it
 * was wrong twice over: it landed on the storefront's own sticky add-to-cart,
 * and it took the offer away from the button it exists to sit beside. These
 * assertions exist mostly to stop it coming back.
 */
describe("the inline bar changing shape", () => {
  const inline = block(widget, "function mountInline", "function mountVoice");

  it("never leaves the page flow", () => {
    // The whole correction. A fixed bar overlaps whatever the storefront has
    // pinned down there, and no offset value makes that reliable across
    // themes.
    expect(inline).not.toContain('bar.style.position = "fixed"');
    expect(inline).not.toContain("getBoundingClientRect");
    expect(inline).not.toMatch(/root\.style\.position\s*=/);
  });

  it("registers no scroll listener at all", () => {
    // An observer fires when the bar arrives and does nothing the rest of the
    // time; a scroll listener runs on every scroll event of somebody else's
    // shop for the sake of two moments.
    expect(inline).not.toContain('addEventListener("scroll"');
    expect(inline).not.toContain('addEventListener("resize"');
    expect(inline).not.toContain("requestAnimationFrame");
  });

  it("peeks when the bar arrives on screen and draws in when it leaves", () => {
    expect(inline).toContain("window.IntersectionObserver");
    expect(inline).toMatch(/if \(entries\[i\]\.isIntersecting\) peek\(\);/);
    expect(inline).toMatch(/else \{\s*stopPeekTimer\(\);\s*drawIn\(true\);/);
    expect(inline).toContain("seeing.observe(bar)");
  });

  it("does not wait for the whole bar to be visible", () => {
    // On a short screen a threshold of 1 would never fire at all.
    expect(inline).toMatch(/threshold: 0\.\d+/);
  });

  it("still says its piece where there is no observer", () => {
    // Without the ability to tell when anyone is looking, saying it once and
    // drawing in beats saying nothing.
    expect(inline).toMatch(/\} else \{[\s\S]*?peek\(\);[\s\S]*?\}/);
  });

  it("gives the sentence five seconds", () => {
    expect(inline).toContain("var PEEK_MS = 5000;");
    expect(inline).toMatch(/peekTimer = setTimeout\(function \(\) \{[\s\S]*?drawIn\(true\);[\s\S]*?\}, PEEK_MS\);/);
  });

  it("draws in to an icon rather than disappearing", () => {
    // An offer the shopper cannot see is an offer they do not have.
    expect(inline).toContain('bar.style.width = PUCK + "px"');
    expect(inline).toContain('bar.style.borderRadius = "999px"');
    expect(inline).toContain('words.style.opacity = "0"');
    expect(inline).not.toMatch(/display\s*=\s*"none"[\s\S]{0,40}bar/);
  });

  it("holds its height across both shapes, so the page never reflows", () => {
    // Only the width changes. A product page that twitches every time the
    // shopper scrolls back to it would be worse than no animation at all.
    expect(inline).toContain('bar.style.height = PUCK + "px";');
    const shapeFn = block(inline, "function shape()", "function drawIn");
    expect(shapeFn, "shape() must not touch height").not.toContain("height");
  });

  it("states the expanded shape rather than inheriting it", () => {
    // drawIn() only acts on a change, so without an explicit first call the
    // bar's initial shape is whatever the base CSS left behind and the two
    // drift apart on any edit.
    expect(inline).toMatch(/shape\(\);\s*\n\s*\/\*/);
  });

  it("clips the sentence rather than reflowing it while narrowing", () => {
    expect(inline).toContain('bar.style.overflow = "hidden"');
    expect(inline).toContain("white-space:nowrap");
  });

  it("holds the bar open while the advisor is, and cancels the timer", () => {
    // The bar is the header of the panel below it. A timer drawing it down to
    // a spark mid-conversation would leave the panel hanging off an icon.
    expect(inline).toMatch(/if \(open\) \{\s*stopPeekTimer\(\);\s*drawIn\(false\);\s*\} else \{\s*peek\(\);/);
  });

  it("animates the shape, never the position", () => {
    expect(inline).toContain("transition:width .26s ease,padding .26s ease,border-radius .26s ease");
    expect(inline).not.toMatch(/transition:[^"]*\b(all|position|bottom)\b/);
  });

  it("takes no offset attribute it cannot honour", () => {
    // It sits where it was pasted and never leaves the flow, so there is no
    // distance from an edge for data-offset-bottom to mean. Accepting an
    // attribute in order to ignore it is worse than not accepting it.
    const auto = block(widget, 'if (mode === "inline")', "// Voice is what this product IS");
    // The attribute must not be READ here — the comment explaining why is
    // allowed to name it.
    expect(auto).not.toMatch(/getAttribute\("data-offset-bottom"\)/);
    expect(auto).not.toMatch(/offsetY\s*:/);
  });
});
