import type { Metadata } from "next";
import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import "@/components/dg-home.css";
import "@/components/dg-home-extra.css";

export const metadata: Metadata = {
  title: "Overview — Merchant dashboard | AI Derma Guru",
  description: "Your DermaGuru merchant dashboard: recommendation pages, outbound product clicks, and top products.",
};

type ProductMetric = {
  product_id: string;
  product_name: string;
  clicks: number;
  last_click: string;
};

export default async function DashboardPage() {
  const metrics = await getMetrics();
  const totalClicks = metrics.reduce((sum, metric) => sum + Number(metric.clicks), 0);
  const uniqueProducts = metrics.length;
  const generatedPages = await getRecommendationCount();

  return (
    <div className="dg">
      <div className="app">
        {/* SIDEBAR */}
        <aside className="side">
          <Link className="brand" href="/">
            <span className="mark" aria-hidden="true">D</span>
            <span>DermaGuru<small>Merchant Console</small></span>
          </Link>

          <div className="seg">Merchant</div>
          <Link href="/dashboard" className="active" aria-current="page">Overview</Link>
          <Link href="/live-consultation-1">Live widget</Link>
          <Link href="/pricing">Billing &amp; plan</Link>

          <div className="seg">Platform</div>
          <Link href="/admin">Admin console</Link>
          <Link href="/faq">Help &amp; FAQ</Link>

          <div className="spacer" />

          <Link href="/pricing" style={{ background: "rgba(255,255,255,.05)", gap: 12 }}>
            <span
              style={{
                width: 30, height: 30, borderRadius: 9, flex: "0 0 auto", display: "grid", placeItems: "center",
                color: "#fff", fontFamily: "var(--serif)", fontSize: ".95rem",
                background: "linear-gradient(140deg,var(--teal),var(--teal-dk))",
              }}
            >
              M
            </span>
            <span style={{ lineHeight: 1.25, minWidth: 0 }}>
              <strong style={{ color: "#fff", fontWeight: 600, fontSize: ".86rem", display: "block" }}>Your store</strong>
              <small style={{ color: "rgba(255,255,255,.5)", fontSize: ".72rem" }}>Merchant account</small>
            </span>
          </Link>
        </aside>

        {/* MAIN */}
        <main className="main">
          <div className="topbar">
            <h1>Overview</h1>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className="badge badge-teal">Live</span>
              <Link href="/live-consultation-1" className="btn btn-ink btn-sm">View live widget</Link>
            </div>
          </div>

          <div className="content">
            <div className="metrics">
              <div className="metric">
                <div className="lbl">Tracked clicks</div>
                <div className="val">{totalClicks.toLocaleString()}</div>
                <div className="delta" style={{ color: "var(--muted)" }}>Outbound product intent</div>
              </div>
              <div className="metric">
                <div className="lbl">SEO pages</div>
                <div className="val">{generatedPages.toLocaleString()}</div>
                <div className="delta" style={{ color: "var(--muted)" }}>Generated recommendation pages</div>
              </div>
              <div className="metric">
                <div className="lbl">Products clicked</div>
                <div className="val">{uniqueProducts.toLocaleString()}</div>
                <div className="delta" style={{ color: "var(--muted)" }}>Distinct products with intent</div>
              </div>
            </div>

            <div className="surface" style={{ marginBottom: 22 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 18 }}>
                <h3>Top products by outbound intent</h3>
                <Link href="/admin/analytics" className="muted" style={{ fontSize: ".82rem", borderBottom: "1px solid var(--brass)", paddingBottom: 1 }}>
                  View analytics
                </Link>
              </div>

              {metrics.length ? (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th style={{ textAlign: "right" }}>Clicks</th>
                      <th style={{ textAlign: "right" }}>Last click</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.map((metric) => (
                      <tr key={metric.product_id}>
                        <td>
                          <strong style={{ color: "var(--ink)", fontWeight: 600 }}>{metric.product_name}</strong>
                        </td>
                        <td style={{ textAlign: "right" }}>{metric.clicks}</td>
                        <td style={{ textAlign: "right" }}>{new Date(metric.last_click).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="muted" style={{ fontSize: ".9rem" }}>
                  No Supabase click data yet. Once outbound clicks are tracked, your top products appear here.
                </p>
              )}
            </div>

            <div className="surface">
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
                <h3>Your widget</h3>
                <span className="badge badge-safe">One-line embed</span>
              </div>
              <code
                style={{
                  display: "block", background: "var(--ink)", color: "#EDE7DD", borderRadius: "var(--r-sm)",
                  padding: "13px 15px", fontFamily: "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
                  fontSize: ".74rem", lineHeight: 1.55, overflowX: "auto", whiteSpace: "pre",
                }}
              >{`<script async src="https://idermaguru.com/dermaguru-widget.js"
  data-tenant="your-store"
  data-primary="#1F6F5C"
  data-locale="en"></script>`}</code>
              <p className="muted" style={{ fontSize: ".78rem", marginTop: 14, lineHeight: 1.5 }}>
                Paste once into your storefront theme. The advisor themes to your brand and recommends only your catalog.
              </p>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

async function getMetrics(): Promise<ProductMetric[]> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];

  const { data } = await supabase
    .from("outbound_clicks")
    .select("product_id, product_name, created_at")
    .order("created_at", { ascending: false })
    .limit(500);

  const grouped = new Map<string, ProductMetric>();

  for (const click of data ?? []) {
    const current = grouped.get(click.product_id);
    grouped.set(click.product_id, {
      product_id: click.product_id,
      product_name: click.product_name,
      clicks: (current?.clicks ?? 0) + 1,
      last_click: current?.last_click ?? click.created_at,
    });
  }

  return Array.from(grouped.values()).sort((a, b) => b.clicks - a.clicks).slice(0, 25);
}

async function getRecommendationCount() {
  const supabase = getSupabaseAdmin();
  if (!supabase) return 0;

  const { count } = await supabase
    .from("recommendations")
    .select("slug", { count: "exact", head: true });

  return count ?? 0;
}
