"use client";

import Link from "next/link";
import { useState } from "react";
import { VoiceAgent } from "./voice-agent";
import "./dg-home.css";
import "./dg-home-extra.css";

/**
 * The public marketing homepage in the "quiet-luxe / editorial skincare" design
 * (docs/redesign/prototype/home.html), rebuilt as a real component. All styling
 * is scoped under `.dg` (see dg-home.css / dg-home-extra.css) so it can't collide
 * with the app's global stylesheet. Links point at real routes; the EN/AR toggle
 * flips text direction and the visible chrome.
 */

const ROUTES = {
  live: "/live-consultation-1",
  pricing: "/pricing",
  faq: "/faq",
  dictionary: "/dictionary",
  login: "/login",
  privacy: "/privacy-policy",
  terms: "/terms-of-use",
};

type Locale = "en" | "ar";

export function QuietLuxeHome() {
  const [locale, setLocale] = useState<Locale>("en");
  const isAr = locale === "ar";
  const tr = (en: string, ar: string) => (isAr ? ar : en);

  return (
    <div className="dg" dir={isAr ? "rtl" : "ltr"}>
      {/* ===== NAV ===== */}
      <header className="nav">
        <div className="wrap">
          <Link className="brand" href="/" aria-label="DermaGuru home">
            <span className="mark" aria-hidden="true">D</span>
            <span>
              DermaGuru
              <small>{tr("AI Skincare Advisor", "مستشار العناية بالبشرة")}</small>
            </span>
          </Link>
          <nav className="nav-links" aria-label="Primary">
            <Link href={ROUTES.live}>{tr("Live consultation", "استشارة مباشرة")}</Link>
            <Link href={ROUTES.pricing}>{tr("Pricing", "الأسعار")}</Link>
            <Link href={ROUTES.dictionary}>{tr("Dictionary", "قاموس البشرة")}</Link>
            <Link href={ROUTES.faq}>{tr("FAQ", "الأسئلة الشائعة")}</Link>
          </nav>
          <div className="nav-cta">
            <button
              type="button"
              className="langbtn"
              onClick={() => setLocale(isAr ? "en" : "ar")}
              aria-label={tr("Switch to Arabic", "التبديل إلى الإنجليزية")}
            >
              {isAr ? "EN" : "عربي"}
            </button>
            <Link href={ROUTES.login} className="btn btn-ghost btn-sm">
              {tr("Log in", "تسجيل الدخول")}
            </Link>
            <Link href={ROUTES.pricing} className="btn btn-ink btn-sm">
              {tr("Add to your store", "أضِفه إلى متجرك")}
            </Link>
          </div>
        </div>
      </header>

      {/* ===== HERO ===== */}
      <section className="hero">
        <span className="blob" style={{ width: 520, height: 520, background: "var(--teal-tint)", top: -120, right: -80 }} />
        <span className="blob" style={{ width: 420, height: 420, background: "var(--rose-tint)", bottom: -160, left: -120 }} />
        <div className="wrap hero-grid">
          <div className="reveal">
            <span className="kicker">
              <span className="dot" /> {tr("Skincare advisor — never medical advice", "مستشار العناية بالبشرة — ليس نصيحة طبية")}
            </span>
            <h1 className="display" style={{ margin: "22px 0 18px" }}>
              {tr("Beauty advice that", "نصائح جمالٍ")}
              <br />
              {tr("actually ", "")}
              <em>{tr("converts.", "تبيع فعلاً.")}</em>
            </h1>
            <p className="lead" style={{ maxWidth: 520 }}>
              {tr(
                "An embeddable AI advisor that understands a shopper's skin in English or Arabic — and recommends only the products you actually sell. Grounded, on-brand, and safe by design.",
                "مستشار ذكاء اصطناعي قابل للتضمين يفهم بشرة المتسوّق بالعربية أو الإنجليزية — ويوصي فقط بالمنتجات التي تبيعها. مبنيّ على كتالوجك، بهوية علامتك، وآمن بالتصميم.",
              )}
            </p>
            <div className="hero-actions">
              <a href="#voice" className="btn btn-ink">{tr("Talk to the advisor", "تحدّث إلى المستشار")}</a>
              <Link href={ROUTES.pricing} className="btn btn-ghost">{tr("Add to your store", "أضِفه إلى متجرك")}</Link>
            </div>
            <div className="trust">
              <span>✦ {tr("Catalog-grounded", "مبنيّ على الكتالوج")}</span>
              <span>✦ {tr("Arabic & RTL", "عربي وواجهة RTL")}</span>
              <span>✦ {tr("PDPL / GDPR-ready", "متوافق مع PDPL / GDPR")}</span>
            </div>
          </div>

          <div className="reveal" style={{ position: "relative" }}>
            <div className="hero-art">
              <img
                src="https://images.unsplash.com/photo-1556228578-8c89e6adf883?auto=format&fit=crop&w=1000&q=80"
                alt={tr("Editorial skincare scene", "مشهد تحريري للعناية بالبشرة")}
              />
            </div>
            <div className="panel hero-float">
              <div className="panel-head">
                <span className="av">C</span>
                <div>
                  <strong style={{ fontSize: ".95rem" }}>Cicabelle</strong>
                  <br />
                  <span className="muted" style={{ fontSize: ".74rem" }}>
                    {tr("Skincare advisor · online", "مستشار العناية · متصل")}
                  </span>
                </div>
              </div>
              <div className="panel-disc">{tr("Educational beauty guidance — not medical advice.", "إرشادات تجميلية تثقيفية — ليست نصيحة طبية.")}</div>
              <div className="panel-body" style={{ padding: 16 }}>
                <div className="bubble me" style={{ fontSize: ".84rem" }}>{tr("Dry skin & some dullness?", "بشرة جافة وبعض الباهتة؟")}</div>
                <div className="product" style={{ padding: 10, gridTemplateColumns: "54px 1fr" }}>
                  <div className="shot" style={{ width: 54, height: 54 }} />
                  <div>
                    <div className="step">{tr("Step 1 · Cleanse", "الخطوة 1 · تنظيف")}</div>
                    <h4 style={{ fontSize: ".88rem" }}>{tr("Gentle Gel Cleanser", "غسول جل لطيف")}</h4>
                    <div className="price" style={{ fontSize: ".86rem" }}>AED 79.00</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== VOICE CONCIERGE ===== */}
      <section id="voice" className="sec-cream">
        <div className="wrap">
          <div className="section-head" style={{ textAlign: "center", maxWidth: 680, margin: "0 auto" }}>
            <span className="eyebrow">{tr("Talk to it · live", "تحدّث إليه · مباشر")}</span>
            <h2>{tr("Just say what's bothering your skin.", "فقط قل ما الذي يزعج بشرتك.")}</h2>
            <p className="lead muted">
              {tr(
                "Tap the mic and speak. The advisor listens, asks the safety questions a good pharmacist would, then talks you through a routine built only from the store's catalog.",
                "اضغط الميكروفون وتحدّث. يستمع المستشار، ويسأل أسئلة السلامة التي يسألها الصيدلي الجيد، ثم يشرح لك روتيناً مبنياً فقط على كتالوج المتجر.",
              )}
            </p>
          </div>
          <VoiceAgent key={locale} initialLang={isAr ? "ar" : "en"} />
        </div>
      </section>

      {/* ===== TRUST STRIP ===== */}
      <div className="wrap" style={{ paddingBottom: 24 }}>
        <div className="hr" />
        <div className="logostrip">
          <span className="label">{tr("Trusted by modern beauty brands", "موثوق من علامات التجميل الحديثة")}</span>
          <div className="logos">
            <span>Cicabelle</span><span>Lumière</span><span>Sahar&nbsp;&amp;&nbsp;Co</span><span>Botanica</span><span>Maison&nbsp;Dérma</span>
          </div>
        </div>
        <div className="hr" />
      </div>

      {/* ===== TWO WAYS ===== */}
      <section>
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">{tr("One platform · two ways to grow", "منصّة واحدة · طريقتان للنمو")}</span>
            <h2>{tr("Own the advisor, or ride the traffic.", "امتلك المستشار، أو استفد من الزيارات.")}</h2>
            <p className="lead muted">
              {tr(
                "DermaGuru is both a white-label widget for your own store and a free public consultation that sends qualified shoppers — and sponsored placements — your way.",
                "ديرماغورو أداة white-label لمتجرك، واستشارة عامة مجانية تُرسل إليك متسوّقين مؤهّلين — وأماكن إعلانية مموّلة.",
              )}
            </p>
          </div>
          <div className="tiers">
            <div className="tier">
              <span className="badge badge-teal">{tr("Private widget · white-label", "أداة خاصة · white-label")}</span>
              <h3 style={{ fontSize: "1.9rem" }}>{tr("Your store, your advisor", "متجرك، مستشارك")}</h3>
              <p className="muted">
                {tr(
                  "Theme it to your brand, curate the catalog, and embed it in one line. It recommends only your products — no competitors, no noise.",
                  "خصّصه لهوية علامتك، نسّق الكتالوج، وضمّنه بسطر واحد. يوصي بمنتجاتك فقط — بلا منافسين ولا تشويش.",
                )}
              </p>
              <div className="bar"><i style={{ width: "100%" }} /></div>
              <Link href={ROUTES.pricing} className="btn btn-ink btn-block">{tr("See plans", "اطّلع على الباقات")}</Link>
            </div>
            <div className="tier feat">
              <span className="badge badge-gold">{tr("Public live-consultation", "استشارة عامة مباشرة")}</span>
              <h3 style={{ fontSize: "1.9rem" }}>{tr("A traffic magnet + demo", "مغناطيس زيارات + عرض حي")}</h3>
              <p className="muted">
                {tr(
                  "Our free public advisor answers thousands of skin questions and surfaces sponsored products you can bid on — clearly disclosed, always safety-gated.",
                  "مستشارنا العام المجاني يجيب على آلاف أسئلة البشرة ويعرض منتجات مموّلة يمكنك المزايدة عليها — مُفصح عنها بوضوح ودائماً ضمن بوابة أمان.",
                )}
              </p>
              <div className="bar"><i style={{ width: "78%" }} /></div>
              <Link href={ROUTES.live} className="btn btn-brass btn-block">{tr("Explore live consultation", "استكشف الاستشارة المباشرة")}</Link>
            </div>
          </div>
        </div>
      </section>

      {/* ===== HOW IT WORKS ===== */}
      <section className="sec-cream">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">{tr("How it works", "كيف يعمل")}</span>
            <h2>{tr("Concern in. Confident routine out.", "اطرح مشكلتك. احصل على روتين واثق.")}</h2>
          </div>
          <div className="grid g-4">
            <HowCard n="01" title={tr("Listens", "يستمع")} text={tr("Shopper describes their skin in natural language — Arabic or English, typed or spoken.", "يصف المتسوّق بشرته بلغة طبيعية — عربية أو إنجليزية، كتابةً أو صوتاً.")} />
            <HowCard n="02" title={tr("Screens", "يفحص")} text={tr("A deterministic safety gate runs first. Red flags are routed to “see a professional” — never sold to.", "تعمل بوابة أمان حاسمة أولاً. تُوجَّه العلامات التحذيرية إلى “مراجعة مختص” — دون أي بيع.")} />
            <HowCard n="03" title={tr("Grounds", "يؤسّس")} text={tr("Claude recommends only real SKUs retrieved from your catalog, with a short, honest “why”.", "يوصي كلود فقط بمنتجات حقيقية من كتالوجك، مع “سبب” قصير وصادق.")} />
            <HowCard n="04" title={tr("Converts", "يحوّل")} text={tr("A clean routine with AED pricing and one-tap add-to-cart. Every impression and click is attributed.", "روتين واضح بأسعار بالدرهم وإضافة للسلة بنقرة. كل ظهور ونقرة مُنسوبان.")} />
          </div>
        </div>
      </section>

      {/* ===== SAFETY ===== */}
      <section>
        <div className="wrap split2">
          <div>
            <span className="eyebrow">{tr("Safe by design", "آمن بالتصميم")}</span>
            <h2 style={{ fontSize: "clamp(2rem,4vw,3rem)", margin: "14px 0 16px" }}>
              {tr("An advisor, never", "مستشار، وليس")}
              <br />
              {tr("a diagnosis.", "تشخيصاً.")}
            </h2>
            <p className="lead muted">
              {tr(
                "Every turn passes a deterministic input gate and an output gate — so the AI can explain a routine, but can never diagnose, promise a cure, invent a product, or sell into a red flag.",
                "كل تفاعل يمرّ ببوابة إدخال وبوابة إخراج حاسمتين — فيمكن للذكاء الاصطناعي شرح الروتين، لكنه لا يشخّص ولا يعِد بعلاج ولا يخترع منتجاً ولا يبيع عند وجود علامة تحذيرية.",
              )}
            </p>
            <div className="stat-row" style={{ marginTop: 30 }}>
              <div><div className="stat">2-gate</div><div className="muted">{tr("input + output safety", "أمان الإدخال + الإخراج")}</div></div>
              <div><div className="stat">100%</div><div className="muted">{tr("catalog-grounded SKUs", "منتجات من الكتالوج")}</div></div>
              <div><div className="stat">EN · AR</div><div className="muted">{tr("bilingual, RTL-native", "ثنائي اللغة، RTL أصيل")}</div></div>
            </div>
          </div>
          <div className="panel" style={{ maxWidth: "none" }}>
            <div className="panel-head">
              <span className="av" style={{ background: "linear-gradient(140deg,var(--rose),var(--rose-dk))" }}>C</span>
              <div><strong style={{ fontSize: ".95rem" }}>Cicabelle</strong><br /><span className="muted" style={{ fontSize: ".74rem" }}>مستشار العناية بالبشرة</span></div>
            </div>
            <div className="panel-disc" style={{ background: "var(--rose-tint)", color: "var(--rose-dk)" }}>إرشادات تجميلية تثقيفية — ليست نصيحة طبية.</div>
            <div className="panel-body">
              <div className="bubble me rtl" dir="rtl" style={{ background: "var(--rose-tint)", color: "var(--rose-dk)" }}>بشرتي ملتهبة ومؤلمة منذ أيام</div>
              <div className="referral rtl" dir="rtl">
                <strong>قد يحتاج هذا إلى مراجعة مختص.</strong><br />
                يمكنني تقديم إرشادات تجميلية عامة فقط — يُفضّل مراجعة طبيب الجلدية.
              </div>
              <div className="bubble bot rtl" dir="rtl" style={{ marginRight: "auto" }}>يمكنني مشاركة نصائح عامة للعناية اليومية بالبشرة.</div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== SPONSORED MARKETPLACE ===== */}
      <section className="sec-ink">
        <div className="wrap split2">
          <div>
            <span className="eyebrow">{tr("Sponsored marketplace", "سوق الإعلانات المموّلة")}</span>
            <h2 style={{ fontSize: "clamp(2rem,4vw,3.1rem)", margin: "14px 0 16px" }}>
              {tr("Put your products in front of every skin question.", "ضع منتجاتك أمام كل سؤال عن البشرة.")}
            </h2>
            <p style={{ fontSize: "1.1rem", lineHeight: 1.65 }}>
              {tr(
                "The public consultation is a living demo with real reach. Bid for sponsored slots, set budgets and caps, and we'll place your SKUs — disclosed, grounded, and suppressed whenever a session is a safety red flag.",
                "الاستشارة العامة عرضٌ حيّ بوصول حقيقي. زايد على المساحات المموّلة، حدّد الميزانيات والحدود، وسنعرض منتجاتك — مُفصحاً عنها، مبنيّة على الكتالوج، ومحجوبة عند أي علامة تحذيرية.",
              )}
            </p>
            <Link href={ROUTES.pricing} className="btn btn-brass" style={{ marginTop: 26 }}>{tr("Start a campaign", "ابدأ حملة")}</Link>
          </div>
          <div className="grid" style={{ gap: 14 }}>
            <div className="product">
              <div className="shot rose" />
              <div>
                <span className="badge badge-gold">{tr("Sponsored", "مموّل")}</span>
                <h4 style={{ marginTop: 6 }}>{tr("Barrier Repair Cream", "كريم إصلاح الحاجز")}</h4>
                <span className="sub muted">{tr("Ceramides · fragrance-free", "سيراميدات · خالٍ من العطور")}</span>
              </div>
              <div className="price">AED 120</div>
            </div>
            <div className="product">
              <div className="shot" />
              <div>
                <h4>{tr("Vitamin C Glow Serum", "سيروم فيتامين C للإشراق")}</h4>
                <span className="sub muted">{tr("Brightening · AM", "تفتيح · صباحاً")}</span>
              </div>
              <div className="price">AED 145</div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== JOURNAL ===== */}
      <section>
        <div className="wrap">
          <div className="section-head journal-head">
            <div>
              <span className="eyebrow">{tr("The Journal", "المجلة")}</span>
              <h2>{tr("Skincare, grounded in evidence.", "عناية بالبشرة مبنيّة على الأدلّة.")}</h2>
            </div>
            <Link href={ROUTES.dictionary} className="link-underline">{tr("Read the Journal", "اقرأ المجلة")}</Link>
          </div>
          <div className="grid g-3">
            <JournalCard href={ROUTES.dictionary} badge={tr("Routines", "روتينات")} title={tr("The 4-step routine for dry, dull skin in a desert climate", "روتين من 4 خطوات للبشرة الجافة الباهتة في المناخ الصحراوي")} text={tr("What humidity does to your barrier — and the gentle actives that help.", "ما تفعله الرطوبة بحاجز بشرتك — والمكوّنات اللطيفة التي تساعد.")} img="https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?auto=format&fit=crop&w=1400&q=80" />
            <JournalCard href={ROUTES.dictionary} badge={tr("Ingredients", "مكوّنات")} title={tr("Niacinamide vs. vitamin C: which, when, and why not both at once", "النياسيناميد مقابل فيتامين C: أيّهما ومتى ولماذا ليس معاً")} text={tr("A calm, evidence-first guide to layering brighteners.", "دليل هادئ مبني على الأدلّة لتركيب مكوّنات التفتيح.")} img="https://images.unsplash.com/photo-1612817288484-6f916006741a?auto=format&fit=crop&w=1400&q=80" />
            <JournalCard href={ROUTES.dictionary} badge={tr("Arabic", "بالعربية")} title="روتين العناية بالبشرة للمناخ الحار" text="دليل لطيف ومبني على الأدلّة للبشرة الجافة." img="https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?auto=format&fit=crop&w=1400&q=80" rtl />
          </div>
        </div>
      </section>

      {/* ===== RITUAL BAND ===== */}
      <section style={{ paddingBottom: 0 }}>
        <div className="wrap">
          <div className="fullbleed tall">
            <img src="https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&w=1400&q=80" alt="" />
            <div style={{ maxWidth: 560 }}>
              <span className="eyebrow" style={{ color: "var(--brass-2)" }}>{tr("The ritual", "الطقس")}</span>
              <h2 className="serif" style={{ fontSize: "clamp(2rem,4vw,3rem)", marginTop: 12 }}>
                {tr("An advisor as considered", "مستشار بعناية")}
                <br />
                {tr("as your shelf.", "رفّك.")}
              </h2>
            </div>
          </div>
        </div>
      </section>

      {/* ===== CLOSING CTA ===== */}
      <section>
        <div className="wrap">
          <div className="cta-teal">
            <h2>{tr("Turn skin concerns into confident purchases.", "حوّل هموم البشرة إلى قرارات شراء واثقة.")}</h2>
            <p>{tr("Launch the advisor on your store in minutes, or claim a sponsored slot in the public consultation.", "أطلق المستشار على متجرك في دقائق، أو احجز مساحة مموّلة في الاستشارة العامة.")}</p>
            <div className="cta-actions">
              <Link href={ROUTES.pricing} className="btn btn-white">{tr("Add to your store", "أضِفه إلى متجرك")}</Link>
              <Link href={ROUTES.live} className="btn btn-ghost-light">{tr("See it live", "شاهده مباشرة")}</Link>
            </div>
          </div>
        </div>
      </section>

      {/* ===== FOOTER ===== */}
      <footer className="foot">
        <div className="wrap">
          <div>
            <Link className="brand" href="/">
              <span className="mark" aria-hidden="true">D</span>
              <span>DermaGuru<small>{tr("AI Skincare Advisor", "مستشار العناية بالبشرة")}</small></span>
            </Link>
            <p style={{ color: "var(--faint)", maxWidth: 280, marginTop: 16, fontSize: ".92rem" }}>
              {tr("The bilingual AI skincare advisor for modern beauty brands. An advisor — never medical advice.", "مستشار العناية بالبشرة بالذكاء الاصطناعي وثنائي اللغة لعلامات التجميل الحديثة. مستشار — وليس نصيحة طبية.")}
            </p>
          </div>
          <FooterCol title={tr("Product", "المنتج")} links={[[tr("Live consultation", "استشارة مباشرة"), ROUTES.live], [tr("Pricing", "الأسعار"), ROUTES.pricing], [tr("Skin dictionary", "قاموس البشرة"), ROUTES.dictionary], [tr("FAQ", "الأسئلة الشائعة"), ROUTES.faq]]} />
          <FooterCol title={tr("Company", "الشركة")} links={[[tr("Live consultation", "استشارة مباشرة"), ROUTES.live], [tr("Pricing", "الأسعار"), ROUTES.pricing], [tr("Log in", "تسجيل الدخول"), ROUTES.login]]} />
          <FooterCol title={tr("Legal", "قانوني")} links={[[tr("Privacy (PDPL/GDPR)", "الخصوصية (PDPL/GDPR)"), ROUTES.privacy], [tr("Terms", "الشروط"), ROUTES.terms], [tr("Not medical advice", "ليست نصيحة طبية"), ROUTES.faq]]} />
        </div>
        <div className="wrap foot-base">
          <span>© 2026 DermaGuru. {tr("All rights reserved.", "جميع الحقوق محفوظة.")}</span>
          <span>{tr("Educational beauty guidance — not a medical device.", "إرشادات تجميلية تثقيفية — ليست جهازاً طبياً.")}</span>
        </div>
      </footer>
    </div>
  );
}

function HowCard({ n, title, text }: { n: string; title: string; text: string }) {
  return (
    <div className="card">
      <div className="ic">{n}</div>
      <h3>{title}</h3>
      <p className="muted">{text}</p>
    </div>
  );
}

function JournalCard({ href, badge, title, text, img, rtl }: { href: string; badge: string; title: string; text: string; img: string; rtl?: boolean }) {
  return (
    <Link className="editorial" href={href}>
      <div className="ph"><img src={img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>
      <div className="bd" {...(rtl ? { dir: "rtl" as const } : {})}>
        <span className="badge badge-teal">{badge}</span>
        <h3 style={{ margin: "12px 0 6px", fontSize: "1.3rem" }}>{title}</h3>
        <p className="muted">{text}</p>
      </div>
    </Link>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h5>{title}</h5>
      {links.map(([label, href]) => (
        <Link href={href} key={label + href}>{label}</Link>
      ))}
    </div>
  );
}
