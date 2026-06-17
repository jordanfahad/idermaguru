"use client";

import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Camera,
  Globe2,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Stethoscope,
  Upload,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useState } from "react";
import { articleCards, dictionaryItems, faqItems, locales, type Locale } from "@/content/site";

const skinGoals = [
  {
    title: "Dark spots",
    text: "Tone, SPF, texture, and glow-safe product matching.",
    image: "https://images.unsplash.com/photo-1585652757173-57de5e9fab42?auto=format&fit=crop&w=700&q=82",
    href: "/live-consultation-1?goal=dark-spots",
  },
  {
    title: "Barrier repair",
    text: "Gentle hydration, sensitivity filters, and routine order.",
    image: "https://images.unsplash.com/photo-1515377905703-c4788e51af15?auto=format&fit=crop&w=700&q=82",
    href: "/live-consultation-1?goal=barrier",
  },
  {
    title: "Oily pores",
    text: "Cleanser, non-comedogenic guidance, and irritation checks.",
    image: "https://images.unsplash.com/photo-1580870069867-74c57ee1bb07?auto=format&fit=crop&w=700&q=82",
    href: "/live-consultation-1?goal=acne-oil",
  },
  {
    title: "Fine lines",
    text: "SPF-first routines, peptides, retinoid caution, and moisturizer.",
    image: "https://images.unsplash.com/photo-1598300042247-d088f8ab3a91?auto=format&fit=crop&w=700&q=82",
    href: "/live-consultation-1?goal=fine-lines",
  },
  {
    title: "Hair + scalp",
    text: "Dryness, dandruff, dullness, hair fall, and wash routines.",
    image: "https://images.unsplash.com/photo-1527799820374-dcf8d9d4a388?auto=format&fit=crop&w=700&q=82",
    href: "/live-consultation-1?goal=hair-scalp",
  },
  {
    title: "Safe mode",
    text: "Pregnancy, allergy, sensitivity, and prescription exclusion logic.",
    image: "https://images.unsplash.com/photo-1498843053639-170ff2122f35?auto=format&fit=crop&w=700&q=82",
    href: "/live-consultation-1?goal=safe-mode",
  },
];

const shelfProducts = [
  {
    tag: "Peptide serum",
    name: "EQQUALBERRY NAD+ Peptide Boosting Serum",
    text: "A glow and skin-support product card for premium routine shelves.",
    price: "AED 69",
    image: "https://cdn.shopify.com/s/files/1/0828/2731/3463/files/4_90ccffdb-d347-4d1b-9bb7-145bb3a17738.jpg?v=1763994487",
  },
  {
    tag: "Tone support",
    name: "Medicube TXA Niacinamide 15 Serum",
    text: "For dullness and uneven-looking tone when the intake allows serum use.",
    price: "AED 95",
    image: "https://cdn.shopify.com/s/files/1/0828/2731/3463/files/1423141751-1.jpg?v=1761654218",
  },
  {
    tag: "Daily SPF",
    name: "Celimax Pore + Dark Spot Brightening Sunscreen",
    text: "SPF card for AM routine logic and tone-support recommendations.",
    price: "AED 95",
    image: "https://cdn.shopify.com/s/files/1/0828/2731/3463/files/1272063235-1.jpg?v=1761131004",
  },
  {
    tag: "Gentle cleanse",
    name: "Purito Seoul Mighty Bamboo Panthenol Cleanser",
    text: "For barrier-first routines where the engine should not over-sell actives.",
    price: "AED 80",
    image: "https://cdn.shopify.com/s/files/1/0828/2731/3463/files/16_0f8d0ee8-d227-44be-ab5a-b6ded99d2ecf.jpg?v=1763566527",
  },
  {
    tag: "Hair care",
    name: "K18 Leave-in Molecular Repair Hair Mask 50ml",
    text: "Hair and scalp recommendations can live inside the same product discovery flow.",
    price: "AED 213",
    image: "https://images.unsplash.com/photo-1527799820374-dcf8d9d4a388?auto=format&fit=crop&w=700&q=82",
  },
];

const quickPanels = [
  {
    title: "Beauty-store UX",
    text: "Full-width retail search, categories, offer-style CTAs, and routine cards.",
    image: "https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=500&q=80",
    href: "#widget",
  },
  {
    title: "Founder dashboard",
    text: "Catalog import, rules, analytics, and recommendation controls.",
    image: "https://images.unsplash.com/photo-1551836022-d5d88e9218df?auto=format&fit=crop&w=500&q=80",
    href: "#admin",
  },
  {
    title: "Clinic-safe handoff",
    text: "Clear escalation when product advice should stop.",
    image: "https://images.unsplash.com/photo-1584515933487-779824d29309?auto=format&fit=crop&w=500&q=80",
    href: "#clinics",
  },
  {
    title: "Product-led revenue",
    text: "Routine bundles, add-to-cart actions, and attribution.",
    image: "https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?auto=format&fit=crop&w=500&q=80",
    href: "#shelf",
  },
];

const buyerReasons = [
  ["Premium feel", "Beauty-retail photography, editorial education, and polished product cards."],
  ["More conversion", "Turns vague concerns into routines and routes shoppers to product pages."],
  ["Operator control", "Manage catalog imports, safety logic, priority products, and analytics."],
  ["Trust guardrails", "OTC disclaimer, red-flag escalation, and ingredient education stay visible."],
];

export function LanguageHome() {
  const [locale, setLocale] = useState<Locale>("en");
  const t = locales[locale];
  const isAr = locale === "ar";

  return (
    <main dir={isAr ? "rtl" : "ltr"} className="commerce-home">
      <div className="home-announce">
        <span>Beauty-commerce AI</span>
        Catalog-safe OTC routines - Shopify widget - Clinic handoff - Built for modern founders
      </div>
      <HomeHeader locale={locale} setLocale={setLocale} />

      <section className="home-hero" id="new">
        <div className="home-hero-overlay">
          <div className="home-hero-copy">
            <div className="home-badge-row">
              <span>Sephora-style shopper UX</span>
              <span>Shopify-ready widget</span>
              <span>OTC safety guardrails</span>
            </div>
            <p className="eyebrow">{t.secondaryBrand}</p>
            <h1>Turn your beauty catalog into a personal glow routine.</h1>
            <p>
              A premium AI skin and hair advisor for beauty brands, clinics, pharmacies, and product-led founders.
              Shoppers ask for help, the widget builds a conservative OTC routine, and products come from the merchant
              catalog.
            </p>
            <div className="home-actions">
              <Link className="home-button home-button-primary" href="/live-consultation-1">
                Try the shopper widget
                <ArrowRight size={18} />
              </Link>
              <Link className="home-button home-button-light" href="#admin">
                See admin dashboard
              </Link>
              <Link className="home-button home-button-outline" href="#dictionary">
                Explore skin dictionary
              </Link>
            </div>
            <p className="home-disclaimer">
              OTC cosmetic guidance only. AI Derma Guru does not diagnose, prescribe, or replace medical care.
            </p>
          </div>

          <aside className="home-widget-preview" aria-label="AI widget preview">
            <div className="home-widget-top">
              <strong>Live widget preview</strong>
              <Sparkles size={18} />
            </div>
            <div className="home-bubble home-bubble-user">I have dull skin and dark spots. I want a simple routine.</div>
            <div className="home-bubble home-bubble-ai">
              Start with gentle cleanse, barrier hydration, daily SPF, and one tone-focused serum.
            </div>
            <div className="home-mini-products">
              <img alt="Serum product" src="https://cdn.shopify.com/s/files/1/0828/2731/3463/files/1423141751-1.jpg?v=1761654218" />
              <img alt="Sunscreen product" src="https://cdn.shopify.com/s/files/1/0828/2731/3463/files/1272063235-1.jpg?v=1761131004" />
              <img alt="Moisturizer product" src="https://cdn.shopify.com/s/files/1/0828/2731/3463/files/71cpGfSXMfL._AC_SX522.jpg?v=1754216179" />
            </div>
          </aside>
        </div>
      </section>

      <section className="home-section home-section-compact" aria-label="Platform shortcuts">
        <div className="home-quick-grid">
          {quickPanels.map((item) => (
            <Link className="home-quick-card" href={item.href} key={item.title}>
              <img alt="" src={item.image} />
              <span>
                <strong>{item.title}</strong>
                <small>{item.text}</small>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="home-section" id="goals">
        <SectionHeading
          kicker="Shop by skin goal"
          title="Make discovery feel like beauty shopping, not a medical form."
          action={<Link className="home-button home-button-dark" href="/live-consultation-1">Open widget</Link>}
        />
        <div className="home-goal-grid">
          {skinGoals.map((goal) => (
            <Link className="home-goal-card" href={goal.href} key={goal.title}>
              <img alt="" src={goal.image} />
              <span>
                <strong>{goal.title}</strong>
                <small>{goal.text}</small>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="home-section" id="founders">
        <div className="home-wide-banner">
          <div>
            <p className="home-kicker">For beauty founders and premium operators</p>
            <h2>Not another sterile SaaS page. A beauty command center that looks expensive.</h2>
            <p>
              Give your brand the feeling of a luxury beauty counter: product discovery, skin education, curated
              routines, and smart conversion in one polished experience.
            </p>
            <div className="home-stat-row">
              <Metric value="24/7" label="guided skin shopping" />
              <Metric value="CSV" label="catalog import" />
              <Metric value="OTC" label="safety-first rules" />
            </div>
          </div>
          <img
            alt="Founders reviewing a digital beauty business dashboard"
            src="https://images.unsplash.com/photo-1551836022-d5d88e9218df?auto=format&fit=crop&w=1300&q=86"
          />
        </div>
      </section>

      <section className="home-section" id="widget">
        <div className="home-split">
          <div className="home-panel home-panel-dark">
            <p className="home-kicker">Customer-facing widget</p>
            <h2>The shopper sees beauty, not backend complexity.</h2>
            <p>
              Keep the widget focused: one concern input, pretty prompt chips, optional photo consent, a safe AM/PM
              routine, and product cards from the active merchant catalog.
            </p>
            <div className="home-actions">
              <Link className="home-button home-button-primary" href="/live-consultation-1">Try live consultation</Link>
              <Link className="home-button home-button-outline" href="#faq">Read FAQ</Link>
            </div>
            <p className="home-disclaimer">CSV, XML, admin rules, and merchant setup stay in Admin, not in the shopper widget.</p>
          </div>
          <div className="home-widget-shell">
            <div className="home-widget-hero">Your glow plan, minus the guesswork.</div>
            <div className="home-chip-row">
              <span>Dark spots</span>
              <span>Sensitive barrier</span>
              <span>Oily pores</span>
              <span>Hair fall</span>
              <span>Pregnancy-safe</span>
            </div>
            <div className="home-input-card">
              <span>Tell us your skin or hair concern...</span>
              <ArrowRight size={18} />
            </div>
            <div className="home-routine-mini">
              <RoutineStep title="AM routine" text="Cleanse, tone-support serum, moisturizer, SPF." />
              <RoutineStep title="PM routine" text="Cleanse, one focused active if suitable, barrier moisturizer." />
            </div>
          </div>
        </div>
      </section>

      <section className="home-section" id="shelf">
        <SectionHeading
          kicker="Catalog shelf"
          title="Recommendations should look like a premium product wall."
          action={<Link className="home-button home-button-blush" href="#admin">How products connect</Link>}
        />
        <div className="home-product-shelf">
          {shelfProducts.map((product) => (
            <article className="home-product-card" key={product.name}>
              <img alt={product.name} src={product.image} />
              <div>
                <span>{product.tag}</span>
                <strong>{product.name}</strong>
                <p>{product.text}</p>
                <div>
                  <b>{product.price}</b>
                  <Link href="/live-consultation-1">Match</Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="home-section" id="admin">
        <SectionHeading
          kicker="Admin dashboard"
          title="The merchant backend should feel powerful, visual, and founder-friendly."
          action={<Link className="home-button home-button-dark" href="/admin">Open Admin</Link>}
        />
        <div className="home-dashboard-preview">
          <aside>
            <strong>AI Derma Guru Admin</strong>
            {["Dashboard", "Catalog import", "Recommendation rules", "Safety exclusions", "Sponsored placements", "Revenue attribution"].map((item, index) => (
              <span className={index === 0 ? "active" : ""} key={item}>{item}</span>
            ))}
          </aside>
          <div>
            <div className="home-dash-grid">
              <Metric value="Demo" label="widget mode active" />
              <Metric value="CSV" label="catalog source" />
              <Metric value="Rules" label="pregnancy / allergy filters" />
              <Metric value="OTC" label="diagnosis-free guardrails" />
            </div>
            <div className="home-import-list">
              <ImportItem icon={<Upload size={18} />} title="Product catalog" text="Title, image, price, compare-at price, inventory, tags." status="Connected" />
              <ImportItem icon={<ShoppingBag size={18} />} title="Shopify cart" text="Send add-to-cart actions and track recommendation attribution." status="Ready" />
              <ImportItem icon={<ShieldCheck size={18} />} title="Clinical stop rules" text="Escalate pain, swelling, infection signs, bleeding, suspicious moles, and prescription requests." status="Safe" />
              <ImportItem icon={<BarChart3 size={18} />} title="Analytics" text="Sessions, clicks, CTR, attributed revenue, and top products." status="Live" />
            </div>
          </div>
        </div>
      </section>

      <section className="home-section" id="dictionary">
        <SectionHeading
          kicker="Skin dictionary"
          title="Make education feel like editorial beauty content."
          action={<Link className="home-button home-button-dark" href="/dictionary">View dictionary</Link>}
        />
        <div className="home-dictionary-grid">
          {dictionaryItems.slice(0, 6).map(([term, text]) => (
            <article className="home-dict-card" key={term}>
              <strong>{term}</strong>
              <p>{text}</p>
              <Link href="/dictionary">Read guide</Link>
            </article>
          ))}
        </div>
      </section>

      <section className="home-section" id="clinics">
        <div className="home-split">
          <div className="home-panel">
            <p className="home-kicker">Clinics, doctors, and pharmacies</p>
            <h2>Trust is the design feature.</h2>
            <p>
              AI Derma Guru supports OTC discovery, product education, and escalation when symptoms look outside
              cosmetic guidance.
            </p>
            <div className="home-reason-grid home-reason-grid-two">
              <Reason icon={<Stethoscope size={18} />} title="Referral stop rules" text="Pain, infection signs, swelling, bleeding, suspicious mole changes, or prescription requests should stop product selling." />
              <Reason icon={<ShieldCheck size={18} />} title="Safety exclusions" text="Allergy, pregnancy, sensitivity, and current prescription fields change what the widget recommends." />
            </div>
          </div>
          <img
            className="home-clinic-image"
            alt="Modern clinical consultation setting"
            src="https://images.unsplash.com/photo-1584515933487-779824d29309?auto=format&fit=crop&w=1200&q=86"
          />
        </div>
      </section>

      <section className="home-section">
        <SectionHeading kicker="Why brands buy it" title="A polished SaaS story for beauty leaders." />
        <div className="home-reason-grid">
          {buyerReasons.map(([title, text]) => (
            <Reason icon={<BadgeCheck size={18} />} title={title} text={text} key={title} />
          ))}
        </div>
      </section>

      <section className="home-section" id="education">
        <SectionHeading kicker={t.articlesTitle} title="Education that makes recommendations feel trustworthy." />
        <div className="home-article-grid">
          {articleCards.map((article) => (
            <article className="home-article-card" key={article.title}>
              <img alt={isAr ? article.titleAr : article.title} src={article.image} />
              <div>
                <strong>{isAr ? article.titleAr : article.title}</strong>
                <p>{isAr ? article.textAr : article.text}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="home-section" id="faq">
        <SectionHeading
          kicker="FAQ"
          title="Answer the buyer objections directly."
          action={<Link className="home-button home-button-dark" href="/faq">Full FAQ</Link>}
        />
        <div className="home-faq-list">
          {faqItems.slice(0, 5).map((item, index) => (
            <details key={item.q} open={index === 0}>
              <summary>{isAr ? item.arQ : item.q}</summary>
              <p>{isAr ? item.arA : item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="home-section" id="demo">
        <div className="home-final-cta">
          <p className="home-kicker">Launch the premium version</p>
          <h2>Make AI Derma Guru feel like the beauty advisor every modern store wishes it had.</h2>
          <p>
            Keep the live consultation page as the shopper widget, and use this homepage as the commercial story for
            merchants, clinics, pharmacies, and beauty retailers.
          </p>
          <div className="home-actions">
            <Link className="home-button home-button-primary" href="/live-consultation-1">Try widget demo</Link>
            <Link className="home-button home-button-light" href="/admin">Open Admin</Link>
            <Link className="home-button home-button-outline" href="/dictionary">Skin dictionary</Link>
          </div>
        </div>
      </section>

      <footer className="home-footer">
        <div>
          <HomeBrand />
          <p>AI skin and hair product discovery for Shopify stores, beauty retailers, clinics, pharmacies, and founders.</p>
        </div>
        <FooterColumn title="Product" links={[["Widget demo", "/live-consultation-1"], ["Admin", "/admin"], ["Catalog shelf", "#shelf"], ["Analytics", "#admin"]]} />
        <FooterColumn title="Education" links={[["Skin dictionary", "/dictionary"], ["FAQ", "/faq"], ["Safety rules", "#clinics"], ["Skin goals", "#goals"]]} />
        <FooterColumn title="Company" links={[["For founders", "#founders"], ["For clinics", "#clinics"], ["Book demo", "#demo"], ["Privacy", "/privacy-policy"]]} />
        <FooterColumn title="Legal" links={[["Privacy", "/privacy-policy"], ["Terms", "/terms-of-use"], ["Disclaimers", "/faq"], ["Contact", "mailto:hello@idermaguru.com"]]} />
      </footer>

      <div className="home-mobile-sticky">
        <span>Launch the AI skin advisor</span>
        <Link href="/live-consultation-1">Try demo</Link>
      </div>
    </main>
  );
}

function HomeHeader({ locale, setLocale }: { locale: Locale; setLocale: (locale: Locale) => void }) {
  const t = locales[locale];

  return (
    <header className="home-header">
      <div className="home-header-main">
        <Link className="home-brand" href="/" aria-label="AI Derma Guru home">
          <HomeBrand />
        </Link>
        <form className="home-search" action="/live-consultation-1">
          <Search size={18} />
          <input name="q" aria-label="Search" placeholder="Search skin goals, ingredients, routines, or products" />
          <button type="submit">Ask AI</button>
        </form>
        <nav className="home-header-links" aria-label="Primary">
          <Link href="/faq">{t.nav.faq}</Link>
          <Link href="/dictionary">{t.nav.dictionary}</Link>
          <Link href="/live-consultation-1">Widget demo</Link>
          <Link className="home-admin-link" href="/admin">{t.nav.admin}</Link>
          <button type="button" onClick={() => setLocale(locale === "en" ? "ar" : "en")}>
            <Globe2 size={16} />
            {locale === "en" ? "Arabic" : "English"}
          </button>
        </nav>
      </div>
      <nav className="home-category-nav" aria-label="Beauty categories">
        {[
          ["New", "#new"],
          ["AI Skin Advisor", "#widget"],
          ["Skin Goals", "#goals"],
          ["Catalog Shelf", "#shelf"],
          ["Skin Dictionary", "#dictionary"],
          ["Admin Dashboard", "#admin"],
          ["Clinics", "#clinics"],
          ["For Founders", "#founders"],
          ["FAQ", "#faq"],
          ["Launch Offer", "#demo"],
        ].map(([label, href]) => (
          <Link className={label === "Launch Offer" ? "sale" : ""} href={href} key={label}>
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

function HomeBrand() {
  return (
    <span className="home-brand-lockup">
      <span className="home-brand-mark" aria-hidden="true">ADG</span>
      <span>
        <span className="home-brand-title">AI Derma Guru</span>
        <span className="home-brand-subtitle">Skin advisor for commerce</span>
      </span>
    </span>
  );
}

function SectionHeading({ kicker, title, action }: { kicker: string; title: string; action?: ReactNode }) {
  return (
    <div className="home-section-title">
      <div>
        <p className="home-kicker">{kicker}</p>
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="home-stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function RoutineStep({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <strong>{title}</strong>
      <small>{text}</small>
    </div>
  );
}

function ImportItem({ icon, title, text, status }: { icon: ReactNode; title: string; text: string; status: string }) {
  return (
    <div className="home-import-item">
      <span className="home-import-icon">{icon}</span>
      <span>
        <strong>{title}</strong>
        <small>{text}</small>
      </span>
      <b>{status}</b>
    </div>
  );
}

function Reason({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <article className="home-reason-card">
      <span>{icon}</span>
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  );
}

function FooterColumn({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h4>{title}</h4>
      {links.map(([label, href]) => (
        <Link href={href} key={label}>{label}</Link>
      ))}
    </div>
  );
}
