import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { getPlan, getStripeLineItem } from "@/lib/plans";

export const runtime = "nodejs";

/**
 * Creates a Stripe Checkout Session for a subscription plan and returns its URL.
 *
 * POST body: { planId: "starter" | "growth" | "pro", email?: string }
 * Response:  { url: string }   -> redirect the browser to this URL.
 */
export async function POST(req: NextRequest) {
  try {
    const { planId, email } = (await req.json()) as { planId?: string; email?: string };
    const plan = getPlan(String(planId ?? ""));
    if (!plan) {
      return NextResponse.json({ error: "Unknown plan." }, { status: 400 });
    }

    const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin).replace(/\/$/, "");
    const stripe = getStripe();

    const session = await stripe.checkout.sessions.create({
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

    return NextResponse.json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start checkout.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
