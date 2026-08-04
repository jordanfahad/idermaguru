import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminSession } from "@/lib/admin-auth";

/**
 * /dashboard shipped as a fully public page. It ran the service-role Supabase
 * client — the one that bypasses row-level security — with no tenant filter, and
 * rendered total outbound clicks and the top 25 products to anyone who typed the
 * URL. It was in the sitemap and allowed by robots.txt, so search engines were
 * being invited to fetch and index it.
 *
 * These tests pin the two halves of that fix: nothing renders without a session,
 * and the page is no longer advertised to crawlers.
 */

let session: AdminSession | null = null;
const findManyEvent = vi.fn();
const countRecommendation = vi.fn();

vi.mock("@/lib/admin-guard", () => ({
  getAdminSession: async () => session,
}));

// Stand in for the tenant-scoped Prisma client so the page's queries can be
// inspected without a database.
vi.mock("@/lib/tenant-context", () => ({
  withTenant: async (
    tenantId: string,
    fn: (tx: unknown) => Promise<unknown>,
  ) =>
    fn({
      event: { findMany: findManyEvent },
      recommendation: { count: countRecommendation },
      tenantId,
    }),
}));

const { default: DashboardPage } = await import("../src/app/dashboard/page");
const { default: sitemap } = await import("../src/app/sitemap");
const { default: robots } = await import("../src/app/robots");

const render = () => DashboardPage({ searchParams: Promise.resolve({}) });

/** The digest Next puts on the error redirect() throws to signal the framework. */
function redirectTarget(error: unknown) {
  const digest = (error as { digest?: string }).digest ?? "";
  return digest.startsWith("NEXT_REDIRECT") ? digest.split(";")[2] : null;
}

afterEach(() => {
  session = null;
  findManyEvent.mockReset();
  countRecommendation.mockReset();
});

describe("the merchant dashboard refuses to render without a session", () => {
  it("redirects a signed-out visitor to the login instead of showing analytics", async () => {
    session = null;
    findManyEvent.mockResolvedValue([]);
    countRecommendation.mockResolvedValue(0);

    const error = await render().then(
      () => null,
      (thrown: unknown) => thrown,
    );

    expect(error).not.toBeNull();
    // /login, not /admin/login. This is the merchant console and the magic
    // link is how a merchant gets in; pointing them at the staff form was a
    // dead end — they hold a Supabase session and no admin credential.
    expect(redirectTarget(error)).toBe("/login?next=/dashboard");
  });

  it("bails out before touching the data plane, so a signed-out hit cannot leak a partial render", async () => {
    session = null;
    findManyEvent.mockResolvedValue([]);
    countRecommendation.mockResolvedValue(0);

    const error = await render().then(
      () => null,
      (thrown: unknown) => thrown,
    );

    expect(redirectTarget(error)).not.toBeNull();
    expect(findManyEvent).not.toHaveBeenCalled();
    expect(countRecommendation).not.toHaveBeenCalled();
  });

  it("renders for a signed-in merchant, scoping both queries to a single tenant", async () => {
    session = { email: "merchant@example.com", role: "merchant", exp: Date.now() };
    findManyEvent.mockResolvedValue([]);
    countRecommendation.mockResolvedValue(4);

    await render();

    expect(findManyEvent).toHaveBeenCalledTimes(1);
    expect(countRecommendation).toHaveBeenCalledTimes(1);

    const clickWhere = findManyEvent.mock.calls[0][0].where;
    expect(clickWhere.tenantId).toBeTruthy();
    expect(clickWhere.type).toBe("PRODUCT_CLICK");
    expect(countRecommendation.mock.calls[0][0].where.tenantId).toBe(clickWhere.tenantId);
  });

  it("ignores a tenant named in the URL by anyone who is not a super-admin", async () => {
    // Merchant sessions carry no tenant of their own yet, so an honoured
    // ?merchant= would be a way to read a competitor's store by guessing its id.
    session = { email: "merchant@example.com", role: "merchant", exp: Date.now() };
    findManyEvent.mockResolvedValue([]);
    countRecommendation.mockResolvedValue(0);

    await DashboardPage({ searchParams: Promise.resolve({ merchant: "tenant_someone_else" }) });

    expect(findManyEvent.mock.calls[0][0].where.tenantId).not.toBe("tenant_someone_else");
  });
});

describe("the dashboard is no longer advertised to crawlers", () => {
  it("is absent from the sitemap", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls.some((url) => url.endsWith("/dashboard"))).toBe(false);
    // The public pages it sits beside are still listed.
    expect(urls.some((url) => url.endsWith("/live-consultation-1"))).toBe(true);
  });

  it("is disallowed in robots.txt", () => {
    const { disallow } = robots().rules as { disallow: string[] };
    expect(disallow).toContain("/dashboard");
    expect(disallow).toContain("/admin");
  });
});
