import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { getStripe } from "@/lib/stripe";
import { getPlan } from "@/lib/plans";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "You're subscribed | AI Derma Guru",
  robots: { index: false },
};

export default async function BillingSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id } = await searchParams;

  let email: string | null = null;
  let planName: string | null = null;

  if (session_id) {
    try {
      const stripe = getStripe();
      const session = await stripe.checkout.sessions.retrieve(session_id);
      email = session.customer_details?.email ?? session.customer_email ?? null;
      const planId = session.metadata?.planId;
      planName = planId ? getPlan(planId)?.name ?? null : null;
    } catch {
      // If keys aren't set yet or the session can't be read, show the generic message.
    }
  }

  return (
    <main className="prc prc-success">
      <section className="prc-success-card">
        <span className="prc-success-icon">
          <CheckCircle2 size={40} />
        </span>
        <h1>You&rsquo;re in. Welcome aboard! 🎉</h1>
        <p>
          {planName ? (
            <>
              Your <strong>{planName}</strong> subscription is active
              {email ? (
                <>
                  {" "}
                  and a receipt is on its way to <strong>{email}</strong>
                </>
              ) : null}
              .
            </>
          ) : (
            <>Your subscription is being set up. A receipt will arrive by email shortly.</>
          )}
        </p>
        <p className="prc-success-next">
          Next: we&rsquo;ll email you the embed snippet and onboarding steps to add the AI skin advisor widget to
          your store. Want it faster? Reply to your receipt or contact{" "}
          <a href="mailto:hello@idermaguru.com">hello@idermaguru.com</a>.
        </p>
        <div className="prc-hero-actions">
          <Link className="prc-btn prc-btn-primary" href="/live-consultation-1">
            Explore the live widget
          </Link>
          <Link className="prc-btn prc-btn-ghost" href="/">
            Back to home
          </Link>
        </div>
      </section>
    </main>
  );
}
