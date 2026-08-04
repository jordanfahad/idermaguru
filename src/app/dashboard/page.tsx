import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { seedTenant } from "@/data/seed-catalog";
import { getConsoleAccess, type ConsoleAccess } from "@/lib/merchant-access";
import { getTenantBySlug } from "@/services/catalog";
import { withTenant } from "@/lib/tenant-context";
import "@/components/dg-home.css";
import "@/components/dg-home-extra.css";

export const metadata: Metadata = {
  title: "Overview — Merchant dashboard | AI Derma Guru",
  description: "Your DermaGuru merchant dashboard: recommendation pages, outbound product clicks, and top products.",
  robots: { index: false, follow: false },
};

// One store's commercial figures, keyed to whoever is signed in. Reading the
// session already forces this route dynamic; saying so here means a later edit
// that moves the cookie read elsewhere cannot quietly turn the console back
// into a static page served to everyone from a CDN.
export const dynamic = "force-dynamic";

type ProductMetric = {
  productId: string;
  productName: string;
  clicks: number;
  lastClick: string;
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ merchant?: string }>;
}) {
  const access = await getConsoleAccess();
  // Before any data access, and outside any try/catch: redirect() signals Next
  // by throwing, so a catch around it would swallow the signal and carry on
  // rendering the console for a signed-out visitor.
  //
  // /login, not /admin/login: this is the merchant console, and the magic link
  // is how a merchant gets in. Sending them to the staff form was the whole of
  // the dead end. Staff signing in at /admin/login still arrive here fine.
  if (!access) redirect("/login?next=/dashboard");

  const params = await searchParams;
  // Which store's figures. super_admin administers every one, so it may name
  // the one it wants to look at. A merchant is bound to exactly one by
  // MERCHANT_USERS and is shown that one, whatever the URL asks for — an
  // honoured selector would be a way to read a competitor's store by typing
  // its id.
  const tenantId = await resolveTenantId(access, params.merchant);

  const metrics = await getMetrics(tenantId);
  const totalClicks = metrics.reduce((sum, metric) => sum + metric.clicks, 0);
  const uniqueProducts = metrics.length;
  const generatedPages = await getRecommendationCount(tenantId);

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
                <div className="lbl">Recommendations</div>
                <div className="val">{generatedPages.toLocaleString()}</div>
                <div className="delta" style={{ color: "var(--muted)" }}>Routines generated for your shoppers</div>
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
                      <tr key={metric.productId}>
                        <td>
                          <strong style={{ color: "var(--ink)", fontWeight: 600 }}>{metric.productName}</strong>
                        </td>
                        <td style={{ textAlign: "right" }}>{metric.clicks}</td>
                        <td style={{ textAlign: "right" }}>{new Date(metric.lastClick).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="muted" style={{ fontSize: ".9rem" }}>
                  No outbound clicks tracked yet. Once shoppers follow a recommendation to a product, your top products appear here.
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
  data-mode="voice"
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

/**
 * Top products by outbound intent for one store.
 *
 * A click becomes a PRODUCT_CLICK event in /api/r/[recommendationItemId], which
 * is the only place the owning tenant is known. The legacy Supabase
 * `outbound_clicks` table this page read before has no tenant column at all —
 * and nothing in the app writes to it any more — so the console was showing
 * every merchant the product intent of every other merchant.
 *
 * The 500-row window is the one the page has always used: recent clicks are what
 * a merchant acts on, and it keeps the in-memory grouping cheap.
 */
/**
 * The tenant id whose figures this visitor is entitled to.
 *
 * A merchant bound to a slug is resolved to that store's id; if the slug names
 * no tenant they are given the default rather than a page of somebody else's
 * numbers, because a typo in an env var must not become a data leak.
 */
async function resolveTenantId(access: ConsoleAccess, requested: string | undefined): Promise<string> {
  if (access.tenantSlug) {
    const tenant = await getTenantBySlug(access.tenantSlug);
    return tenant?.id ?? seedTenant.id;
  }
  return access.superAdmin && requested ? requested : seedTenant.id;
}

async function getMetrics(tenantId: string): Promise<ProductMetric[]> {
  const clicks = await withTenant(tenantId, (tx) =>
    tx.event.findMany({
      where: { tenantId, type: "PRODUCT_CLICK", productId: { not: null } },
      select: { productId: true, createdAt: true, product: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
  );

  const grouped = new Map<string, ProductMetric>();

  for (const click of clicks ?? []) {
    if (!click.productId) continue;
    const current = grouped.get(click.productId);
    grouped.set(click.productId, {
      productId: click.productId,
      // A product deleted since the click leaves the event pointing at nothing;
      // showing the id beats dropping the click out of the totals.
      productName: click.product?.name ?? click.productId,
      clicks: (current?.clicks ?? 0) + 1,
      // Newest first, so the first row seen for a product is its last click.
      lastClick: current?.lastClick ?? click.createdAt.toISOString(),
    });
  }

  return Array.from(grouped.values()).sort((a, b) => b.clicks - a.clicks).slice(0, 25);
}

async function getRecommendationCount(tenantId: string) {
  const count = await withTenant(tenantId, (tx) => tx.recommendation.count({ where: { tenantId } }));
  return count ?? 0;
}
