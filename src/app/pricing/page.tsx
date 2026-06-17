import type { Metadata } from "next";
import Link from "next/link";
import { Check, ShieldCheck, Sparkles, Store, Stethoscope, TrendingUp, Users } from "lucide-react";
import { PLANS } from "@/lib/plans";
import { SubscribeButton } from "@/components/subscribe-button";

export const metadata: Metadata = {
  title: "Pricing — Add the AI dermatologist widget to your store | AI Derma Guru",
  description:
    "Embed the AI skin consultation widget on Shopify and any store. Turn browsers into personalized routines and matched products. Simple monthly plans.",
};

const audiences = [
  { icon: Store, title: "Brands & stores", body: "Shopify and any e-commerce site — lift conversion and basket size." },
  { icon: Users, title: "Creators & influencers", body: "Give your audience a real skin consult and monetize product matches." },
  { icon: Stethoscope, title: "Clinics & derms", body: "Pre-qualify patients with safe, OTC-only guidance and clean handoff." },
  { icon: TrendingUp, title: "Agencies & SMBs", body: "Deploy across clients and stores, with analytics that prove ROI." },
];

const faqs = [
  {
    q: "How does it go on my store?",
    a: "A lightweight embed snippet. It works on Shopify and non-Shopify sites — paste it once and the consultation widget appears.",
  },
  {
    q: "Is it safe / compliant?",
    a: "It gives OTC cosmetic guidance only — never a diagnosis or prescription — and flags serious cases to see a clinician. The disclaimer is always visible.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. Plans are monthly and you can manage or cancel from the customer portal whenever you like.",
  },
  {
    q: "Does it support Arabic?",
    a: "Yes — full English + Arabic with right-to-left support, ideal for GCC and global audiences.",
  },
];

export default function PricingPage() {
  return (
    <main className="prc">
      <div className="prc-aurora" aria-hidden="true">
        <span className="prc-orb prc-orb-1" />
        <span className="prc-orb prc-orb-2" />
      </div>

      <header className="prc-nav">
        <Link className="prc-brand" href="/">
          <span className="prc-brand-mark">
            <Sparkles size={18} />
          </span>
          AI Derma Guru
        </Link>
        <Link className="prc-nav-demo" href="/live-consultation-1">
          See the live demo →
        </Link>
      </header>

      <section className="prc-hero">
        <span className="prc-eyebrow">
          <Sparkles size={15} />
          For brands, creators, clinics & agencies
        </span>
        <h1>
          Put an <span className="prc-grad">AI dermatologist</span> on your store.
        </h1>
        <p className="prc-lead">
          Embed the AI skin consultation widget on Shopify or any site. Shoppers describe a concern and get a
          personalized routine with products matched from your catalog — so browsers become buyers.
        </p>
        <div className="prc-hero-actions">
          <a className="prc-btn prc-btn-primary" href="#plans">
            See plans
          </a>
          <Link className="prc-btn prc-btn-ghost" href="/live-consultation-1">
            Try the live widget
          </Link>
        </div>
        <div className="prc-trust">
          <span className="prc-trust-chip">
            <ShieldCheck size={15} /> OTC-only, compliance-safe
          </span>
          <span className="prc-trust-chip">
            <Check size={15} /> Works on Shopify + any store
          </span>
          <span className="prc-trust-chip">
            <Check size={15} /> English + Arabic (RTL)
          </span>
        </div>
      </section>

      <section className="prc-audiences" aria-label="Who it's for">
        {audiences.map((item) => (
          <article className="prc-aud-card" key={item.title}>
            <span className="prc-aud-icon">
              <item.icon size={20} />
            </span>
            <h3>{item.title}</h3>
            <p>{item.body}</p>
          </article>
        ))}
      </section>

      <section className="prc-plans" id="plans">
        <div className="prc-plans-head">
          <h2>Simple monthly pricing</h2>
          <p>Start small, scale as you grow. Cancel anytime.</p>
        </div>
        <div className="prc-grid">
          {PLANS.map((plan) => (
            <article className={`prc-plan${plan.highlighted ? " prc-plan-featured" : ""}`} key={plan.id}>
              {plan.highlighted ? <span className="prc-badge">Most popular</span> : null}
              <h3>{plan.name}</h3>
              <p className="prc-plan-tagline">{plan.tagline}</p>
              <div className="prc-price">
                <strong>{plan.priceLabel}</strong>
              </div>
              <ul className="prc-features">
                {plan.features.map((feature) => (
                  <li key={feature}>
                    <Check size={16} />
                    {feature}
                  </li>
                ))}
              </ul>
              <SubscribeButton
                planId={plan.id}
                label={`Choose ${plan.name}`}
                highlighted={plan.highlighted}
              />
            </article>
          ))}
        </div>
        <p className="prc-plans-note">
          Prices are billed monthly via Stripe. Taxes may apply. Need higher volume or a custom rollout?{" "}
          <a href="mailto:hello@idermaguru.com">Talk to us</a>.
        </p>
      </section>

      <section className="prc-faq">
        <h2>Questions, answered</h2>
        <div className="prc-faq-grid">
          {faqs.map((faq) => (
            <article key={faq.q}>
              <h3>{faq.q}</h3>
              <p>{faq.a}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="prc-footer">
        <span>© AI Derma Guru — AI skin consultations for stores. Cosmetic guidance only.</span>
        <Link href="/live-consultation-1">See the live demo →</Link>
      </footer>
    </main>
  );
}
