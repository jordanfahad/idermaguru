import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The advisor as a conversation, not a control panel.
 *
 * What shipped before this was an orb with settings under it: the greeting —
 * the one conversational thing the panel ever said unprompted — rendered at
 * the very bottom of the page under a "Live transcript" label, two screens
 * below the fold of the 384×624 drawer the storefront actually embeds. A
 * shopper who typed a question watched the chips above their own message while
 * the answer landed off-screen. Nothing was broken, and the whole thing felt
 * broken.
 *
 * The shape these tests pin: one column — identity header, a thread that is
 * the panel's ONE scroller, and a dock whose composer never moves. Everything
 * that happens happens in the thread, in order.
 */

const advisor = readFileSync(new URL("../src/components/voice-agent.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/components/voice-agent.css", import.meta.url), "utf8");
const embed = readFileSync(new URL("../src/app/advisor/advisor-embed.css", import.meta.url), "utf8");

describe("the greeting is instant", () => {
  it("renders before the server has said anything", () => {
    // The opening turn is an LLM round trip — a second or two of a panel that
    // says nothing. The scripted greeting costs nothing and covers it.
    expect(advisor).toMatch(/turns\.length === 0 \|\| turns\[0\]\.role === "user"/);
    expect(advisor).toMatch(/\{GREETING\[lang\]\}/);
  });

  it("stays on top of a conversation the shopper opened by typing", () => {
    // A conversation that begins with the shopper's own words keeps the
    // greeting above it — where a greeting goes — rather than vanishing.
    expect(advisor).toMatch(/turns\[0\]\.role === "user"/);
  });
});

describe("one column, one scroller", () => {
  it("is header, thread, dock — in that order", () => {
    const head = advisor.indexOf('className="va-head"');
    const thread = advisor.indexOf('className="va-thread"');
    const dock = advisor.indexOf('className="va-dock"');
    expect(head).toBeGreaterThan(-1);
    expect(thread).toBeGreaterThan(head);
    expect(dock).toBeGreaterThan(thread);
  });

  it("scrolls the thread, not the page", () => {
    const thread = css.slice(css.indexOf(".va-thread {"), css.indexOf(".va-thread::"));
    expect(thread).toContain("overflow-y: auto");
    expect(thread).toContain("min-height: 0");
    // The grid that put the conversation in a sidebar is gone with the layout
    // that needed it.
    expect(css).not.toContain(".va-grid");
    expect(css).not.toContain(".va-transcript");
  });

  it("follows the newest message", () => {
    // A reply that lands below the fold looks like nothing happened — the
    // original complaint, in four words.
    expect(advisor).toMatch(/panel\.scrollTop = panel\.scrollHeight;\s*\}, \[turns, interim, products, phase\]\)/);
  });

  it("fills the storefront's drawer exactly", () => {
    // The host iframe is 384×624; the advisor must hand that height to the
    // thread rather than grow past it.
    expect(embed).toMatch(/height: 100dvh/);
    expect(embed).toMatch(/\.advisor-embed \.va \{\s*height: 100%;/);
    const root = css.slice(css.indexOf(".va {"), css.indexOf(".va-rtl"));
    expect(root, "a definite height, so the thread can scroll inside it").toMatch(/height: clamp\(/);
  });
});

describe("the composer never moves and never hides", () => {
  it("renders in both modes", () => {
    // It was gated on chat mode, so the default experience had no text input
    // at all until the shopper found a tab. There is no tab any more.
    expect(advisor).not.toMatch(/\{mode === "chat" \? \(\s*<form/);
    expect(advisor).toMatch(/<form\s+className="va-composer"/);
    expect(advisor).not.toMatch(/role="tablist"/);
  });

  it("carries voice as a button, not a mode decision", () => {
    // Typing answers in text; the mic starts — and stops — the call. Nothing
    // to choose before saying anything.
    expect(advisor).toMatch(/function toggleVoice\(\)/);
    expect(advisor).toMatch(/onClick=\{toggleVoice\}/);
    expect(advisor).toMatch(/\{voiceLive \? <Square size=\{16\} \/> : <Mic size=\{19\} \/>\}/);
  });

  it("puts the microphone down when the shopper types instead", () => {
    // Typing during a live call is the shopper choosing text over voice; the
    // advisor must not keep listening — or talking — over their shoulder.
    expect(advisor).toMatch(/if \(modeRef\.current === "voice"\) stop\(\);\s*modeRef\.current = "chat";/);
  });

  it("keeps iOS from zooming the panel on focus", () => {
    // Safari zooms any focused input under 16px — inside a fixed-size drawer
    // that zoom is a broken layout, not a convenience.
    const composer = css.slice(css.indexOf(".va-composer input {"), css.indexOf(".va-composer input::"));
    expect(composer).toMatch(/font-size: 16px/);
  });
});

describe("the conversation reads like one", () => {
  it("shows thinking as a message being composed", () => {
    expect(advisor).toMatch(/className="va-turn va-turn-agent va-typing"/);
    expect(css).toContain("@keyframes va-dot");
  });

  it("shows the shopper's live words where their message will land", () => {
    expect(advisor).toMatch(/phase === "listening" && interim \? \(\s*<p className="va-turn va-turn-user va-turn-interim">/);
  });

  it("renders the routine inside the thread, where it was produced", () => {
    // After the reply that produced it, with later answers arriving BELOW —
    // a message, not a side panel the thread competes with.
    expect(advisor).toMatch(/routinePosRef\.current = next\.length;/);
    expect(advisor).toMatch(/turns\.slice\(0, routinePos\)/);
    expect(advisor).toMatch(/className="va-routine-msg"/);
    // And clearing the routine clears its place in the conversation.
    expect(advisor).toMatch(/routinePosRef\.current = null;/);
  });

  it("names the speaker for a screen reader even though the bubble no longer labels it", () => {
    expect(advisor).toMatch(/className="va-sr">\{turn\.role === "user" \? t\.you : t\.agent\}/);
  });
});

describe("quick replies", () => {
  it("offers the server's chips when it offered any, starters only before the first word", () => {
    expect(advisor).toMatch(/suggestions\.length \? \(/);
    expect(advisor).toMatch(/!started && turns\.length === 0 \? \(/);
  });

  it("still sends a chip's intent, not just its words", () => {
    // A button we drew ourselves must not have to survive the tangent
    // classifier on its way home.
    expect(advisor).toMatch(/void send\(chip\.label, chip\.ask\);/);
  });
});

describe("the orb survives as the advisor's face", () => {
  it("is an avatar in the header, still driven by live audio", () => {
    expect(advisor).toMatch(/className="va-avatar" ref=\{stageRef\}/);
    // --level still swells the bloom and the ring while the call is live.
    expect(css).toMatch(/\.va-bloom[\s\S]{0,400}var\(--level\)/);
  });

  it("says who is talking in the header, politely", () => {
    expect(advisor).toMatch(/className="va-presence" aria-live="polite"/);
  });
});
