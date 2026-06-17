import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe, getStripeWebhookSecret } from "@/lib/stripe";

export const runtime = "nodejs";

/**
 * Stripe webhook receiver. Verifies the signature against STRIPE_WEBHOOK_SECRET,
 * then reacts to subscription lifecycle events.
 *
 * Set up the endpoint in Stripe Dashboard -> Developers -> Webhooks:
 *   URL:    https://idermaguru.com/api/billing/webhook
 *   Events: checkout.session.completed, customer.subscription.created,
 *           customer.subscription.updated, customer.subscription.deleted,
 *           invoice.paid, invoice.payment_failed
 * Then copy the signing secret (whsec_...) into STRIPE_WEBHOOK_SECRET.
 */
export async function POST(req: NextRequest) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header." }, { status: 400 });
  }

  const stripe = getStripe();
  const rawBody = await req.text(); // raw body required for signature verification

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, getStripeWebhookSecret());
  } catch {
    return NextResponse.json({ error: "Webhook signature verification failed." }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      // TODO: mark the merchant (session.customer / session.customer_email) as subscribed
      // to session.metadata?.planId in Supabase, and provision their widget API key.
      void session;
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      // TODO: upsert subscription status (active / past_due / canceled) + plan in Supabase.
      void subscription;
      break;
    }
    case "invoice.payment_failed": {
      // TODO: notify the merchant and/or pause their widget access.
      break;
    }
    default:
      break;
  }

  return NextResponse.json({ received: true });
}
