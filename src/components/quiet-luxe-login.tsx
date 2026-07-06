"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/browser";
import { getBrowserSiteUrl } from "@/lib/site-url";
import "./dg-home.css";
import "./dg-home-extra.css";

/**
 * Quiet-luxe split-screen login. Preserves the real auth flow exactly — a
 * Supabase passwordless magic link (signInWithOtp → /auth/callback?next=/dashboard).
 * Only the presentation changes; the prototype's mock password/plan fields are
 * intentionally dropped since they were never wired.
 */
export function QuietLuxeLogin() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(null);
    setLoading(true);

    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setStatus("Supabase Auth is not connected yet. Add project env vars after creating the database.");
      setLoading(false);
      return;
    }

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${getBrowserSiteUrl()}/auth/callback?next=/dashboard` },
    });

    setStatus(error ? error.message : "Check your inbox for the magic login link.");
    setLoading(false);
  }

  return (
    <div className="dg">
      <div className="auth">
        {/* photographic brand panel */}
        <aside className="auth-aside">
          <div
            className="fullbleed tall"
            style={{
              borderRadius: 0,
              width: "100%",
              minHeight: "100vh",
              alignItems: "stretch",
              flexDirection: "column",
              justifyContent: "space-between",
              padding: "clamp(32px,4vw,56px)",
            }}
          >
            <img
              src="https://images.unsplash.com/photo-1612817288484-6f916006741a?auto=format&fit=crop&w=1400&q=80"
              alt="Editorial skincare still life"
            />
            <Link className="brand" href="/" style={{ color: "#fff", position: "relative", zIndex: 1 }}>
              <span className="mark">D</span>
              <span>DermaGuru<small style={{ color: "rgba(255,255,255,.6)" }}>AI Skincare Advisor</small></span>
            </Link>
            <div style={{ position: "relative", zIndex: 1, maxWidth: 460 }}>
              <h2 className="serif" style={{ color: "#fff", fontSize: "clamp(2rem,3.4vw,3rem)", lineHeight: 1.08, letterSpacing: "-.01em" }}>
                Turn skin concerns into confident routines.
              </h2>
              <p style={{ color: "rgba(255,255,255,.82)", fontSize: "1.02rem", lineHeight: 1.6, marginTop: 18, maxWidth: 400 }}>
                An embeddable advisor that understands a shopper&apos;s skin in English or Arabic — and recommends only the products you actually sell.
              </p>
              <div className="trust" style={{ marginTop: 28 }}>
                <span style={{ background: "rgba(255,255,255,.14)", color: "#fff" }}>✦ Catalog-grounded</span>
                <span style={{ background: "rgba(255,255,255,.14)", color: "#fff" }}>✦ Arabic &amp; RTL</span>
                <span style={{ background: "rgba(255,255,255,.14)", color: "#fff" }}>✦ Not medical advice</span>
              </div>
            </div>
          </div>
        </aside>

        {/* auth card */}
        <main className="auth-main">
          <div className="auth-bar">
            <Link className="brand" href="/">
              <span className="mark">D</span>
              <span>DermaGuru<small>AI Skincare Advisor</small></span>
            </Link>
            <Link href="/" className="muted" style={{ fontSize: ".86rem" }}>← Back to site</Link>
          </div>

          <div className="auth-card">
            <div className="inner">
              <span className="eyebrow">Get started</span>
              <h1 className="serif" style={{ fontSize: "clamp(1.9rem,3.4vw,2.6rem)", margin: "12px 0 6px" }}>
                Sign in to your store advisor
              </h1>
              <p className="muted" style={{ fontSize: ".96rem" }}>
                We&apos;ll email you a secure magic link — no password to remember. New here? It creates your account automatically.
              </p>

              <form onSubmit={submit} style={{ marginTop: 18 }}>
                <label className="field">
                  <span>Work email</span>
                  <input
                    type="email"
                    name="email"
                    placeholder="you@yourbrand.com"
                    autoComplete="email"
                    inputMode="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </label>
                <button type="submit" className="btn btn-ink btn-block" style={{ marginTop: 22 }} disabled={loading}>
                  {loading ? "Sending…" : "Send magic link"}
                </button>
                {status ? (
                  <p className="muted" style={{ fontSize: ".86rem", marginTop: 14 }}>{status}</p>
                ) : null}
                <p className="muted" style={{ fontSize: ".78rem", marginTop: 14, lineHeight: 1.45 }}>
                  Stripe billing runs in TEST mode during onboarding — you won&apos;t be charged.
                </p>
              </form>
            </div>
          </div>

          <div className="auth-foot">
            <span>© 2026 DermaGuru</span>
            <span>Educational beauty guidance — not medical advice.</span>
          </div>
        </main>
      </div>
    </div>
  );
}
