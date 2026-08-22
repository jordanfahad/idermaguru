import { readFileSync } from "node:fs";
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

    expect(widget).toContain("height:min(624px,calc(100vh - var(--dg-offset-y,20px) - var(--dg-chrome,90px)))");
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

  it("swaps the label for the close text without destroying the tagline", () => {
    // Assigning to the button's own textContent would delete both spans and
    // leave a bare string, so the tagline never returned after the first close.
    const voice = block(widget, "function mountVoice", "var supportsCE");
    expect(voice).toMatch(/line1\.textContent = isOpen \? closeText : labelOpen/);
    expect(voice, "the button's textContent must never be assigned wholesale").not.toMatch(
      /\b(button|pill)\.textContent\s*=/,
    );
  });

  it("hides the tagline while the advisor is open, in every rendering", () => {
    // "Talk to our advisor" is an instruction the shopper has already followed.
    const voice = block(widget, "function mountVoice", "var supportsCE");
    expect(voice, "pill mode").toMatch(/line2\.style\.display = isOpen \? "none" : "block"/);
    expect(voice, "icon mode").toMatch(/bubble\.style\.display = isOpen \? "none" : "block"/);
    expect(widget, "chat mode").toContain('this.launchTagline.style.display = "none"');
    expect(widget, "chat mode").toContain('this.launchTagline.style.display = "block"');
  });

  it("keeps the accessible name in step with the visible one", () => {
    // A button whose aria-label still says "Skincare advisor" while it closes
    // the advisor is announced wrongly to anyone not looking at it. In icon
    // mode there is no visible text at all, so this is the only name it has.
    const voice = block(widget, "function mountVoice", "var supportsCE");
    expect(voice, "pill mode").toMatch(/pill\.setAttribute\("aria-label", isOpen \? closeText : labelOpen\)/);
    expect(voice, "icon mode").toMatch(/circle\.setAttribute\("aria-label", isOpen \? closeText : labelOpen\)/);
    expect(widget).toContain('this.launch.setAttribute("aria-label", t(this.cfg.locale, "close"))');
    expect(widget).toContain('this.launch.setAttribute("aria-label", this.cfg.label)');
  });

  it("takes the extra line out of the panel's height budget, but only when it costs height", () => {
    // Same trap as the offset: the panel sits above the launcher, so a taller
    // launcher pushes the panel's header off the top unless the budget follows.
    // In icon mode the words sit BESIDE the circle, so they cost nothing and
    // charging for them would shrink the panel for no reason.
    const voice = block(widget, "function mountVoice", "var supportsCE");
    expect(voice).toContain('var chrome = !iconMode && tagline ? "120px" : "100px"');
    expect(widget).toContain('container.style.setProperty("--dg-chrome", "110px")');
  });

  it("stacks the two lines instead of putting them side by side", () => {
    expect(widget).toMatch(/\.lines\{display:flex;flex-direction:column/);
    // and mirrors for Arabic rather than left-aligning under an RTL label
    expect(widget).toContain(".dg[dir=rtl] .lines{align-items:flex-end}");
    expect(block(widget, "function mountVoice", "var supportsCE")).toContain('button.setAttribute("dir", "rtl")');
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

  it("puts the bubble on the inward side of the circle", () => {
    // The circle is what is pinned to the corner; the bubble points inward. If
    // the order did not flip, bottom-left would push the bubble off-screen.
    expect(voice).toContain("if (bubble && !atLeft) mount.appendChild(bubble);");
    expect(voice).toContain("if (bubble && atLeft) mount.appendChild(bubble);");
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
