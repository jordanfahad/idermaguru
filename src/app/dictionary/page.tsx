import Link from "next/link";
import { dictionaryItems, locales } from "@/content/site";

export default function DictionaryPage() {
  return (
    <main className="plain-page content-page">
      <header>
        <p className="eyebrow">Education library</p>
        <h1>{locales.en.dictionaryTitle}</h1>
        <p className="lead">
          Short, non-diagnostic definitions that help shoppers understand routine language before
          choosing OTC products.
        </p>
        <Link className="share-link" href="/">
          Back home
        </Link>
      </header>
      <section className="dictionary-grid">
        {dictionaryItems.map(([term, definition, arTerm, arDefinition]) => (
          <article className="content-card" key={term}>
            <h2>{term}</h2>
            <p>{definition}</p>
            <hr />
            <h2 dir="rtl">{arTerm}</h2>
            <p dir="rtl">{arDefinition}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
