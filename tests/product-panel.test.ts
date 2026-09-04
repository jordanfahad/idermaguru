import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The product page opening with an offer, and what it is allowed to do from
 * inside somebody else's page.
 *
 * The server has been able to open about a product since #16. The panel never
 * asked: it greeted from a hardcoded line the moment somebody tapped the
 * microphone and made no opening request at all, so a shopper standing in
 * front of one product was asked "what's bothering your skin?" as though the
 * page did not exist. Everything below is the wiring that closes that, and the
 * one security property the add-to-bag message rests on.
 */

const advisor = readFileSync(new URL("../src/components/voice-agent.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../src/app/advisor/page.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/components/voice-agent.css", import.meta.url), "utf8");

describe("opening about the product on the page", () => {
  it("asks the server for an opening turn when there is a product", () => {
    // The whole fix. Without this call the focus card and the chips are
    // computed by a route nothing ever invokes.
    expect(advisor).toMatch(/openedRef\.current = true/);
    expect(advisor).toMatch(/requestTurn\(""\)\s*\.then\(/);
    // Their ordering — and the guard that now sits between them — is pinned by
    // "the shopper getting there first" below.
    expect(advisor).toMatch(/handleTurn\(payload, \{ silent: true \}\)/);
  });

  it("does it once, and only with a product", () => {
    expect(advisor).toMatch(/if \(!focusProduct \|\| openedRef\.current\) return;/);
  });

  it("stays silent, because nobody has tapped anything yet", () => {
    // An advisor that starts talking the moment a panel opens on a storefront
    // would be a bug even if autoplay allowed it, which it does not.
    expect(advisor).toMatch(/options\?\.silent \|\| modeRef\.current === "chat"/);
  });

  it("keeps the focus card out of the routine list", () => {
    // `products` renders under "Your routine — 1 step". The page's own product
    // arriving there mislabelled it AND displaced the chips, since the picks
    // panel only renders when products is empty.
    expect(advisor).toMatch(/if \(payload\.focus\) setFocus\(payload\.focus\)/);
  });
});

/**
 * The opening turn landing on a conversation that already started.
 *
 * Shipped broken and reported by customers within the hour as "the voice
 * stops". The opening request includes an LLM call, so it resolves a second or
 * two after the panel appears — by which time the shopper may have tapped the
 * microphone. Applying it then reset the slots to empty (forgetting what they
 * had just said), appended a greeting mid-transcript, and put the phase back
 * to idle, which removed the call bar and turned the orb back into a start
 * button while the advisor was still listening.
 */
describe("the shopper getting there first", () => {
  it("checks whether the conversation started before applying the opening turn", () => {
    expect(advisor).toMatch(/if \(startedRef\.current\) \{[\s\S]{0,160}return;\s*\}\s*handleTurn\(payload, \{ silent: true \}\)/);
  });

  it("keeps the card, which is a fact about the page rather than a turn", () => {
    expect(advisor).toMatch(/if \(startedRef\.current\) \{\s*if \(payload\.focus\) setFocus\(payload\.focus\);/);
  });

  it("tracks started in a ref, because state does not reach an async closure", () => {
    expect(advisor).toMatch(/const markStarted = useCallback\(\(\) => \{\s*startedRef\.current = true;\s*setStarted\(true\);/);
  });

  it("routes every start through that helper", () => {
    // The invariant with teeth. A future call site that reaches for
    // setStarted directly would leave the ref stale and bring the race back,
    // and it would do it silently.
    const direct = advisor.match(/setStarted\(/g) ?? [];
    expect(direct.length, "setStarted must be called only inside markStarted").toBe(1);
    expect((advisor.match(/markStarted\(\)/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});

/**
 * The microphone failing without the shopper ever finding out.
 *
 * From a customer's screen recording: the advisor greeted, then sat on "TAP
 * WHEN YOU'RE READY" and never listened again. It had a message explaining
 * exactly why — and rendered it at the very bottom of the panel, below the
 * mode buttons, the camera consent and the concerns list, which on a phone is
 * off-screen. So the panel explained itself to nobody, and stayed in Voice
 * mode offering an orb that would fail again on the next tap.
 */
describe("when the microphone cannot be had", () => {
  it("pins the reason so scrolling cannot hide it", () => {
    // Under the orb was the previous attempt, and it failed the moment a
    // conversation had a few turns in it: the shopper scrolls down to read the
    // transcript and the sentence scrolls off the top. Anything in the flow of
    // this panel is off-screen exactly when it matters.
    expect(advisor).toMatch(/className="va-alert" role="status"/);
    const alert = css.slice(css.indexOf(".va-alert {"), css.indexOf(".va-alert a"));
    expect(alert).toContain("position: fixed");
    expect(alert).toContain("z-index");
  });

  it("keeps the escape hatch with the message rather than at the far end of the page", () => {
    expect(advisor).toMatch(/<span>\{notice\}<\/span>\s*<a[\s\S]{0,120}\{t\.fallback\}/);
  });

  it("moves the shopper to chat instead of leaving a dead orb", () => {
    // A shopper on a storefront does not debug permissions; they leave.
    expect(advisor).toMatch(/modeRef\.current = "chat";\s*setMode\("chat"\);\s*setPhase\("idle"\);/);
  });

  it("routes every hard failure through the one fallback", () => {
    expect((advisor.match(/giveUpOnVoice\("(denied|unsupported)"\)/g) ?? []).length).toBe(3);
    // The old shape left the panel in voice mode with a message nobody saw.
    expect(advisor).not.toMatch(/setNotice\(t\.denied\);\s*continueRef\.current = false;/);
  });

  it("only blames the page when it can actually check", () => {
    // allow="microphone" is permission DELEGATION: with it the shopper still
    // gets the ordinary prompt and can still say no. Being in an iframe is
    // therefore not evidence of anything, and treating it as evidence meant
    // telling a shopper who had just tapped "Don't Allow" that the page was
    // at fault. Only the Permissions Policy answers it, and only where it
    // exists — Safari does not implement it, which is most of this traffic.
    expect(advisor).toMatch(/function pageBlocksMic\(\): boolean \| null/);
    expect(advisor).toMatch(/pageBlocksMic\(\) === true \? t\.deniedEmbedded : t\.denied/);
    expect(advisor, "being framed is not evidence").not.toMatch(/framed \? t\.deniedEmbedded/);
    const embedded = advisor.match(/deniedEmbedded: "[^"]+"/g) ?? [];
    expect(embedded.length, "both copy tables").toBe(2);
    expect(embedded.some((line) => /[؀-ۿ]/.test(line))).toBe(true);
  });

  it("names both causes when it cannot tell them apart", () => {
    // The common case on this store, since Safari has no Permissions Policy
    // API. Asserting a single cause here would be a guess presented as fact.
    const generic = advisor.match(/\n    denied: "[^"]+"/g) ?? [];
    expect(generic.length).toBe(2);
    expect(generic[0]).toMatch(/browser blocked it/);
    expect(generic[0]).toMatch(/page hasn't allowed it/);
  });
});

/**
 * Knowing why the microphone produced nothing.
 *
 * A shopper's advisor went quiet four turns into a conversation. The server
 * logs showed five transcribe calls, all 200, and nothing else — because the
 * playback side has been instrumented since the silent-advisor bug and the
 * LISTENING side never was. From outside the device, "they stopped talking"
 * and "the microphone captured silence" look identical.
 */
describe("reporting what the microphone produced", () => {
  it("reports a recording that transcribed to nothing", () => {
    expect(advisor).toMatch(/logClient\("mic-silent", \{[\s\S]{0,160}bytes: blob\.size/);
  });

  it("reports the size and the meter, which are what tell the causes apart", () => {
    // A healthy blob that transcribes to nothing is a dead audio route; a tiny
    // one is a recorder that never engaged; a quiet meter with a real blob is
    // the known suspended-analyser case.
    const call = advisor.slice(advisor.indexOf('logClient("mic-silent"'));
    expect(call.slice(0, 300)).toMatch(/bytes:/);
    expect(call.slice(0, 300)).toMatch(/level: Boolean\(voiceAt\)/);
    expect(call.slice(0, 300)).toMatch(/restarts:/);
  });

  it("reports a recorder that captured no audio at all, and the give-up", () => {
    expect(advisor).toMatch(/logClient\("mic-no-audio"/);
    expect(advisor).toMatch(/logClient\("mic-stand-down", \{ everHeard: everHeardRef\.current/);
  });
});

describe("adding to the shop's cart from inside an iframe", () => {
  it("addresses the shop's own origin, never a wildcard", () => {
    // The one that matters. postMessage(..., "*") on a panel embedded by an
    // arbitrary page broadcasts to whoever framed us; the product's own URL
    // came out of the merchant's catalogue, so its origin is the shop's.
    expect(advisor).toMatch(/origin = new URL\(product\.url\)\.origin/);
    expect(advisor).toMatch(/window\.parent\.postMessage\(/);
    expect(advisor).not.toMatch(/postMessage\([\s\S]{0,400}?,\s*"\*"\s*\)/);
  });

  it("sends the handle rather than an id we do not have", () => {
    // The sync keeps the first variant's price and SKU, and on most of this
    // catalogue those SKUs are `csv-<timestamp>-<row>` — a number that would
    // look like a variant id and add the wrong thing.
    expect(advisor).toMatch(/type: "dermaguru:add-to-cart"/);
    expect(advisor).toMatch(/version: 1/);
    expect(advisor).toMatch(/handle,/);
    expect(advisor).not.toMatch(/variantId/);
  });

  it("refuses to post a message it cannot address", () => {
    expect(advisor).toMatch(/\} catch \{\s*return;\s*\}/);
    expect(advisor).toMatch(/if \(!handle\) return;/);
  });
});

describe("a question the storefront asked on the shopper's behalf", () => {
  it("reads q, flattens it, and caps it", () => {
    // It arrives in a URL anyone can edit. Capped so it cannot ride along in
    // every request of the session, flattened so it stays one utterance.
    expect(page).toMatch(/params\.q\?\.replace\(\/\\s\+\/g, " "\)\.trim\(\)\.slice\(0, 300\)/);
    expect(page).toMatch(/initialQuestion=\{initialQuestion\}/);
  });

  it("is sent as an utterance, which is the one thing the engine never obeys", () => {
    expect(advisor).toMatch(/void send\(initialQuestion\)/);
  });

  it("takes precedence over the plain opening turn rather than racing it", () => {
    expect(advisor).toMatch(/if \(initialQuestion\) \{[\s\S]{0,260}return;\s*\}/);
  });
});

describe("the card renders in both directions", () => {
  it("styles every class the card uses", () => {
    for (const name of [".va-focus", ".va-focus-body", ".va-focus-brand", ".va-focus-actions", ".va-focus-add", ".va-focus-view", ".va-sr"]) {
      expect(css, `${name} is used by the panel but never styled`).toContain(name);
    }
  });

  it("uses logical properties, because cicabelle.com/ar is live", () => {
    // margin-left on this card is a card in the wrong place for half the
    // catalogue's traffic.
    const block = css.slice(css.indexOf(".va-focus {"));
    expect(block).toContain("margin-block-end");
    expect(block).not.toMatch(/\.va-focus[^}]*margin-left/);
  });

  it("names the icon-only link for a screen reader", () => {
    expect(advisor).toMatch(/className="va-sr">\{t\.view\}/);
  });
});

describe("the panel speaks Arabic as well as English", () => {
  it("translates the new strings rather than shipping them English-only", () => {
    // lang=ar is live traffic from cicabelle.com/ar across 488 products, not a
    // future nicety.
    const strings = advisor.match(/addToBag: "[^"]+"/g) ?? [];
    expect(strings.length, "addToBag must exist in both copy tables").toBe(2);
    expect(strings.some((line) => /[؀-ۿ]/.test(line)), "one of them must be Arabic").toBe(true);

    const added = advisor.match(/addedToBag: "[^"]+"/g) ?? [];
    expect(added.length).toBe(2);
    expect(added.some((line) => /[؀-ۿ]/.test(line))).toBe(true);
  });
});
