import { afterEach, describe, expect, it } from "vitest";
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
