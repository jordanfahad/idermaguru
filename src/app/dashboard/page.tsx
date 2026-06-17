import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { getSupabaseAdmin } from "@/lib/supabase/server";

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
    <main className="plain-page">
      <header>
        <Link className="share-link" href="/">
          <ArrowLeft size={16} />
          Back to guru
        </Link>
        <p className="eyebrow">Partner dashboard</p>
        <h1>Traffic pushed to partner domains.</h1>
        <p className="lead">
          Track recommendation pages, outbound product clicks, and the products getting shopper
          intent. Once Supabase auth is connected, each customer can see their own domain metrics.
        </p>
      </header>

      <section className="dashboard-grid">
        <div className="metric">
          <strong>{totalClicks}</strong>
          <span>Tracked clicks</span>
        </div>
        <div className="metric">
          <strong>{generatedPages}</strong>
          <span>SEO pages</span>
        </div>
        <div className="metric">
          <strong>{uniqueProducts}</strong>
          <span>Products clicked</span>
        </div>
      </section>

      <section className="dashboard-panel">
        <div className="result-heading">
          <div>
            <p className="eyebrow">Outbound intent</p>
            <h2>Top AI Derma Guru products</h2>
          </div>
          <a className="share-link" href="https://aiderma.guru" target="_blank" rel="noreferrer">
            AI Derma Guru
            <ExternalLink size={16} />
          </a>
        </div>

        <div className="table-like">
          {metrics.length ? (
            metrics.map((metric) => (
              <div className="table-row" key={metric.product_id}>
                <strong>{metric.product_name}</strong>
                <span>{metric.clicks} clicks</span>
                <span>{new Date(metric.last_click).toLocaleDateString()}</span>
              </div>
            ))
          ) : (
            <p className="safety-note">
              No Supabase click data yet. Deploy with Supabase environment variables and tracked
              outbound clicks will appear here.
            </p>
          )}
        </div>
      </section>
    </main>
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
