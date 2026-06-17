import Link from "next/link";

const termsSections = [
  {
    title: "OTC education only",
    body:
      "AI Derma Guru provides general cosmetic and over-the-counter skincare education. It does not diagnose, prescribe, treat disease, or replace a dermatologist, doctor, or pharmacist.",
    arTitle: "تثقيف تجميلي فقط",
    arBody:
      "يوفر AI Derma Guru معلومات عامة عن العناية التجميلية ومنتجات بدون وصفة. لا يشخص ولا يصف علاجاً ولا يعالج الأمراض ولا يستبدل الطبيب أو الصيدلي.",
  },
  {
    title: "Safety escalation",
    body:
      "If symptoms are severe, painful, infected, bleeding, rapidly changing, involve swelling, breathing difficulty, fever, or the eyes, users should seek medical care instead of relying on product advice.",
    arTitle: "تصعيد السلامة",
    arBody:
      "إذا كانت الأعراض شديدة أو مؤلمة أو مصابة بعدوى أو تنزف أو تتغير بسرعة أو تشمل تورماً أو صعوبة تنفس أو حرارة أو العينين، فيجب طلب الرعاية الطبية بدلاً من الاعتماد على نصيحة المنتجات.",
  },
  {
    title: "Sponsored recommendations",
    body:
      "Sponsored or paid placements must be disclosed. They cannot override safety filters, allergy rules, pregnancy cautions, stock status, or merchant catalog boundaries.",
    arTitle: "التوصيات الممولة",
    arBody:
      "يجب الإفصاح عن النتائج الممولة أو المدفوعة. ولا يمكنها تجاوز فلاتر السلامة أو قواعد الحساسية أو تنبيهات الحمل أو توفر المخزون أو حدود كتالوج المتجر.",
  },
];

export default function TermsOfUsePage() {
  return (
    <main className="plain-page content-page">
      <header>
        <p className="eyebrow">Terms</p>
        <h1>Terms of use</h1>
        <p className="lead">
          Clear rules for shoppers, merchants, and sponsored product discovery.
        </p>
        <Link className="share-link" href="/">
          Back home
        </Link>
      </header>
      <section className="legal-grid">
        {termsSections.map((section) => (
          <article className="content-card" key={section.title}>
            <h2>{section.title}</h2>
            <p>{section.body}</p>
            <hr />
            <h2 dir="rtl">{section.arTitle}</h2>
            <p dir="rtl">{section.arBody}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
