import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { getPlan, getStripeLineItem } from "@/lib/plans";
import { requireSuperAdmin } from "@/lib/admin-guard";

export const runtime = "nodejs";

/**
 * Creates a Stripe Checkout Session for a subscription plan and returns its URL.
 *
 * POST body: { planId: "starter" | "growth" | "pro", email?: string }
 * Response:  { url: string }   -> redirect the browser to this URL.
 *
 * Super-admin only, like the portal beside it. Ungated, this was a free hand on
 * our Stripe account: every POST mints a live Checkout Session, so it could be
 * hammered to bury real signups in abandoned sessions, and the attacker chose
 * both the plan and the customer_email the receipt would go to.
 *
 * Onboarding runs through us today, so the gate costs nothing. Self-serve
 * signup from the public pricing page needs its own path — an unauthenticated
 * caller now gets a 401 there, and re-opening it means rate limiting and origin
 * checks, not removing this.
 */
export async function POST(req: NextRequest) {
  const session = await requireSuperAdmin();
  if (session instanceof NextResponse) return session;

  try {
    const { planId, email } = (await req.json()) as { planId?: string; email?: string };
    const plan = getPlan(String(planId ?? ""));
    if (!plan) {
      return NextResponse.json({ error: "Unknown plan." }, { status: 400 });
    }

    const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin).replace(/\/$/, "");
    const stripe = getStripe();

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [getStripeLineItem(plan)],
      customer_email: email || undefined,
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      success_url: `${baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/#pricing`,
      metadata: { planId: plan.id },
      subscription_data: { metadata: { planId: plan.id } },
    });

    return NextResponse.json({ url: checkoutSession.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start checkout.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
