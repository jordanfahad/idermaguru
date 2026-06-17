import Stripe from "stripe";

/**
 * Server-only Stripe client.
 *
 * The secret key is read from process.env at call time and is NEVER hard-coded.
 * Add the (rolled) secret key to `.env.local` for local dev and to your Vercel
 * project's Environment Variables for production:
 *
 *   STRIPE_SECRET_KEY=sk_live_...        (server only — never expose to the browser)
 *   STRIPE_WEBHOOK_SECRET=whsec_...      (from the Stripe webhook endpoint)
 *
 * Do not import this file from client components.
 */
let cached: Stripe | null = null;

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. Add your rolled Stripe secret key to .env.local and Vercel env vars.",
    );
  }
  if (!cached) {
    cached = new Stripe(key, { appInfo: { name: "AI Derma Guru" } });
  }
  return cached;
}

export function getStripeWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not set. Copy it from your Stripe webhook endpoint.");
  }
  return secret;
}
