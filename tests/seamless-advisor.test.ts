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
    // The grid that put the conversation in a sidebar is gone with the layout
    // that needed it.
    expect(css).not.toContain(".va-grid");
    expect(css).not.toContain(".va-transcript");
  });

  it("follows the newest message", () => {
    // A reply that lands below the fold looks like nothing happened — the
    // original complaint, in four words. `focus` too: the product card lands
    // at the TOP of the thread and pushes everything below it down.
    expect(advisor).toMatch(/panel\.scrollTop = panel\.scrollHeight;\s*pinnedRef\.current = true;\s*\}, \[turns, interim, products, phase, focus\]\)/);
  });

  it("stays at the bottom when the thread shrinks rather than grows", () => {
    // Opening the camera or a notice grows the dock and clips the thread from
    // below, with no content change for an effect to see.
    expect(advisor).toMatch(/new ResizeObserver\(\(\) => \{\s*if \(pinnedRef\.current\) panel\.scrollTop = panel\.scrollHeight;/);
    // But only for a shopper who was already there.
    expect(advisor).toMatch(/pinnedRef\.current = panel\.scrollHeight - panel\.scrollTop - panel\.clientHeight < 32/);
  });

  it("keeps a height on engines without dvh", () => {
    // An unknown unit invalidates the whole clamp(), and with no height the
    // thread (flex-basis 0) renders at exactly 0px.
    const root = css.slice(css.indexOf(".va {"), css.indexOf(".va-rtl"));
    expect(root).toMatch(/height: clamp\(480px, 72vh, 680px\);\s*height: clamp\(480px, 72dvh, 680px\);/);
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
    expect(advisor).toMatch(/className="va-routine-msg" key="routine"/);
    // And clearing the routine clears its place in the conversation.
    expect(advisor).toMatch(/routinePosRef\.current = null;/);
  });

  it("keeps the thread one keyed list, so moving the routine remounts nothing", () => {
    // Split into before/after arrays, every bubble that crossed the split on
    // "Start a new routine" unmounted, remounted and replayed its entrance.
    expect(advisor).toMatch(/const threadItems = turns\.map\(\(turn, index\) => bubble\(turn, index\)\);/);
    expect(advisor).toMatch(/if \(routineEl\) threadItems\.splice\(routinePos, 0, routineEl\);/);
    expect(advisor).not.toMatch(/turnsBeforeRoutine|turnsAfterRoutine/);
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

  it("drives the hang-up button's ring too, which lives outside the avatar", () => {
    // The live mic's ring reads --level, but the button sits in the dock and
    // only ever inherited the static 0 from the root — frozen for the call.
    expect(css).toMatch(/\.va-mic-live \{[\s\S]{0,200}var\(--level\)/);
    expect(advisor).toMatch(/micRef\.current\?\.style\.setProperty\("--level", value\)/);
    expect(advisor).toMatch(/<button\s+ref=\{micRef\}/);
  });

  it("says who is talking in the header, politely", () => {
    expect(advisor).toMatch(/className="va-presence" aria-live="polite"/);
  });
});

/**
 * A reply, or a line of speech, outliving the call that asked for it.
 *
 * A turn is a network round trip and a spoken answer is a chain of lines, and
 * either can still be running when the shopper hangs up — by tapping stop
 * while the advisor thinks, by typing instead, or because the storefront
 * closed the drawer. Nothing recorded which call a reply belonged to, so it
 * was read out regardless: after the hang-up, over the shopper's next
 * sentence, or behind a closed panel on the merchant's page.
 */
describe("speech never outlives its call", () => {
  it("counts hang-ups — stop, and the storefront closing the drawer", () => {
    expect(advisor).toMatch(/const callGenRef = useRef\(0\);/);
    expect(advisor).toMatch(/function stop\(\) \{\s*callGenRef\.current \+= 1;/);
    expect(advisor).toMatch(/const hangUp = \(\) => \{\s*callGenRef\.current \+= 1;/);
  });

  it("decides at SEND time whether a reply may be spoken", () => {
    // Read at landing time, a typed question answered after the shopper
    // tapped the mic was spoken over them — and speak() aborting recognition
    // discarded the sentence they had started.
    const send = advisor.slice(advisor.indexOf("const send = useCallback("));
    expect(send.slice(0, 1600)).toMatch(/const gen = callGenRef\.current;\s*const typed = modeRef\.current === "chat";/);
    expect(send.slice(0, 1600)).toMatch(/handleTurn\(payload, \{ silent: typed \|\| gen !== callGenRef\.current \}\)/);
  });

  it("does not knock a live call back to idle when a silent reply lands", () => {
    expect(advisor).toMatch(/if \(options\?\.silent \|\| modeRef\.current === "chat"\) \{\s*setPhase\(\(current\) => \(current === "thinking" \? "idle" : current\)\);/);
  });

  it("ends a multi-line answer at the hang-up, not after it", () => {
    // stop() pauses the playing line, but the next may still be loading, and
    // the browser voice reports a cancelled line as finished.
    const sequence = advisor.slice(advisor.indexOf("const speakSequence = useCallback("));
    expect(sequence.slice(0, 2600)).toMatch(/const step = \(index: number\) => \{\s*if \(gen !== callGenRef\.current\) return;/);
  });

  it("does not start a line that finished loading after the hang-up", () => {
    const speak = advisor.slice(advisor.indexOf("const speak = useCallback("));
    expect(speak).toMatch(/if \(gen !== callGenRef\.current\) \{\s*once\(\(\) => \{\}\);\s*return;\s*\}\s*if \(!exited\) \{\s*await audio\.play\(\);/);
    // Nor fall back to the browser voice for an ended call.
    expect(speak).toMatch(/const fallBack = \(\) => once\(\(\) => \(gen === callGenRef\.current \? speakWithBrowser\(text, onDone\) : undefined\)\);/);
  });

  it("re-checks the call before reopening the microphone after an answer", () => {
    expect(advisor).toMatch(/if \(keepGoing && continueRef\.current && modeRef\.current === "voice"\) \{\s*listen\(\);/);
  });
});

describe("the dock in a 624px drawer", () => {
  it("lets the transient extras scroll and keeps the composer out of it", () => {
    // Camera preview + notice + call bar + chips could want more than the
    // panel had; with the dock rigid the thread hit 0px and the composer was
    // pushed off the bottom of the frame.
    expect(advisor).toMatch(/className="va-dock-extras"/);
    const extras = css.slice(css.indexOf(".va-dock-extras {"), css.indexOf("}", css.indexOf(".va-dock-extras {")));
    expect(extras).toContain("overflow-y: auto");
    expect(extras).toContain("min-height: 0");
    expect(css).toMatch(/\.va-composer \{ flex: none; \}/);
    // The composer is outside the scrolling part.
    const extrasOpen = advisor.indexOf('className="va-dock-extras"');
    const composer = advisor.indexOf('className="va-composer"');
    const extrasClose = advisor.lastIndexOf("</div>", composer);
    expect(composer).toBeGreaterThan(extrasClose);
    expect(extrasClose).toBeGreaterThan(extrasOpen);
  });

  it("gives the thread a floor it cannot be squeezed below", () => {
    const thread = css.slice(css.indexOf(".va-thread {"), css.indexOf(".va-thread::"));
    expect(thread).toMatch(/min-height: 96px/);
  });

  it("caps the camera preview so it cannot take the panel", () => {
    expect(css).toMatch(/\.va-camera video \{[\s\S]{0,300}max-height: 220px/);
  });
});

describe("Arabic gets the same spacing, mirrored", () => {
  it("uses logical properties on the alert and composer", () => {
    // cicabelle.com/ar is live; physical padding put the tight edge and the
    // dismiss button's corner tuck on the wrong sides.
    const alert = css.slice(css.indexOf(".va-alert {"), css.indexOf(".va-alert > span"));
    expect(alert).toMatch(/padding-inline: 14px 12px/);
    expect(alert).not.toMatch(/padding: \d+px \d+px \d+px \d+px/);
    expect(css).toMatch(/\.va-alert-x \{[\s\S]{0,200}margin-inline-end: -3px/);
    const composer = css.slice(css.indexOf(".va-composer {\n"), css.indexOf(".va-composer input {"));
    expect(composer).toMatch(/padding-inline-start: 6px/);
  });
});
