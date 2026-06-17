"use client";

import { ArrowRight, BadgeCheck, Camera, Globe2, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useState } from "react";
import { articleCards, locales, type Locale } from "@/content/site";

export function ClassicLanguageHome() {
  const [locale, setLocale] = useState<Locale>("en");
  const t = locales[locale];
  const isAr = locale === "ar";

  return (
    <main dir={isAr ? "rtl" : "ltr"} className="site-shell">
      <ClassicTopNav locale={locale} setLocale={setLocale} />
      <section className="dg-hero">
        <div className="dg-hero-copy">
          <p className="eyebrow">{t.secondaryBrand}</p>
          <h1>{t.heroTitle}</h1>
          <p>{t.heroText}</p>
          <div className="dg-actions">
            <Link className="dg-primary" href="/demo">
              {t.ctaPrimary}
              <ArrowRight size={18} />
            </Link>
            <Link className="dg-secondary" href="/widget-demo">
              {t.ctaSecondary}
            </Link>
          </div>
          <div className="dg-trust">
            {t.trust.map((item) => (
              <span key={item}>
                <ShieldCheck size={16} />
                {item}
              </span>
            ))}
          </div>
        </div>
        <div className="phone-preview" aria-label="AI Derma Guru preview">
          <div className="phone-camera" />
          <img
            alt="Skincare products and skin analysis preview"
            src="https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?auto=format&fit=crop&w=700&q=80"
          />
          <div className="scan-card">
            <Camera size={18} />
            <div>
              <strong>OTC routine ready</strong>
              <span>6 catalog-safe products</span>
            </div>
          </div>
        </div>
      </section>

      <section className="image-band">
        <img alt="Skincare bottle texture" src="https://images.unsplash.com/photo-1616394584738-fc6e612e71b9?auto=format&fit=crop&w=900&q=80" />
        <img alt="Applying skincare" src="https://images.unsplash.com/photo-1522338242992-e1a54906a8da?auto=format&fit=crop&w=900&q=80" />
        <img alt="Cosmetic product shelf" src="https://images.unsplash.com/photo-1612817288484-6f916006741a?auto=format&fit=crop&w=900&q=80" />
      </section>

      <section className="dg-section two-col">
        <div>
          <p className="eyebrow">Scanner-inspired flow</p>
          <h2>{t.scanTitle}</h2>
          <p>{t.scanText}</p>
        </div>
        <div className="feature-grid">
          <Feature icon={<Camera size={20} />} title="Optional photo consent" text="Photo upload stays optional and non-diagnostic." />
          <Feature icon={<BadgeCheck size={20} />} title="Merchant catalog only" text="The engine cannot invent products outside approved inventory." />
          <Feature icon={<Sparkles size={20} />} title="Revenue attribution" text="Track impressions, clicks, add-to-cart, and purchases." />
        </div>
      </section>

      <section className="dg-section">
        <div className="section-heading">
          <p className="eyebrow">{t.articlesTitle}</p>
          <h2>Education that makes the recommendation feel trustworthy.</h2>
        </div>
        <div className="article-grid">
          {articleCards.map((article) => (
            <article className="article-card" key={article.title}>
              <img alt={isAr ? article.titleAr : article.title} src={article.image} />
              <div>
                <h3>{isAr ? article.titleAr : article.title}</h3>
                <p>{isAr ? article.textAr : article.text}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
      <footer className="dg-footer">
        <Link href="/privacy-policy">{t.nav.privacy}</Link>
        <Link href="/terms-of-use">{t.nav.terms}</Link>
        <Link href="/faq">{t.nav.faq}</Link>
      </footer>
    </main>
  );
}

function ClassicTopNav({ locale, setLocale }: { locale: Locale; setLocale: (locale: Locale) => void }) {
  const t = locales[locale];
  return (
    <nav className="dg-nav">
      <Link className="dg-brand" href="/">
        <span>ADG</span>
        <strong>{t.brand}</strong>
      </Link>
      <div>
        <Link href="/faq">{t.nav.faq}</Link>
        <Link href="/dictionary">{t.nav.dictionary}</Link>
        <Link href="/admin">{t.nav.admin}</Link>
        <button type="button" onClick={() => setLocale(locale === "en" ? "ar" : "en")}>
          <Globe2 size={16} />
          {locale === "en" ? "Arabic" : "English"}
        </button>
      </div>
    </nav>
  );
}

function Feature({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <article className="feature-card">
      {icon}
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  );
}
