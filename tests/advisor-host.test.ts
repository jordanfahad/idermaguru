import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { isAdvisorHost, proxy } from "../src/proxy";

/**
 * A merchant points advisor.theirstore.com at this deployment so the microphone
 * prompt says their name rather than ours. Two things have to be true for that
 * to be safe, and neither was:
 *
 *  - the root of that host must be the advisor, not DermaGuru's marketing site
 *  - nothing else of ours may be reachable on the merchant's brand, least of
 *    all the admin login
 */

const original = process.env.ADVISOR_HOSTS;
afterEach(() => {
  if (original === undefined) delete process.env.ADVISOR_HOSTS;
  else process.env.ADVISOR_HOSTS = original;
});

const get = (host: string, path: string) =>
  proxy(new NextRequest(`https://${host}${path}`, { headers: { host } }));

const post = (host: string, path: string) =>
  proxy(new NextRequest(`https://${host}${path}`, { method: "POST", headers: { host } }));

describe("recognising an advisor host", () => {
  it("takes any advisor.* subdomain by default", () => {
    expect(isAdvisorHost("advisor.cicabelle.com")).toBe(true);
    expect(isAdvisorHost("ADVISOR.Cicabelle.com")).toBe(true);
    expect(isAdvisorHost("advisor.cicabelle.com:443")).toBe(true);
  });

  it("leaves our own domains alone", () => {
    expect(isAdvisorHost("idermaguru.com")).toBe(false);
    expect(isAdvisorHost("www.idermaguru.com")).toBe(false);
    expect(isAdvisorHost("localhost:3000")).toBe(false);
    expect(isAdvisorHost(null)).toBe(false);
    // and does not match a host that merely contains the word
    expect(isAdvisorHost("skin-advisor.example.com")).toBe(false);
  });

  it("honours an explicit list when one is set", () => {
    process.env.ADVISOR_HOSTS = "advisor.cicabelle.com, talk.otherstore.com";
    expect(isAdvisorHost("talk.otherstore.com")).toBe(true);
    expect(isAdvisorHost("advisor.someone-else.com")).toBe(false);
  });
});

describe("what an advisor host serves", () => {
  it("serves the advisor at the root, without changing the URL", async () => {
    const response = await get("advisor.cicabelle.com", "/");
    // A rewrite, not a redirect: the shopper stays on advisor.cicabelle.com.
    expect(response?.status).toBe(200);
    expect(response?.headers.get("x-middleware-rewrite")).toMatch(/\/advisor$/);
  });

  it("keeps the admin off the merchant's brand", async () => {
    for (const path of ["/admin", "/admin/login", "/dashboard", "/pricing", "/login"]) {
      const response = await get("advisor.cicabelle.com", path);
      expect(response?.status).toBe(307);
      expect(new URL(response!.headers.get("location")!).pathname).toBe("/");
    }
  });

  it("lets through what the advisor actually needs", async () => {
    for (const path of ["/advisor", "/api/voice-agent", "/privacy-policy", "/terms-of-use"]) {
      const response = await get("advisor.cicabelle.com", path);
      expect(response?.headers.get("location")).toBeNull();
    }
  });

  it("changes nothing on our own domain", async () => {
    const home = await get("idermaguru.com", "/");
    expect(home?.headers.get("location")).toBeNull();
    expect(home?.headers.get("x-middleware-rewrite")).toBeNull();

    // the admin guard still applies there, unauthenticated
    const admin = await get("idermaguru.com", "/admin");
    expect(new URL(admin!.headers.get("location")!).pathname).toBe("/admin/login");
  });
});

/**
 * The page guard above was only half the job. The allow-list also carried a
 * blanket "/api/", so pointing DNS at us published the entire API plane on the
 * merchant's brand — including a login endpoint that guesses one hardcoded
 * address forever, and billing and Shopify routes that take no session at all.
 */
describe("the API an advisor host answers", () => {
  const HOST = "advisor.cicabelle.com";

  beforeEach(() => {
    // The subdomain is meant to run with an explicit list — docs/EMBED.md step 4.
    process.env.ADVISOR_HOSTS = HOST;
  });

  it("does not serve the admin, billing or Shopify APIs on the merchant's brand", async () => {
    for (const path of [
      "/api/admin/auth/login",
      "/api/admin/auth/logout",
      "/api/admin/products",
      "/api/admin/merchants",
      "/api/admin/analytics",
      "/api/billing/portal",
      "/api/billing/checkout",
      "/api/billing/webhook",
      "/api/shopify/install",
      "/api/shopify/callback",
      "/api/shopify/sync",
      "/api/live-consultations",
      "/api/session/export",
    ]) {
      const response = await get(HOST, path);
      expect(response?.status).toBe(404);
    }
  });

  it("refuses a posted login outright instead of redirecting it", async () => {
    // A 307 preserves the method and the body, so redirecting a POST to "/"
    // hands the credentials on to be replayed rather than stopping them, and
    // admits the endpoint exists somewhere. Nothing to follow: 404.
    const response = await post(HOST, "/api/admin/auth/login");
    expect(response?.status).toBe(404);
    expect(response?.headers.get("location")).toBeNull();
  });

  it("serves every endpoint the advisor and the widget actually call", async () => {
    // Read off the fetches in src/components/voice-agent.tsx and
    // public/dermaguru-widget.js. Blocking any one of these takes the live
    // advisor down on the merchant's own domain.
    for (const path of [
      "/api/voice-agent",
      "/api/voice-agent/transcribe",
      "/api/voice-agent/speech",
      "/api/voice-agent/vision",
      "/api/voice-agent/client-log",
      "/api/cart/cicabelle",
      "/api/chat/start",
      "/api/chat/message",
      "/api/recommendations",
      "/api/events/impression",
      "/api/events/click",
      "/api/events/add-to-cart",
      "/api/widget/config",
    ]) {
      const response = await get(HOST, path);
      expect(response?.status).toBe(200);
      expect(response?.headers.get("location")).toBeNull();
    }
  });

  it("still preflights the widget endpoints it allows", async () => {
    // The CORS branch sits after the advisor guard, so a path the guard drops
    // never gets its preflight answered — the widget would fail silently on
    // a store that loads the script from its own subdomain.
    const response = await proxy(
      new NextRequest(`https://${HOST}/api/chat/start`, { method: "OPTIONS", headers: { host: HOST } }),
    );
    expect(response?.status).toBe(204);
    expect(response?.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("matches whole path segments, so a lookalike route inherits nothing", async () => {
    for (const path of ["/api/voice-agent-admin", "/api/chat-internal", "/api/cartography", "/api/eventsource"]) {
      const response = await get(HOST, path);
      expect(response?.status).toBe(404);
    }
  });

  it("leaves the API plane whole on our own domain", async () => {
    // The block belongs to the merchant's host, not to the routes themselves.
    for (const path of ["/api/billing/portal", "/api/shopify/install"]) {
      const response = await get("idermaguru.com", path);
      expect(response?.status).toBe(200);
      expect(response?.headers.get("location")).toBeNull();
    }
    const login = await post("idermaguru.com", "/api/admin/auth/login");
    expect(login?.status).toBe(200);
  });
});
