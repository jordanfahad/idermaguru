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
    title: "AI processing by OpenAI",
    body:
      "The skin advisor is powered by OpenAI. Before you start, we ask for your permission to send what you type, what you say (your voice is transcribed into text) and any skin photo you choose to add to OpenAI, which processes it to generate your guidance. Under OpenAI's API terms this data is not used to train their models. Nothing is sent until you agree, and you can keep using the store without the advisor.",
    arTitle: "المعالجة بالذكاء الاصطناعي عبر OpenAI",
    arBody:
      "يعمل مستشار البشرة بتقنية OpenAI. قبل البدء نطلب إذنك لإرسال ما تكتبه وما تقوله (يُحوَّل صوتك إلى نص) وأي صورة لبشرتك تختار إضافتها إلى OpenAI لمعالجتها وتقديم الإرشاد لك. وفق شروط واجهة OpenAI البرمجية لا تُستخدم هذه البيانات لتدريب نماذجها. لا يُرسل أي شيء قبل موافقتك، ويمكنك متابعة التسوق دون استخدام المستشار.",
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
