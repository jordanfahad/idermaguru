import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";

export const runtime = "nodejs";

/**
 * Opens the Stripe Customer Portal so a merchant can manage their subscription
 * (update card, change plan, cancel).
 *
 * POST body: { customerId: string }  (the Stripe customer id, cus_...)
 * Response:  { url: string }
 */
export async function POST(req: NextRequest) {
  try {
    const { customerId } = (await req.json()) as { customerId?: string };
    if (!customerId) {
      return NextResponse.json({ error: "Missing customerId." }, { status: 400 });
    }

    const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin).replace(/\/$/, "");
    const stripe = getStripe();

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${baseUrl}/`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not open billing portal.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
