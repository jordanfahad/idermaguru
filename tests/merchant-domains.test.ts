import { afterEach, describe, expect, it, vi } from "vitest";
import { dnsInstructionFor, vercelConfig } from "@/lib/vercel-domains";

/**
 * Connecting a domain from the merchant console.
 *
 * The reason this exists at all: ADVISOR_HOSTS works for one merchant and
 * cannot work for the product. A merchant cannot edit a deployment's
 * environment variables, and every new domain would need a redeploy before it
 * resolved to anybody. So the mapping moves into a table the console can write.
 *
 * The environment variable is kept, and still WINS, because it is set by
 * whoever operates the deployment rather than by someone typing into a form.
 */

const originalEnv = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe("the DNS record a merchant is shown", () => {
  it("gives a subdomain a CNAME", () => {
    expect(dnsInstructionFor("advisor.cicabelle.com")).toEqual({
      type: "CNAME",
      name: "advisor",
      value: "cname.vercel-dns.com",
    });
  });

  it("gives an apex domain an A record, because a CNAME there is illegal", () => {
    // RFC 1034: an apex carries SOA and NS, and a CNAME cannot coexist with
    // them. Some registrars accept it anyway and quietly break the domain's
    // mail, which is a bad afternoon to hand somebody.
    expect(dnsInstructionFor("cicabelle.com")).toEqual({
      type: "A",
      name: "@",
      value: "76.76.21.21",
    });
  });

  it("treats a deeper name as a subdomain", () => {
    expect(dnsInstructionFor("skin.advisor.cicabelle.com").type).toBe("CNAME");
    expect(dnsInstructionFor("skin.advisor.cicabelle.com").name).toBe("skin");
  });
});

describe("whether the feature is switched on", () => {
  it("is unconfigured until both the token and the project are set", () => {
    delete process.env.VERCEL_API_TOKEN;
    delete process.env.VERCEL_PROJECT_ID;
    expect(vercelConfig()).toBeNull();

    process.env.VERCEL_API_TOKEN = "tok";
    expect(vercelConfig(), "a token alone is not enough").toBeNull();

    process.env.VERCEL_PROJECT_ID = "prj_1";
    expect(vercelConfig()).toMatchObject({ token: "tok", projectId: "prj_1" });
  });

  it("carries the team when one is set, and omits it otherwise", () => {
    process.env.VERCEL_API_TOKEN = "tok";
    process.env.VERCEL_PROJECT_ID = "prj_1";
    delete process.env.VERCEL_TEAM_ID;
    expect(vercelConfig()).not.toHaveProperty("teamId");

    process.env.VERCEL_TEAM_ID = "team_1";
    expect(vercelConfig()).toMatchObject({ teamId: "team_1" });
  });
});

describe("what counts as a hostname", () => {
  it("accepts real ones and normalises them", async () => {
    const { asHost } = await import("@/services/merchant-domains");
    expect(asHost("advisor.cicabelle.com")).toBe("advisor.cicabelle.com");
    expect(asHost("  ADVISOR.Cicabelle.COM  ")).toBe("advisor.cicabelle.com");
    // People paste URLs into domain boxes. Taking the host out beats refusing,
    // which reads as the product being broken.
    expect(asHost("https://advisor.cicabelle.com/advisor")).toBe("advisor.cicabelle.com");
    expect(asHost("advisor.cicabelle.com:443")).toBe("advisor.cicabelle.com");
  });

  it("rejects what is not one", async () => {
    const { asHost } = await import("@/services/merchant-domains");
    for (const junk of ["", "   ", "localhost", "no-dot", "-lead.com", "sp ace.com", "a.b", null, undefined]) {
      expect(asHost(junk), `${JSON.stringify(junk)} should not pass`).toBeNull();
    }
  });
});

describe("resolving a request's host to a merchant", () => {
  it("lets ADVISOR_HOSTS overrule the database", async () => {
    // The variable is set by whoever runs the deployment; a row is set by
    // whoever filled in a form. The stronger claim wins, and it also keeps
    // working with no database at all.
    process.env.ADVISOR_HOSTS = "advisor.cicabelle.com=ai-derma-guru";
    vi.doMock("@/server/db", () => ({ getPrisma: () => null }));

    const { tenantSlugForRequestHost } = await import("@/services/merchant-domains");
    expect(await tenantSlugForRequestHost("advisor.cicabelle.com")).toBe("ai-derma-guru");
  });

  it("falls back to a VERIFIED row", async () => {
    delete process.env.ADVISOR_HOSTS;
    const findFirst = vi.fn().mockResolvedValue({ tenant: { slug: "cicabelle" } });
    vi.doMock("@/server/db", () => ({ getPrisma: () => ({ merchantDomain: { findFirst } }) }));

    const { tenantSlugForRequestHost } = await import("@/services/merchant-domains");
    expect(await tenantSlugForRequestHost("advisor.cicabelle.com")).toBe("cicabelle");
    expect(findFirst.mock.calls[0][0].where).toMatchObject({
      host: "advisor.cicabelle.com",
      // A pending row is a hostname somebody typed. Honouring it would let one
      // merchant claim a host they do not control and answer on it the moment
      // they did.
      status: "VERIFIED",
    });
  });

  it("resolves nobody when the database cannot answer", async () => {
    delete process.env.ADVISOR_HOSTS;
    vi.doMock("@/server/db", () => ({
      getPrisma: () => ({ merchantDomain: { findFirst: vi.fn().mockRejectedValue(new Error("down")) } }),
    }));

    const { tenantSlugForRequestHost } = await import("@/services/merchant-domains");
    expect(await tenantSlugForRequestHost("advisor.cicabelle.com")).toBeNull();
  });

  it("resolves nobody for a host with no claim on it", async () => {
    delete process.env.ADVISOR_HOSTS;
    vi.doMock("@/server/db", () => ({
      getPrisma: () => ({ merchantDomain: { findFirst: vi.fn().mockResolvedValue(null) } }),
    }));

    const { tenantSlugForRequestHost } = await import("@/services/merchant-domains");
    expect(await tenantSlugForRequestHost("advisor.someoneelse.com")).toBeNull();
    expect(await tenantSlugForRequestHost(null)).toBeNull();
  });
});

describe("connecting a domain", () => {
  it("refuses a host another store already holds, without naming them", async () => {
    vi.doMock("@/server/db", () => ({
      getPrisma: () => ({
        merchantDomain: { findUnique: vi.fn().mockResolvedValue({ tenantId: "tenant_someone_else" }) },
      }),
    }));

    const { connectDomain } = await import("@/services/merchant-domains");
    const outcome = await connectDomain("tenant_mine", "advisor.cicabelle.com");

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.error).toBe("That domain is already connected to another store.");
    expect(outcome.ok === false && outcome.error).not.toContain("tenant_someone_else");
  });

  it("says so plainly when the integration has no token", async () => {
    delete process.env.VERCEL_API_TOKEN;
    delete process.env.VERCEL_PROJECT_ID;
    vi.doMock("@/server/db", () => ({
      getPrisma: () => ({ merchantDomain: { findUnique: vi.fn().mockResolvedValue(null) } }),
    }));

    const { connectDomain } = await import("@/services/merchant-domains");
    const outcome = await connectDomain("tenant_mine", "advisor.cicabelle.com");

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.error).toMatch(/VERCEL_API_TOKEN/);
  });

  it("rejects a domain that is not one before calling anybody", async () => {
    const findUnique = vi.fn();
    vi.doMock("@/server/db", () => ({ getPrisma: () => ({ merchantDomain: { findUnique } }) }));

    const { connectDomain } = await import("@/services/merchant-domains");
    const outcome = await connectDomain("tenant_mine", "not a domain");

    expect(outcome.ok).toBe(false);
    expect(findUnique).not.toHaveBeenCalled();
  });
});
