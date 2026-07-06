"use client";

import Link from "next/link";
import { createContext, useContext, useState, type ReactNode } from "react";
import "../dg-home.css";
import "../dg-home-extra.css";

/**
 * Shared chrome for every quiet-luxe page (nav + footer + EN/AR toggle), scoped
 * under `.dg`. Page content goes as children and reads the locale via useDg().
 * The homepage keeps its own inline copy of this markup, deployed and verified —
 * this shell drives the remaining pages.
 */

export const DG_ROUTES = {
  live: "/live-consultation-1",
  pricing: "/pricing",
  faq: "/faq",
  dictionary: "/dictionary",
  login: "/login",
  privacy: "/privacy-policy",
  terms: "/terms-of-use",
};

type Tr = (en: string, ar: string) => string;
const DgCtx = createContext<{ isAr: boolean; tr: Tr }>({ isAr: false, tr: (en) => en });
export function useDg() {
  return useContext(DgCtx);
}

export function DgShell({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<"en" | "ar">("en");
  const isAr = locale === "ar";
  const tr: Tr = (en, ar) => (isAr ? ar : en);

  return (
    <DgCtx.Provider value={{ isAr, tr }}>
      <div className="dg" dir={isAr ? "rtl" : "ltr"}>
        <header className="nav">
          <div className="wrap">
            <Link className="brand" href="/" aria-label="DermaGuru home">
              <span className="mark" aria-hidden="true">D</span>
              <span>DermaGuru<small>{tr("AI Skincare Advisor", "مستشار العناية بالبشرة")}</small></span>
            </Link>
            <nav className="nav-links" aria-label="Primary">
              <Link href={DG_ROUTES.live}>{tr("Live consultation", "استشارة مباشرة")}</Link>
              <Link href={DG_ROUTES.pricing}>{tr("Pricing", "الأسعار")}</Link>
              <Link href={DG_ROUTES.dictionary}>{tr("Dictionary", "قاموس البشرة")}</Link>
              <Link href={DG_ROUTES.faq}>{tr("FAQ", "الأسئلة الشائعة")}</Link>
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
              <Link href={DG_ROUTES.login} className="btn btn-ghost btn-sm">{tr("Log in", "تسجيل الدخول")}</Link>
              <Link href={DG_ROUTES.pricing} className="btn btn-ink btn-sm">{tr("Add to your store", "أضِفه إلى متجرك")}</Link>
            </div>
          </div>
        </header>

        {children}

        <footer className="foot">
          <div className="wrap">
            <div>
              <Link className="brand" href="/">
                <span className="mark" aria-hidden="true">D</span>
                <span>DermaGuru<small>{tr("AI Skincare Advisor", "مستشار العناية بالبشرة")}</small></span>
              </Link>
              <p style={{ color: "var(--faint)", maxWidth: 280, marginTop: 16, fontSize: ".92rem" }}>
                {tr(
                  "The bilingual AI skincare advisor for modern beauty brands. An advisor — never medical advice.",
                  "مستشار العناية بالبشرة بالذكاء الاصطناعي وثنائي اللغة لعلامات التجميل الحديثة. مستشار — وليس نصيحة طبية.",
                )}
              </p>
            </div>
            <FooterCol
              title={tr("Product", "المنتج")}
              links={[
                [tr("Live consultation", "استشارة مباشرة"), DG_ROUTES.live],
                [tr("Pricing", "الأسعار"), DG_ROUTES.pricing],
                [tr("Skin dictionary", "قاموس البشرة"), DG_ROUTES.dictionary],
                [tr("FAQ", "الأسئلة الشائعة"), DG_ROUTES.faq],
              ]}
            />
            <FooterCol
              title={tr("Company", "الشركة")}
              links={[
                [tr("Live consultation", "استشارة مباشرة"), DG_ROUTES.live],
                [tr("Pricing", "الأسعار"), DG_ROUTES.pricing],
                [tr("Log in", "تسجيل الدخول"), DG_ROUTES.login],
              ]}
            />
            <FooterCol
              title={tr("Legal", "قانوني")}
              links={[
                [tr("Privacy (PDPL/GDPR)", "الخصوصية (PDPL/GDPR)"), DG_ROUTES.privacy],
                [tr("Terms", "الشروط"), DG_ROUTES.terms],
                [tr("Not medical advice", "ليست نصيحة طبية"), DG_ROUTES.faq],
              ]}
            />
          </div>
          <div className="wrap foot-base">
            <span>© 2026 DermaGuru. {tr("All rights reserved.", "جميع الحقوق محفوظة.")}</span>
            <span>{tr("Educational beauty guidance — not a medical device.", "إرشادات تجميلية تثقيفية — ليست جهازاً طبياً.")}</span>
          </div>
        </footer>
      </div>
    </DgCtx.Provider>
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
