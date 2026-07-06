"use client";

import { faqItems } from "@/content/site";
import { DgShell, useDg } from "@/components/dg/dg-shell";

export function QuietLuxeFaq() {
  return (
    <DgShell>
      <FaqContent />
    </DgShell>
  );
}

function FaqContent() {
  const { tr, isAr } = useDg();
  return (
    <>
      <section className="hero" style={{ paddingBottom: 0 }}>
        <span className="blob" style={{ width: 480, height: 480, background: "var(--teal-tint)", top: -160, right: -100 }} />
        <span className="blob" style={{ width: 380, height: 380, background: "var(--brass-tint)", bottom: -160, left: -120 }} />
        <div className="wrap" style={{ padding: "clamp(40px,6vw,84px) 0 0", maxWidth: 760 }}>
          <span className="eyebrow">{tr("FAQ", "الأسئلة الشائعة")}</span>
          <h1 className="display" style={{ fontSize: "clamp(2.6rem,5.4vw,4.4rem)", margin: "18px 0 16px" }}>
            {tr("Questions, ", "أسئلة ")}
            <em>{tr("answered.", "بإجابات.")}</em>
          </h1>
          <p className="lead muted" style={{ maxWidth: 560 }}>
            {tr(
              "Everything shoppers and beauty brands tend to ask about DermaGuru — how the advisor works, where guidance ends, and how we keep it honest.",
              "كل ما يسأل عنه المتسوّقون وعلامات التجميل حول ديرماغورو — كيف يعمل المستشار، وأين تنتهي الإرشادات، وكيف نُبقيها صادقة.",
            )}
          </p>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="grid g-2">
            {faqItems.map((item) => (
              <div className="card" key={item.q}>
                <strong className="serif" style={{ fontSize: "1.2rem", display: "block", marginBottom: 8 }}>
                  {isAr ? item.arQ : item.q}
                </strong>
                <p className="muted">{isAr ? item.arA : item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="cta-teal">
            <h2>{tr("Still have a question?", "لا يزال لديك سؤال؟")}</h2>
            <p>{tr("Try the advisor yourself — including its safety referrals — or reach the team.", "جرّب المستشار بنفسك — بما في ذلك إحالات الأمان — أو تواصل مع الفريق.")}</p>
            <div className="cta-actions">
              <a href="/live-consultation-1" className="btn btn-white">{tr("Try the live consultation →", "جرّب الاستشارة المباشرة →")}</a>
              <a href="mailto:hello@idermaguru.com" className="btn btn-ghost-light">{tr("Contact the team", "تواصل مع الفريق")}</a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
