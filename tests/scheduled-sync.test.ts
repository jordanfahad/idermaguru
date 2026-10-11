import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/cron/shopify-sync/route";

/**
 * The catalogue syncing on a schedule rather than when somebody remembers.
 *
 * It was a button in the dashboard, so the catalogue was only ever as fresh as
 * the last press — five weeks, in the case that prompted this. A catalogue
 * that old recommends products that have sold out at prices that have moved,
 * and nothing about it looks broken from the outside.
 *
 * Most of what matters here is who is allowed to start it. A session cannot
 * authorise a scheduled request — there are no cookies in one — so the door is
 * a shared secret, and this endpoint rewrites the catalogue every shopper is
 * recommended from.
 */

const route = readFileSync(new URL("../src/app/api/cron/shopify-sync/route.ts", import.meta.url), "utf8");
const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));

function call(headers: Record<string, string> = {}) {
  return GET(new Request("http://localhost/api/cron/shopify-sync", { headers })).then(async (response) => ({
    status: response.status,
    body: await response.json().catch(() => null),
  }));
}

describe("who may start a scheduled sync", () => {
  const original = process.env.CRON_SECRET;
  const restore = () => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  };

  it("refuses when no secret is configured", async () => {
    // Fails CLOSED. The alternative is an unauthenticated endpoint that
    // rewrites the catalogue, reachable by anyone who guesses the path — and
    // a missing environment variable is exactly how that happens by accident.
    delete process.env.CRON_SECRET;
    const result = await call({ authorization: "Bearer anything" });
    expect(result.status).toBe(503);
    restore();
  });

  it("refuses a request with no authorization at all", async () => {
    process.env.CRON_SECRET = "s3cret-value";
    expect((await call()).status).toBe(401);
    restore();
  });

  it("refuses a wrong secret, and one of a different length", async () => {
    process.env.CRON_SECRET = "s3cret-value";
    expect((await call({ authorization: "Bearer wrong-value" })).status).toBe(401);
    expect((await call({ authorization: "Bearer short" })).status).toBe(401);
    restore();
  });

  it("refuses the secret without the Bearer scheme", async () => {
    process.env.CRON_SECRET = "s3cret-value";
    expect((await call({ authorization: "s3cret-value" })).status).toBe(401);
    restore();
  });

  it("compares in constant time rather than with ===", async () => {
    expect(route).toMatch(/timingSafeEqual\(header\.slice\(prefix\.length\), secret\)/);
    expect(route).not.toMatch(/header === `Bearer \$\{secret\}`/);
  });
});

describe("one store's bad day", () => {
  it("does not stop the others", async () => {
    // A shop whose token has been revoked would otherwise take every other
    // merchant's catalogue down with it, silently, on a schedule.
    expect(route).toMatch(/for \(const connection of[\s\S]{0,120}try \{/);
    expect(route).toMatch(/\} catch \(caught\) \{/);
    expect(route).toMatch(/results\.push\(\{ shop: connection\.shop_domain, error: reason \}\)/);
    // And the catch itself keeps going rather than returning out of the loop,
    // which would end the whole run on the first bad store.
    const start = route.indexOf("} catch (caught) {");
    const end = route.indexOf("error: reason });", start);
    expect(route.slice(start, end), "a return here would end the run").not.toMatch(/\breturn\b/);
  });

  it("says in the log what it did, because nobody is watching", () => {
    expect(route).toMatch(/\[cron-sync\][\s\S]{0,160}retired=/);
  });
});

describe("the schedule itself", () => {
  it("is registered with the platform", () => {
    const cron = (vercel.crons ?? []).find((entry: { path: string }) => entry.path === "/api/cron/shopify-sync");
    expect(cron, "no cron entry — the route would never run").toBeTruthy();
    expect(cron.schedule).toBe("0 */6 * * *");
  });

  it("allows more time than the dashboard button", () => {
    // 60s is enough for one store from a browser. This walks every connected
    // shop in one request.
    expect(route).toMatch(/maxDuration = 300/);
  });
});
