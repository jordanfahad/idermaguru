import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as speechGet, POST as speechPost } from "../src/app/api/voice-agent/speech/route";
import { POST as transcribePost } from "../src/app/api/voice-agent/transcribe/route";
import { POST as visionPost } from "../src/app/api/voice-agent/vision/route";
import {
  consume,
  DYNAMIC_SPEECH,
  PHOTO_REVIEW,
  rateLimit,
  SCRIPTED_SPEECH,
  TRANSCRIPTION,
} from "@/lib/rate-limit";
import { acknowledgements, scriptedLines } from "@/services/voice-agent";

/**
 * The advisor's speech, transcription and camera endpoints proxy paid models
 * and take no credential, so anyone reading the storefront's network tab can
 * run them. These budgets are the only thing in front of them.
 *
 * Two ways to get this wrong, and they are not symmetric. Too loose and the
 * merchant pays for a stranger's text-to-speech; too tight and a real shopper
 * is cut off mid-sentence, which is the failure that loses the customer. So
 * most of what is pinned here is headroom: the client is deliberately chatty —
 * it prewarms every scripted line on page load and preloads every part of a
 * reply in parallel — and none of that may ever come close to a ceiling.
 *
 * The clock is passed in, so a window can expire without a test waiting a real
 * minute, and each case uses its own address so nothing leaks between them.
 */

/** A single request key, unique per case, so the shared counters stay isolated. */
let addresses = 0;
const address = () => `198.51.100.${(addresses += 1)}`;

const forwarded = (ip: string, url = "http://localhost/api/voice-agent/vision") =>
  new Request(url, { method: "POST", headers: { "x-forwarded-for": ip } });

describe("the request budget", () => {
  it("lets a client spend right up to the ceiling before it refuses", () => {
    const key = address();
    const budget = { name: "test", limit: 5, windowMs: 60_000 };
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect(consume(key, budget, 1_000).allowed).toBe(true);
    }
    expect(consume(key, budget, 1_000).allowed).toBe(false);
  });

  it("tells a refused client how many seconds until it may try again", () => {
    const key = address();
    const budget = { name: "test", limit: 1, windowMs: 60_000 };
    consume(key, budget, 1_000);
    // Forty seconds into a sixty-second window: twenty left, never zero, or a
    // client that honours Retry-After would come straight back and be refused.
    const refused = consume(key, budget, 41_000);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBe(20);
  });

  it("gives the allowance back once the window has passed", () => {
    const key = address();
    const budget = { name: "test", limit: 2, windowMs: 60_000 };
    consume(key, budget, 1_000);
    consume(key, budget, 1_000);
    expect(consume(key, budget, 1_000).allowed).toBe(false);
    // Still inside the window a moment before it ends, open again a moment after.
    expect(consume(key, budget, 60_999).allowed).toBe(false);
    expect(consume(key, budget, 61_001).allowed).toBe(true);
  });

  it("does not extend the window when a client keeps hammering it", () => {
    const key = address();
    const budget = { name: "test", limit: 1, windowMs: 60_000 };
    consume(key, budget, 0);
    // A shopper sharing a carrier address with a bot must get their allowance
    // back on schedule, not be held out for as long as the bot keeps knocking.
    for (let attempt = 0; attempt < 50; attempt += 1) consume(key, budget, 30_000);
    expect(consume(key, budget, 60_001).allowed).toBe(true);
  });

  it("keeps one address's spending off another's", () => {
    const noisy = address();
    const shopper = address();
    const budget = { name: "test", limit: 2, windowMs: 60_000 };
    consume(noisy, budget, 0);
    consume(noisy, budget, 0);
    expect(consume(noisy, budget, 0).allowed).toBe(false);
    expect(consume(shopper, budget, 0).allowed).toBe(true);
  });

  it("keeps each endpoint's allowance separate", () => {
    const ip = address();
    // A page load spends hundreds of scripted-line requests. If those counted
    // against the camera, the shopper's first photo would be refused.
    for (let attempt = 0; attempt < SCRIPTED_SPEECH.limit + 5; attempt += 1) {
      consume(`${SCRIPTED_SPEECH.name}:${ip}`, SCRIPTED_SPEECH, 0);
    }
    expect(consume(`${SCRIPTED_SPEECH.name}:${ip}`, SCRIPTED_SPEECH, 0).allowed).toBe(false);
    expect(consume(`${PHOTO_REVIEW.name}:${ip}`, PHOTO_REVIEW, 0).allowed).toBe(true);
  });
});

describe("headroom over what a real session actually does", () => {
  /**
   * What the client fires at the scripted-line door before anyone has touched
   * it: the greeting, then the interview questions, then the acknowledgements.
   * Derived rather than written down, so growing the advisor's script fails
   * here instead of silently eating into a shopper's allowance.
   */
  const prewarm = scriptedLines("en").length + acknowledgements("en").length;

  it("absorbs a page load, a language switch and a fast minute of talking", () => {
    const key = address();
    // Worst honest minute for one shopper: the prewarm, the whole prewarm again
    // because the first reply switched the interface to Arabic, then six turns
    // preloading all five parts of a reply in parallel — and each scripted part
    // may knock on this door twice when the first attempt is refused upstream.
    const busiestMinute = prewarm * 2 + 6 * 5 * 2;
    for (let request = 0; request < busiestMinute; request += 1) {
      expect(consume(key, SCRIPTED_SPEECH, 0).allowed).toBe(true);
    }
    // And it is not close: several shoppers behind one carrier address all have
    // to fit, because that is normal on Gulf mobile networks.
    expect(SCRIPTED_SPEECH.limit).toBeGreaterThanOrEqual(busiestMinute * 4);
  });

  it("leaves the free-text door room for far more model-written lines than a conversation has", () => {
    const key = address();
    // Only the parts a model wrote come through POST — at most three of a
    // reply's five parts. Six turns is a fast minute of conversation.
    const busiestMinute = 6 * 3;
    for (let request = 0; request < busiestMinute; request += 1) {
      expect(consume(key, DYNAMIC_SPEECH, 0).allowed).toBe(true);
    }
    expect(DYNAMIC_SPEECH.limit).toBeGreaterThanOrEqual(busiestMinute * 10);
  });

  it("leaves room for a shopper in a noisy shop re-triggering the recorder", () => {
    const key = address();
    // A recorded turn cannot repeat faster than about every two seconds, so
    // thirty is the physical ceiling for one shopper in one minute. Refusing
    // one of these reads to the client as silence and eventually as "I'm having
    // trouble hearing you", so this is the budget it is worst to get wrong.
    for (let turn = 0; turn < 30; turn += 1) {
      expect(consume(key, TRANSCRIPTION, 0).allowed).toBe(true);
    }
    expect(TRANSCRIPTION.limit).toBeGreaterThanOrEqual(120);
  });

  it("leaves room for a shopper who retakes the photo several times", () => {
    const key = address();
    for (let photo = 0; photo < 10; photo += 1) {
      expect(consume(key, PHOTO_REVIEW, 0).allowed).toBe(true);
    }
    // Ten retakes is already an indecisive shopper, and a refusal here is the
    // only one that dead-ends instead of degrading — so the budget carries a
    // whole carrier's worth of them, not one person's.
    expect(PHOTO_REVIEW.limit).toBeGreaterThanOrEqual(10 * 10);
  });

  /**
   * The cheap door must never close before the expensive one.
   *
   * A scripted line refused at the GET door is not dropped — the client asks
   * for the same words again over POST (R-067 added that fallback so a closed
   * cache door could not mute the advisor). So if the CDN-served budget were
   * ever the first to run out, refusing it would move that traffic onto the
   * endpoint that actually synthesises, and this whole file would be spending
   * money rather than saving it.
   */
  it("closes the paid door before the free one, whatever the numbers are tuned to", () => {
    expect(SCRIPTED_SPEECH.limit).toBeGreaterThan(DYNAMIC_SPEECH.limit * 2);
  });
});

describe("the map cannot grow without bound", () => {
  it("stops tracking addresses forever, and lets an evicted one start over", () => {
    // Drive far more distinct addresses through one instance than it will hold,
    // the way a busy point of presence would over a long-lived container.
    for (let caller = 0; caller < 12_000; caller += 1) {
      expect(consume(`vision:${caller}.0.0.1`, PHOTO_REVIEW, 0).allowed).toBe(true);
    }
    // The first caller's counter is long evicted; it must come back allowed
    // rather than refused. A limiter that runs out of room has to fail towards
    // letting shoppers talk.
    expect(consume("vision:0.0.0.1", PHOTO_REVIEW, 0).allowed).toBe(true);
  });
});

describe("the route guard", () => {
  it("waves a request through while the caller is inside its budget", () => {
    expect(rateLimit(forwarded(address()), PHOTO_REVIEW)).toBeNull();
  });

  it("answers an over-budget caller with 429 and a Retry-After it can act on", () => {
    const ip = address();
    for (let request = 0; request < PHOTO_REVIEW.limit; request += 1) {
      expect(rateLimit(forwarded(ip), PHOTO_REVIEW)).toBeNull();
    }
    const refused = rateLimit(forwarded(ip), PHOTO_REVIEW);
    expect(refused?.status).toBe(429);
    expect(Number(refused?.headers.get("retry-after"))).toBeGreaterThan(0);
    // A refusal must never be stored. The scripted lines are served to the CDN
    // as immutable, and a 429 cached against one of those URLs would mute that
    // line for every shopper behind the same point of presence.
    expect(refused?.headers.get("cache-control")).toBe("no-store");
  });

  it("keys on the shopper, not on the proxy that forwarded them", () => {
    const shopper = address();
    const relay = address();
    const chained = new Request("http://localhost/api/voice-agent/vision", {
      method: "POST",
      headers: { "x-forwarded-for": `${shopper}, ${relay}` },
    });
    for (let request = 0; request < PHOTO_REVIEW.limit; request += 1) rateLimit(chained, PHOTO_REVIEW);
    expect(rateLimit(chained, PHOTO_REVIEW)?.status).toBe(429);
    // The relay's own address was never charged, so a second shopper arriving
    // through the same hop is untouched.
    expect(rateLimit(forwarded(relay), PHOTO_REVIEW)).toBeNull();
  });

  it("falls back to x-real-ip when there is no forwarded chain", () => {
    const ip = address();
    const request = () =>
      new Request("http://localhost/api/voice-agent/vision", {
        method: "POST",
        headers: { "x-real-ip": ip },
      });
    for (let attempt = 0; attempt < PHOTO_REVIEW.limit; attempt += 1) rateLimit(request(), PHOTO_REVIEW);
    expect(rateLimit(request(), PHOTO_REVIEW)?.status).toBe(429);
  });

  it("lets an address-less request through rather than pooling every caller into one bucket", () => {
    // No forwarded address means no platform proxy — local dev, or this test.
    // Sharing a single "unknown" counter would mean that the day the platform
    // renames the header, every shopper in the world lands in the same bucket
    // and the advisor goes silent for all of them at once.
    const bare = () => new Request("http://localhost/api/voice-agent/vision", { method: "POST" });
    for (let attempt = 0; attempt < PHOTO_REVIEW.limit * 3; attempt += 1) {
      expect(rateLimit(bare(), PHOTO_REVIEW)).toBeNull();
    }
  });
});

/**
 * The guard is only worth anything if it is actually the first thing each
 * handler does. These drive the real route exports until the budget runs out —
 * with no API key and a fetch that throws, so nothing here can reach a paid
 * model even if the guard were missing.
 */
describe("the endpoints that spend money", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_COMPATIBLE_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubGlobal("fetch", () => {
      throw new Error("no test may reach a paid model");
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const spend = async (budget: { limit: number }, send: () => Promise<Response>) => {
    for (let request = 0; request < budget.limit; request += 1) {
      expect((await send()).status).not.toBe(429);
    }
    return send();
  };

  it("stops a caller reading text-to-speech out of the free-text door", async () => {
    const ip = address();
    const send = () =>
      speechPost(
        new Request("http://localhost/api/voice-agent/speech", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": ip },
          body: JSON.stringify({ text: "read me my emails", language: "en" }),
        }),
      );
    const refused = await spend(DYNAMIC_SPEECH, send);
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBeTruthy();
  });

  it("charges the scripted door before it decides whether the text is scripted", async () => {
    const ip = address();
    // Junk text: every one of these is a 400 the caller pays for, so hammering
    // the cheap refusal is not an unlimited supply of function invocations.
    const send = () =>
      speechGet(
        new Request(`http://localhost/api/voice-agent/speech?lang=en&text=not-a-line`, {
          headers: { "x-forwarded-for": ip },
        }),
      );
    expect((await spend(SCRIPTED_SPEECH, send)).status).toBe(429);
  });

  it("stops a caller feeding audio into the transcriber", async () => {
    const ip = address();
    const send = () =>
      transcribePost(
        new Request("http://localhost/api/voice-agent/transcribe?lang=en", {
          method: "POST",
          headers: { "content-type": "audio/mp4", "x-forwarded-for": ip },
          body: new ArrayBuffer(4096),
        }),
      );
    expect((await spend(TRANSCRIPTION, send)).status).toBe(429);
  });

  it("stops a caller using the camera look as a general image captioner", async () => {
    const ip = address();
    const send = () =>
      visionPost(
        new Request("http://localhost/api/voice-agent/vision", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": ip },
          body: JSON.stringify({ image: `data:image/jpeg;base64,${"A".repeat(128)}` }),
        }),
      );
    expect((await spend(PHOTO_REVIEW, send)).status).toBe(429);
  });
});
