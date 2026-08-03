import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { requireSuperAdmin } from "@/lib/admin-guard";

export const runtime = "nodejs";

/**
 * Opens the Stripe Customer Portal so a merchant can manage their subscription
 * (update card, change plan, cancel).
 *
 * POST body: { customerId: string }  (the Stripe customer id, cus_...)
 * Response:  { url: string }
 *
 * Super-admin only. This route used to open a portal session for whatever
 * customer the body named, with no session at all — and a cus_... id is not a
 * secret, it is printed on Stripe receipts and invoice PDFs. Anyone holding one
 * could read a merchant's card details and cancel their plan.
 *
 * The id still comes from the body because nothing on our side maps a merchant
 * to their Stripe customer yet: the webhook's checkout.session.completed branch
 * that would record it is still a TODO. Resolve it from the session instead of
 * the body as soon as that mapping exists — see docs/SECURITY-AUDIT.md.
 */
export async function POST(req: NextRequest) {
  const session = await requireSuperAdmin();
  if (session instanceof NextResponse) return session;

  try {
    const { customerId } = (await req.json()) as { customerId?: string };
    if (!customerId) {
      return NextResponse.json({ error: "Missing customerId." }, { status: 400 });
    }

    const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin).replace(/\/$/, "");
    const stripe = getStripe();

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${baseUrl}/`,
    });

    return NextResponse.json({ url: portalSession.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not open billing portal.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
