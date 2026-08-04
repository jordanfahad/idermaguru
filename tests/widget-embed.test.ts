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
