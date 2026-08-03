import { NextResponse } from "next/server";
import { getClientIp } from "@/services/privacy";

/**
 * Request budgets for the endpoints that spend the merchant's money.
 *
 * The advisor is embedded in a storefront, so every URL it calls is one
 * network-tab click away from anyone browsing the shop, and three of them proxy
 * a paid model: text-to-speech, speech-to-text, and the camera look. Nothing
 * stood in front of them, which made the speech endpoint a free text-to-speech
 * API billed to whoever's store it was embedded in.
 *
 * Be honest about what this is. The counters live in the memory of ONE
 * serverless instance. Vercel runs several, recycles them under load, and the
 * same caller can land on a fresh one on its very next request, so an abuser
 * spread across instances gets some multiple of the ceilings below rather than
 * the ceiling itself. A shared counter (Vercel KV, Upstash) is the actual fix
 * and should land before this carries traffic worth stealing.
 *
 * It is still worth having in the meantime, because the abuse that actually
 * happens to a freshly discovered public endpoint is a loop from one machine —
 * and a loop from one machine mostly lands on one instance and stops dead. This
 * costs nothing to run and turns an open door into a door that closes.
 *
 * One deployment precondition decides whether any of this helps. The platform
 * overwrites the forwarded-for header with the address it received the
 * connection from, which is what makes the counters unspoofable — but it also
 * means an advisor hostname pointed at us THROUGH another CDN arrives as that
 * CDN's edge address, collapsing every shopper in the store into a single
 * counter. A merchant subdomain must be a direct, unproxied CNAME. If one ever
 * has to sit behind a proxy, these ceilings are meaningless and the shared
 * counter below must key on something else.
 */

export type RequestBudget = {
  /** Keeps each endpoint's counter its own, so a loud page load cannot spend the camera's allowance. */
  name: string;
  /** Requests one address may make inside one window. */
  limit: number;
  windowMs: number;
};

const MINUTE = 60_000;

/**
 * The scripted-line door (GET /api/voice-agent/speech).
 *
 * This one cannot be used as a text-to-speech service: it refuses any text that
 * is not one of the advisor's own written lines, and after the first shopper
 * every one of those is served from the instance's map or straight off the CDN.
 * The budget is here to stop someone hammering the function, not to protect
 * credit, so it sits far above what the client does to itself.
 *
 * And the client is loud on purpose. Page load prewarms the greeting, then the
 * seven interview questions a beat later, then fifteen acknowledgements a beat
 * after that: twenty-three requests in the first four seconds, before the
 * shopper has touched anything. A reply that switches the interface to Arabic
 * re-runs the whole prewarm in the other language, and every turn preloads up
 * to five parts of the reply in parallel. Call a hundred and change a busy
 * minute for one shopper.
 *
 * This ceiling must never be the first one a caller reaches, which is why it is
 * so far clear of the paid door rather than merely above it. A scripted line
 * refused here does not go unsaid: the client answers a failed GET by asking
 * for the same words again over POST (see R-067, which added that fallback so a
 * closed cache door could not mute the advisor). So refusing cheap CDN-served
 * traffic hands it straight to the endpoint that actually synthesises — this
 * budget would spend money instead of saving it, and then, when the paid budget
 * ran out too, drop the whole address to the robotic browser voice.
 */
export const SCRIPTED_SPEECH: RequestBudget = { name: "speech-get", limit: 2_000, windowMs: MINUTE };

/**
 * The free-text door (POST /api/voice-agent/speech).
 *
 * The expensive one: any string up to 1200 characters, synthesised fresh every
 * time and deliberately never cached, because it carries whatever a model wrote
 * about this particular shopper. This is the endpoint that ends up on someone's
 * blog as a free TTS API.
 *
 * A reply is split into at most five parts and only the parts a model wrote
 * come through here — one or two per turn, three when the routine explanation
 * is used. Six turns is a fast minute of talking, so twenty is a busy shopper
 * and three hundred is fifteen times that. This is deliberately the tightest of
 * the two speech budgets and the one a runaway caller should meet first: it is
 * the only one of the pair that costs anything to serve.
 */
export const DYNAMIC_SPEECH: RequestBudget = { name: "speech-post", limit: 300, windowMs: MINUTE };

/**
 * One recorded turn of the call, and up to ten megabytes of audio with it.
 *
 * A turn cannot repeat faster than roughly every two seconds — record, wait out
 * the pause, upload — so thirty is the ceiling for one shopper in a room noisy
 * enough to keep re-triggering the recorder, and six to ten is an ordinary
 * talking minute. A refusal here reads to the client as silence: it re-listens,
 * and after four empty turns tells the shopper it is having trouble hearing
 * them. That is a bad thing to do to someone who is talking, so the limit sits
 * where only a script can reach it.
 */
export const TRANSCRIPTION: RequestBudget = { name: "transcribe", limit: 120, windowMs: MINUTE };

/**
 * The camera look: the most expensive call per request, and the only one that
 * needs a human to press a button and hold a phone still. Retaking a photo a
 * few times is normal; ten in a minute is already an unusually indecisive one.
 *
 * Sized per ADDRESS rather than per person, like the rest of these, and that
 * matters most here because this is the only refusal a shopper sees. Speech
 * falls back to the browser voice and a refused turn re-listens, but a refused
 * photo shows the camera error and stops — a dead end for someone who is
 * holding their phone up to their face. Behind one carrier address there may be
 * a dozen of them, so this sits an order of magnitude above one person's use
 * and still far below anything worth stealing: each call ships megabytes and
 * takes seconds, which makes this a hopeless way to caption images in bulk.
 */
export const PHOTO_REVIEW: RequestBudget = { name: "vision", limit: 120, windowMs: MINUTE };

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

/**
 * How many addresses one instance will track. The map is the only thing here
 * that grows, and an instance that has served a lot of traffic should not also
 * be holding a counter for every address that ever reached it.
 */
const MAX_TRACKED = 5_000;

function sweep(now: number) {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
  // Every window still live and the map still full: drop the oldest, and drop
  // enough of them that the next few thousand callers do not each pay for
  // another walk of the whole map. Losing a counter lets that address start
  // over, which is the direction to fail in — a limiter that runs out of room
  // must not start refusing shoppers.
  while (windows.size > 0 && windows.size >= MAX_TRACKED * 0.75) {
    const oldest = windows.keys().next().value;
    if (oldest === undefined) break;
    windows.delete(oldest);
  }
}

export type BudgetDecision = { allowed: boolean; retryAfterSeconds: number };

/**
 * Spend one request from `key`'s budget.
 *
 * A fixed window rather than a rolling one, and the clock is a parameter: the
 * whole point of the numbers above is that they are generous enough for a real
 * conversation, and that is only checkable if a test can move a minute without
 * waiting one. The window opens on the first request and expires on schedule —
 * hammering it does not extend it, so an abuser and a shopper who happen to
 * share a carrier address both get their allowance back at the same moment.
 */
export function consume(key: string, budget: RequestBudget, now: number): BudgetDecision {
  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    if (windows.size >= MAX_TRACKED) sweep(now);
    windows.set(key, { count: 1, resetAt: now + budget.windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  current.count += 1;
  if (current.count <= budget.limit) return { allowed: true, retryAfterSeconds: 0 };
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
}

/**
 * Gate a route on the caller's budget. Returns a 429 the caller must return
 * as-is, or null to carry on:
 *
 *   const limited = rateLimit(request, DYNAMIC_SPEECH);
 *   if (limited) return limited;
 *
 * Put it above everything else in the handler, including reading the body:
 * there is no sense buffering ten megabytes of audio for a caller that is about
 * to be turned away.
 */
export function rateLimit(request: Request, budget: RequestBudget): NextResponse | null {
  const ip = getClientIp(request.headers);
  // No forwarded address means we are not behind the platform proxy at all —
  // local dev, or a test. Pooling those under one shared "unknown" key would
  // mean that the day Vercel changes which header it sets, every shopper in the
  // world lands in the same bucket and the advisor goes quiet for all of them
  // at once. Not limiting a request that in production always has an address is
  // the smaller of the two failures.
  if (!ip) return null;

  const decision = consume(`${budget.name}:${ip}`, budget, Date.now());
  if (decision.allowed) return null;

  return NextResponse.json(
    { error: "Too many requests. Please slow down and try again in a moment." },
    {
      status: 429,
      headers: {
        "retry-after": String(decision.retryAfterSeconds),
        // The scripted lines are handed to the CDN as immutable, so a refusal
        // stored against one of those URLs would mute that line for everyone
        // behind the same point of presence for a year.
        "cache-control": "no-store",
      },
    },
  );
}
