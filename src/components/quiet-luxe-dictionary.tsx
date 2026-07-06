"use client";

import { dictionaryItems } from "@/content/site";
import { DgShell, useDg } from "@/components/dg/dg-shell";

export function QuietLuxeDictionary() {
  return (
    <DgShell>
      <DictionaryContent />
    </DgShell>
  );
}

function DictionaryContent() {
  const { tr, isAr } = useDg();
  return (
    <>
      <section className="hero" style={{ paddingBottom: 0 }}>
        <span className="blob" style={{ width: 460, height: 460, background: "var(--rose-tint)", top: -150, right: -90 }} />
        <span className="blob" style={{ width: 380, height: 380, background: "var(--teal-tint)", bottom: -160, left: -120 }} />
        <div className="wrap" style={{ padding: "clamp(40px,6vw,84px) 0 0", maxWidth: 760 }}>
          <span className="eyebrow">{tr("Education library", "مكتبة تثقيفية")}</span>
          <h1 className="display" style={{ fontSize: "clamp(2.6rem,5.4vw,4.4rem)", margin: "18px 0 16px" }}>
            {tr("The skin ", "قاموس ")}
            <em>{tr("dictionary.", "البشرة.")}</em>
          </h1>
          <p className="lead muted" style={{ maxWidth: 560 }}>
            {tr(
              "Short, non-diagnostic definitions that help shoppers understand routine language before choosing OTC products.",
              "تعريفات قصيرة وغير تشخيصية تساعد المتسوّقين على فهم مصطلحات الروتين قبل اختيار المنتجات.",
            )}
          </p>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="grid g-3">
            {dictionaryItems.map(([term, definition, arTerm, arDefinition]) => (
              <div className="card" key={term}>
                <strong className="serif" style={{ fontSize: "1.25rem", display: "block", marginBottom: 8 }}>
                  {isAr ? arTerm : term}
                </strong>
                <p className="muted">{isAr ? arDefinition : definition}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
