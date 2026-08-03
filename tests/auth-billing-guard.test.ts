import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createAdminSession, getAdminSessionCookieName } from "@/lib/admin-auth";

/**
 * Two ways a stranger could act through this deployment without ever holding a
 * session:
 *
 *  - /auth/callback took its post-login destination from a `next` query
 *    parameter and fed it straight to `new URL(next, origin)`. That call honours
 *    an absolute value and resolves it against the *value's* origin, so
 *    /auth/callback?next=https://evil.example was a redirector wearing our
 *    domain — mailed out, it reads as an idermaguru.com login link.
 *  - /api/billing/portal opened a Stripe Customer Portal for whatever cus_... id
 *    the body named, and /api/billing/checkout minted live Checkout Sessions,
 *    both with no session check at all.
 *
 * These tests pin the guards: the callback only ever lands inside this site, and
 * neither billing route reaches Stripe for an unauthenticated caller.
 */

const cookieJar = new Map<string, string>();
const exchangeCodeForSession = vi.fn();
const createPortalSession = vi.fn();
const createCheckoutSession = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined),
    getAll: () => [...cookieJar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => cookieJar.set(name, value),
  }),
}));

// The code exchange itself is Supabase's business; what is on trial here is
// where the handler sends the browser once it returns.
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { exchangeCodeForSession } }),
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    billingPortal: { sessions: { create: createPortalSession } },
    checkout: { sessions: { create: createCheckoutSession } },
  }),
}));

const { GET: authCallback } = await import("../src/app/auth/callback/route");
const { POST: billingPortal } = await import("../src/app/api/billing/portal/route");
const { POST: billingCheckout } = await import("../src/app/api/billing/checkout/route");

const SITE = "https://idermaguru.com";

const callback = (params: Record<string, string>) =>
  authCallback(new Request(`${SITE}/auth/callback?${new URLSearchParams(params)}`));

const postJson = (
  handler: (req: NextRequest) => Promise<Response>,
  path: string,
  body: unknown,
) =>
  handler(
    new NextRequest(`${SITE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

async function signIn(role: "merchant" | "super_admin") {
  cookieJar.set(getAdminSessionCookieName(), await createAdminSession("jordan.fahad@gmail.com", role));
}

afterEach(() => {
  cookieJar.clear();
  exchangeCodeForSession.mockReset();
  createPortalSession.mockReset();
  createCheckoutSession.mockReset();
});

describe("the magic-link callback can only land inside this site", () => {
  /**
   * Every one of these resolves to evil.example when handed to
   * `new URL(value, "https://idermaguru.com")`. The last two are the ones a
   * naive "must start with / and not //" check misses: for an http(s) URL the
   * parser reads "\" as "/", and it strips tab, newline and carriage return
   * anywhere in the string before it parses, so "/<tab>/evil.example" arrives
   * as "//evil.example".
   */
  const hostile = [
    "https://evil.example",
    "http://evil.example/steal",
    "//evil.example",
    "//evil.example/dashboard",
    "/\\evil.example",
    "/\t/evil.example",
  ];

  it.each(hostile)("sends ?next=%j to the dashboard rather than off-site", async (next) => {
    const response = await callback({ next });
    expect(response.headers.get("location")).toBe(`${SITE}/dashboard`);
  });

  it("refuses a scheme that is not a path at all", async () => {
    const response = await callback({ next: "javascript:alert(document.domain)" });
    expect(response.headers.get("location")).toBe(`${SITE}/dashboard`);
  });

  it("still honours the real in-site destinations the login flow uses", async () => {
    // src/components/quiet-luxe-login.tsx sends ?next=/dashboard; the admin
    // middleware sends ?next=<pathname> for any page behind /admin.
    for (const [next, expected] of [
      ["/dashboard", `${SITE}/dashboard`],
      ["/admin/merchants", `${SITE}/admin/merchants`],
      ["/dashboard?merchant=cicabelle", `${SITE}/dashboard?merchant=cicabelle`],
    ]) {
      const response = await callback({ next });
      expect(response.headers.get("location")).toBe(expected);
    }
  });

  it("guards the branch that actually exchanges the code, not just the early return", async () => {
    // The early "no code" return and the post-exchange return are two separate
    // redirects; a guard applied to only one of them still leaks through the
    // other, which is the path a real magic link takes.
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
    try {
      const response = await callback({ code: "otp-code", next: "https://evil.example" });
      expect(exchangeCodeForSession).toHaveBeenCalledWith("otp-code");
      expect(response.headers.get("location")).toBe(`${SITE}/dashboard`);
    } finally {
      if (supabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = supabaseUrl;
      if (supabaseKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = supabaseKey;
    }
  });
});

describe("billing routes answer nobody without a super-admin session", () => {
  it("will not open a Stripe portal for a customer id posted by a stranger", async () => {
    // A cus_... is not a secret — it is printed on every Stripe receipt and
    // invoice PDF. Unauthenticated, knowing one was enough to read a merchant's
    // card details and cancel their plan.
    const response = await postJson(billingPortal, "/api/billing/portal", { customerId: "cus_realmerchant" });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Super-admin login required." });
    expect(createPortalSession).not.toHaveBeenCalled();
  });

  it("will not mint a checkout session for a stranger", async () => {
    const response = await postJson(billingCheckout, "/api/billing/checkout", { planId: "growth" });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Super-admin login required." });
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it("turns away a signed-in merchant too, since billing is administered by us", async () => {
    await signIn("merchant");
    const portal = await postJson(billingPortal, "/api/billing/portal", { customerId: "cus_someoneelse" });
    const checkout = await postJson(billingCheckout, "/api/billing/checkout", { planId: "growth" });
    expect(portal.status).toBe(401);
    expect(checkout.status).toBe(401);
    expect(createPortalSession).not.toHaveBeenCalled();
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it("lets a super-admin through, so the gate is what fails and not Stripe", async () => {
    await signIn("super_admin");
    createPortalSession.mockResolvedValue({ url: "https://billing.stripe.test/session" });
    createCheckoutSession.mockResolvedValue({ url: "https://checkout.stripe.test/c/pay" });

    const portal = await postJson(billingPortal, "/api/billing/portal", { customerId: "cus_realmerchant" });
    expect(portal.status).toBe(200);
    expect(await portal.json()).toEqual({ url: "https://billing.stripe.test/session" });
    expect(createPortalSession).toHaveBeenCalledWith({
      customer: "cus_realmerchant",
      return_url: `${SITE}/`,
    });

    const checkout = await postJson(billingCheckout, "/api/billing/checkout", { planId: "growth" });
    expect(checkout.status).toBe(200);
    expect(await checkout.json()).toEqual({ url: "https://checkout.stripe.test/c/pay" });
    expect(createCheckoutSession.mock.calls[0][0].metadata).toEqual({ planId: "growth" });
  });
});
