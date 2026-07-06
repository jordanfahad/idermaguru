"use client";

import { PLANS } from "@/lib/plans";
import { DgShell, useDg } from "@/components/dg/dg-shell";
import { DgSubscribeButton } from "@/components/dg/dg-subscribe-button";

export function QuietLuxePricing() {
  return (
    <DgShell>
      <PricingContent />
    </DgShell>
  );
}

const PRICING_FAQ: [string, string, string, string][] = [
  [
    "How does it go on my store?",
    "A lightweight embed snippet. It works on Shopify and non-Shopify sites — paste it once and the consultation widget appears.",
    "كيف يُضاف إلى متجري؟",
    "شفرة تضمين خفيفة. تعمل على Shopify وغيرها — الصقها مرة واحدة وتظهر أداة الاستشارة.",
  ],
  [
    "Is it safe & compliant?",
    "It gives OTC cosmetic guidance only — never a diagnosis or prescription — and flags serious cases to see a clinician. The disclaimer is always visible.",
    "هل هو آمن ومتوافق؟",
    "يقدّم إرشادات تجميلية فقط — دون تشخيص أو وصفة — ويحيل الحالات الجادّة إلى مختص. التنويه ظاهر دائماً.",
  ],
  [
    "Can I cancel anytime?",
    "Yes. Plans are monthly and you can manage or cancel from the customer portal whenever you like.",
    "هل يمكنني الإلغاء في أي وقت؟",
    "نعم. الباقات شهرية ويمكنك الإدارة أو الإلغاء من بوابة العميل متى شئت.",
  ],
  [
    "Does it support Arabic?",
    "Yes — full English + Arabic with right-to-left support, ideal for GCC and global audiences.",
    "هل يدعم العربية؟",
    "نعم — إنجليزي وعربي كامل مع دعم الكتابة من اليمين لليسار، مثالي لجمهور الخليج والعالم.",
  ],
];

function PricingContent() {
  const { tr } = useDg();
  return (
    <>
      {/* HERO */}
      <section className="hero">
        <span className="blob" style={{ width: 520, height: 520, background: "var(--teal-tint)", top: -140, right: -90 }} />
        <span className="blob" style={{ width: 420, height: 420, background: "var(--brass-tint)", bottom: -160, left: -120 }} />
        <div className="wrap" style={{ padding: "clamp(48px,7vw,104px) 0 clamp(8px,3vw,28px)", textAlign: "center" }}>
          <span className="eyebrow">{tr("Pricing", "الأسعار")}</span>
          <h1 className="display" style={{ fontSize: "clamp(2.4rem,5.2vw,4.2rem)", maxWidth: 880, margin: "18px auto 18px" }}>
            {tr("Put the advisor on your store.", "ضع المستشار على متجرك.")}
          </h1>
          <p className="lead muted" style={{ maxWidth: 620, margin: "0 auto" }}>
            {tr(
              "Embed the AI skin consultation widget on Shopify or any site. Simple monthly plans — cancel anytime, no per-sale cut.",
              "ضمّن أداة استشارة البشرة بالذكاء الاصطناعي على Shopify أو أي موقع. باقات شهرية بسيطة — ألغِ متى شئت، دون عمولة على المبيعات.",
            )}
          </p>
        </div>
      </section>

      {/* PLANS */}
      <section style={{ paddingTop: "clamp(16px,3vw,32px)" }}>
        <div className="wrap">
          <div className="grid g-3" style={{ alignItems: "stretch" }}>
            {PLANS.map((plan) => (
              <div className={`tier${plan.highlighted ? " feat" : ""}`} key={plan.id}>
                <span className={`badge ${plan.highlighted ? "badge-gold" : "badge-teal"}`}>{plan.name}</span>
                <p className="muted" style={{ fontSize: ".92rem" }}>{plan.tagline}</p>
                <div>
                  <span className="amt">{plan.priceLabel}</span>
                </div>
                <ul>
                  {plan.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                <div style={{ flex: 1 }} />
                <DgSubscribeButton
                  planId={plan.id}
                  label={tr(`Choose ${plan.name}`, `اختر ${plan.name}`)}
                  variant={plan.highlighted ? "brass" : "ink"}
                />
              </div>
            ))}
          </div>
          <p className="center muted" style={{ marginTop: 26, fontSize: ".9rem" }}>
            {tr(
              "All plans include the deterministic safety gate, catalog grounding, and PDPL / GDPR-ready data handling. Billed monthly via Stripe.",
              "تشمل كل الباقات بوابة الأمان الحاسمة، والاعتماد على الكتالوج، ومعالجة بيانات متوافقة مع PDPL / GDPR. الفوترة شهرية عبر Stripe.",
            )}{" "}
            <a href="mailto:hello@idermaguru.com" className="link-underline">{tr("Need more volume?", "تحتاج حجماً أكبر؟")}</a>
          </p>
        </div>
      </section>

      {/* TESTIMONIAL BAND */}
      <section>
        <div className="wrap">
          <div className="fullbleed">
            <img src="https://images.unsplash.com/photo-1556228578-8c89e6adf883?auto=format&fit=crop&w=1400&q=80" alt="" />
            <div style={{ maxWidth: 620 }}>
              <span className="eyebrow" style={{ color: "var(--brass-2)" }}>{tr("From a beauty brand", "من علامة تجميل")}</span>
              <h2 className="serif" style={{ fontSize: "clamp(2rem,4vw,3rem)", margin: "12px 0 14px" }}>
                {tr("“Our consultation-to-cart rate doubled.”", "«تضاعف معدّل التحوّل من الاستشارة إلى السلة.»")}
              </h2>
              <p style={{ color: "rgba(255,255,255,.82)", fontSize: "1.05rem" }}>
                {tr("Maison Dérma · launched the advisor in a weekend.", "ميزون ديرما · أطلقت المستشار في عطلة نهاية أسبوع.")}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* PRICING FAQ */}
      <section className="sec-cream">
        <div className="wrap">
          <div className="section-head center" style={{ margin: "0 auto 38px" }}>
            <span className="eyebrow">{tr("Pricing FAQ", "أسئلة الأسعار")}</span>
            <h2>{tr("The honest answers.", "إجابات صريحة.")}</h2>
          </div>
          <div className="grid g-2">
            {PRICING_FAQ.map(([q, a, arQ, arA]) => (
              <div className="card" key={q}>
                <h3>{tr(q, arQ)}</h3>
                <p className="muted" style={{ marginTop: 8 }}>{tr(a, arA)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section>
        <div className="wrap">
          <div className="cta-teal">
            <h2>{tr("Pick a price. Start growing.", "اختر السعر. وابدأ النمو.")}</h2>
            <p>{tr("Launch the advisor on your store in minutes. No long contracts, no per-sale cut.", "أطلق المستشار على متجرك في دقائق. بلا عقود طويلة ولا عمولة على المبيعات.")}</p>
            <div className="cta-actions">
              <a href="/live-consultation-1" className="btn btn-white">{tr("See it live", "شاهده مباشرة")}</a>
              <a href="mailto:hello@idermaguru.com" className="btn btn-ghost-light">{tr("Talk to us", "تواصل معنا")}</a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
