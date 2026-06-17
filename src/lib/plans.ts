/**
 * Tiered SaaS plans for the embeddable AI Derma Guru consultation widget.
 *
 * Each plan maps to a Stripe Price ID stored in an env var (NOT hard-coded), so
 * you can change pricing in the Stripe Dashboard without touching code. Create a
 * Product + recurring Price for each plan in Stripe, then set:
 *
 *   STRIPE_PRICE_STARTER=price_...
 *   STRIPE_PRICE_GROWTH=price_...
 *   STRIPE_PRICE_PRO=price_...
 *
 * priceLabel is display-only; the real amount is whatever you set on the Stripe Price.
 */
export type PlanId = "starter" | "growth" | "pro";

export type Plan = {
  id: PlanId;
  name: string;
  tagline: string;
  priceLabel: string;
  amountCents: number;
  currency: "usd";
  priceEnv: "STRIPE_PRICE_STARTER" | "STRIPE_PRICE_GROWTH" | "STRIPE_PRICE_PRO";
  features: string[];
  highlighted?: boolean;
};

export const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    tagline: "For a single store getting started.",
    priceLabel: "$29/mo",
    amountCents: 2900,
    currency: "usd",
    priceEnv: "STRIPE_PRICE_STARTER",
    features: [
      "AI skin consultation widget on 1 store",
      "Up to 1,000 consultations / month",
      "Product matching from your catalog",
      "Basic analytics",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    tagline: "For growing brands, creators & SMBs.",
    priceLabel: "$99/mo",
    amountCents: 9900,
    currency: "usd",
    priceEnv: "STRIPE_PRICE_GROWTH",
    highlighted: true,
    features: [
      "Everything in Starter",
      "Up to 3 stores",
      "Up to 10,000 consultations / month",
      "Custom branding + Arabic / RTL",
      "Conversion & product-demand analytics",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "For agencies, clinics & multi-store.",
    priceLabel: "$299/mo",
    amountCents: 29900,
    currency: "usd",
    priceEnv: "STRIPE_PRICE_PRO",
    features: [
      "Everything in Growth",
      "Unlimited stores",
      "Up to 100,000 consultations / month",
      "Clinic handoff + lead capture",
      "Priority support",
    ],
  },
];

export function getPlan(id: string): Plan | undefined {
  return PLANS.find((plan) => plan.id === id);
}

export function getPriceId(plan: Plan): string {
  const priceId = process.env[plan.priceEnv];
  if (!priceId) {
    throw new Error(`Missing ${plan.priceEnv} env var (Stripe Price ID for the ${plan.name} plan).`);
  }
  return priceId;
}

export function getStripeLineItem(plan: Plan) {
  const priceId = process.env[plan.priceEnv];
  if (priceId) {
    return { price: priceId, quantity: 1 };
  }

  return {
    price_data: {
      currency: plan.currency,
      unit_amount: plan.amountCents,
      recurring: { interval: "month" as const },
      product_data: {
        name: `AI Derma Guru ${plan.name}`,
        description: plan.tagline,
      },
    },
    quantity: 1,
  };
}
