import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { advisorHostEntries, isAdvisorHost, tenantSlugForHost } from "../src/lib/advisor-hosts";

/**
 * The voice advisor never resolved a merchant. `mountVoice` dropped
 * `data-tenant`, `/advisor` took no tenant, and `VoiceAgent` posted no
 * `tenantSlug` — so `/api/voice-agent` fell back to its zod default, the seed
 * tenant, for every consultation ever held. Once the launcher started
 * defaulting to voice, that meant a bubble on a merchant's storefront
 * recommending the seed catalogue: products the shop does not sell.
 *
 * The chain now has four links — snippet, frame URL, page, request body — and
 * a hostname that overrides all of them. These tests pin each link, because
 * the failure mode is not an error anywhere: it is a plausible routine built
 * from the wrong shelf.
 */

const original = process.env.ADVISOR_HOSTS;
afterEach(() => {
  if (original === undefined) delete process.env.ADVISOR_HOSTS;
  else process.env.ADVISOR_HOSTS = original;
});

describe("reading ADVISOR_HOSTS", () => {
  it("maps a host to the merchant it serves", () => {
    process.env.ADVISOR_HOSTS = "advisor.cicabelle.com=cicabelle";
    expect(tenantSlugForHost("advisor.cicabelle.com")).toBe("cicabelle");
  });

  it("still accepts the bare-host form the variable used to hold", () => {
    // This shipped before a host could name a merchant. It must keep marking
    // the host as an advisor host — otherwise upgrading silently republishes
    // our marketing site and admin login on a merchant's subdomain.
    process.env.ADVISOR_HOSTS = "advisor.cicabelle.com";
    expect(isAdvisorHost("advisor.cicabelle.com")).toBe(true);
    expect(tenantSlugForHost("advisor.cicabelle.com")).toBeNull();
  });

  it("reads a mixed list, and keeps guarding a host that names a merchant", () => {
    process.env.ADVISOR_HOSTS = "advisor.cicabelle.com=cicabelle, advisor.other.com";
    expect(isAdvisorHost("advisor.cicabelle.com")).toBe(true);
    expect(isAdvisorHost("advisor.other.com")).toBe(true);
    expect(tenantSlugForHost("advisor.cicabelle.com")).toBe("cicabelle");
    expect(tenantSlugForHost("advisor.other.com")).toBeNull();
    expect(advisorHostEntries()).toHaveLength(2);
  });

  it("ignores case and the port, as the Host header carries both", () => {
    process.env.ADVISOR_HOSTS = "ADVISOR.Cicabelle.com=Cicabelle";
    expect(tenantSlugForHost("advisor.cicabelle.com:443")).toBe("cicabelle");
  });

  it("pins nothing to a host that is not in the list", () => {
    process.env.ADVISOR_HOSTS = "advisor.cicabelle.com=cicabelle";
    expect(tenantSlugForHost("idermaguru.com")).toBeNull();
    expect(tenantSlugForHost(null)).toBeNull();
  });

  it("pins nothing when the variable is unset", () => {
    // The shared origin serves every merchant's bubble, so there is no one
    // merchant to name — the embed has to say.
    delete process.env.ADVISOR_HOSTS;
    expect(tenantSlugForHost("advisor.cicabelle.com")).toBeNull();
    expect(isAdvisorHost("advisor.cicabelle.com")).toBe(true);
  });
});

/**
 * Asserted against the shipped sources: these four files are a single chain,
 * and every previous break in it was one link quietly not passing the value on
 * rather than any of them throwing.
 */
const widget = readFileSync(new URL("../public/dermaguru-widget.js", import.meta.url), "utf8");
const advisorPage = readFileSync(new URL("../src/app/advisor/page.tsx", import.meta.url), "utf8");
const agent = readFileSync(new URL("../src/components/voice-agent.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../src/app/api/voice-agent/route.ts", import.meta.url), "utf8");

describe("the tenant reaches the advisor from the snippet", () => {
  it("the launcher forwards data-tenant into the frame's URL", () => {
    expect(widget).toMatch(/tenant:\s*tenant/);
    expect(widget).toMatch(/cfg\.tenant\s*\?\s*"&tenant="\s*\+\s*encodeURIComponent\(cfg\.tenant\)/);
  });

  it("the advisor page reads it, and prefers the hostname over it", () => {
    expect(advisorPage).toContain("tenantSlugForRequestHost");
    // Host first: `?tenant=` is only consulted when no host names a merchant.
    expect(advisorPage).toMatch(/tenantSlugForRequestHost\(.*\)\)\s*\?\?\s*asSlug\(params\.tenant\)/);
  });

  it("the page passes it to the advisor component", () => {
    // [^>]* already spans newlines; no dotAll flag needed (and the tsconfig
    // target does not allow one).
    expect(advisorPage).toMatch(/<VoiceAgent[^>]*tenantSlug=\{tenantSlug\}/);
  });

  it("the component sends it with the turn", () => {
    expect(agent).toMatch(/tenantSlug\?\:\s*string/);
    expect(agent).toMatch(/\.\.\.\(tenantSlug \? \{ tenantSlug \} : \{\}\)/);
  });
});

describe("what the server trusts", () => {
  it("lets a merchant's own hostname overrule the request body", () => {
    // The body came from a page whose HTML a shopper can edit. A merchant who
    // has pointed DNS at us must not be one devtools change away from having
    // their advisor recommend a competitor's shelf.
    expect(route).toContain("await tenantSlugForRequestHost(request.headers.get(\"host\"))");
    expect(route).toMatch(/pinned \? \{ \.\.\.parsed, tenantSlug: pinned \} : parsed/);
  });

  it("rejects a junk slug from the query string on shape", () => {
    const guard = advisorPage.slice(advisorPage.indexOf("function asSlug"));
    expect(guard).toMatch(/\^\[a-z0-9\]\[a-z0-9-\]\{0,63\}\$/);
  });
});

describe("the shape guard on the query string", () => {
  // Exercised directly: the page itself needs a request to run, but the rule
  // it applies is the part worth pinning.
  const asSlug = (value: string | undefined): string | undefined => {
    const slug = value?.trim().toLowerCase();
    return slug && /^[a-z0-9][a-z0-9-]{0,63}$/.test(slug) ? slug : undefined;
  };

  it("accepts the slugs merchants actually have", () => {
    expect(asSlug("cicabelle")).toBe("cicabelle");
    expect(asSlug("ai-derma-guru")).toBe("ai-derma-guru");
    expect(asSlug("  Cicabelle  ")).toBe("cicabelle");
  });

  it("drops anything that is not one", () => {
    for (const junk of ["", "  ", "-leading", "has space", "semi;colon", "sl/ash", "a".repeat(65), undefined]) {
      expect(asSlug(junk), `${JSON.stringify(junk)} should not pass`).toBeUndefined();
    }
  });
});
