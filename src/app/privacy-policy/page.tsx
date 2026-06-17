import Link from "next/link";

const privacySections = [
  {
    title: "What we collect",
    body:
      "AI Derma Guru uses anonymous sessions, intake answers, consent records, product interactions, and conversion events needed to provide recommendations and measure attribution. Image upload is optional and requires explicit consent.",
    arTitle: "ما الذي نجمعه",
    arBody:
      "يستخدم AI Derma Guru جلسات مجهولة، وإجابات الاستبيان، وسجلات الموافقة، وتفاعلات المنتجات، وأحداث التحويل اللازمة لتقديم التوصيات وقياس الأداء. رفع الصورة اختياري ويتطلب موافقة صريحة.",
  },
  {
    title: "How photos are handled",
    body:
      "Photos are not used for diagnosis and are not used to train AI models. The MVP is designed for short retention, deletion support, and limited admin visibility.",
    arTitle: "كيف نتعامل مع الصور",
    arBody:
      "لا تُستخدم الصور للتشخيص ولا لتدريب نماذج الذكاء الاصطناعي. تم تصميم النسخة الأولية للاحتفاظ القصير ودعم الحذف وتقليل ظهور الصور للمسؤولين.",
  },
  {
    title: "Merchant analytics",
    body:
      "Merchants can see aggregate sessions, recommendations, impressions, clicks, conversions, and attributed revenue. The product should avoid exposing unnecessary personal data.",
    arTitle: "تحليلات المتجر",
    arBody:
      "يمكن للتجار رؤية إجمالي الجلسات والتوصيات ومرات الظهور والنقرات والتحويلات والإيرادات المنسوبة. يجب ألا يعرض المنتج بيانات شخصية غير ضرورية.",
  },
];

export default function PrivacyPolicyPage() {
  return (
    <main className="plain-page content-page">
      <header>
        <p className="eyebrow">Privacy</p>
        <h1>Privacy policy</h1>
        <p className="lead">
          Privacy-conscious defaults for an OTC product discovery assistant, written in English and Arabic.
        </p>
        <Link className="share-link" href="/">
          Back home
        </Link>
      </header>
      <section className="legal-grid">
        {privacySections.map((section) => (
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
