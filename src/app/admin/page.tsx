import { AdminNav } from "@/components/admin-nav";
import { seedTenant } from "@/data/seed-catalog";

export default function AdminPage() {
  return (
    <main className="plain-page">
      <AdminNav />
      <header>
        <p className="eyebrow">Merchant portal</p>
        <h1>{seedTenant.name}</h1>
        <p className="lead">
          Manage catalog eligibility, safety-safe recommendation settings, sponsored controls, and
          funnel attribution for AI Derma Guru merchant widgets.
        </p>
      </header>
      <section className="dashboard-grid">
        <div className="metric">
          <strong>Multi-tenant</strong>
          <span>Tenant-scoped catalog and analytics</span>
        </div>
        <div className="metric">
          <strong>Safety first</strong>
          <span>Deterministic triage before selling</span>
        </div>
        <div className="metric">
          <strong>Stripe-ready</strong>
          <span>Plan model stubbed for billing</span>
        </div>
      </section>
    </main>
  );
}
