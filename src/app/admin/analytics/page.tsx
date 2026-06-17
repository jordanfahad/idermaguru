import { AdminNav } from "@/components/admin-nav";
import { MerchantAnalyticsSelect } from "@/components/merchant-analytics-select";
import { seedTenant } from "@/data/seed-catalog";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getAnalyticsSummary } from "@/services/analytics";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ merchant?: string }>;
}) {
  const merchants = await getMerchantOptions();
  const params = await searchParams;
  const selectedMerchant = params.merchant ?? "all";
  const selectedTenantId = selectedMerchant === "all" ? seedTenant.id : selectedMerchant;
  const analytics = await getAnalyticsSummary(selectedTenantId);

  return (
    <main className="plain-page">
      <AdminNav />
      <header className="analytics-header">
        <div>
          <p className="eyebrow">Analytics</p>
          <h1>Traffic and conversion attribution.</h1>
        </div>
        <MerchantAnalyticsSelect options={merchants} />
      </header>
      <section className="dashboard-grid">
        <Metric label="Sessions" value={analytics.sessions} />
        <Metric label="Completed consultations" value={analytics.completedConsultations} />
        <Metric label="Red-flag referrals" value={analytics.redFlagReferrals} />
        <Metric label="Recommendations" value={analytics.recommendations} />
        <Metric label="Product impressions" value={analytics.productImpressions} />
        <Metric label="Product clicks" value={analytics.productClicks} />
        <Metric label="CTR" value={`${(analytics.ctr * 100).toFixed(1)}%`} />
        <Metric label="Add-to-cart" value={analytics.addToCartEvents} />
        <Metric label="Purchases" value={analytics.purchases} />
        <Metric label="Revenue" value={`${analytics.attributedRevenue.toFixed(2)} AED`} />
        <Metric label="Revenue / consult" value={`${analytics.revenuePerConsultation.toFixed(2)} AED`} />
      </section>
      <section className="dashboard-panel">
        <h2>Conversion funnel</h2>
        <div className="table-like">
          {analytics.conversionFunnel.map((item) => (
            <div className="table-row" key={item.label}>
              <strong>{item.label}</strong>
              <span>{item.value}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

async function getMerchantOptions() {
  const options = [{ id: "all", label: "AI Derma Guru / all merchants" }];
  const supabase = getSupabaseAdmin();
  if (!supabase) return [...options, { id: "merchant_powder_beauty", label: "Powder Beauty" }];

  const { data } = await supabase
    .from("partner_domains")
    .select("id, display_name, domain")
    .order("created_at", { ascending: false });

  const merchantOptions =
    data?.map((merchant) => ({
      id: String(merchant.id),
      label: merchant.display_name || merchant.domain,
    })) ?? [];

  if (!merchantOptions.some((merchant) => /powder/i.test(merchant.label))) {
    merchantOptions.push({ id: "merchant_powder_beauty", label: "Powder Beauty" });
  }

  return [...options, ...merchantOptions];
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
