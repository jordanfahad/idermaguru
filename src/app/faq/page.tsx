import Link from "next/link";
import { faqItems, locales } from "@/content/site";

export default function FaqPage() {
  return (
    <main className="plain-page content-page">
      <header>
        <p className="eyebrow">AI Derma Guru</p>
        <h1>{locales.en.faqTitle}</h1>
        <p className="lead">
          Answers for shoppers and merchants about OTC skincare guidance, sponsored results,
          photo consent, and safety escalation.
        </p>
        <Link className="share-link" href="/">
          Back home
        </Link>
      </header>
      <section className="legal-grid">
        {faqItems.map((item) => (
          <article className="content-card" key={item.q}>
            <h2>{item.q}</h2>
            <p>{item.a}</p>
            <hr />
            <h2 dir="rtl">{item.arQ}</h2>
            <p dir="rtl">{item.arA}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
