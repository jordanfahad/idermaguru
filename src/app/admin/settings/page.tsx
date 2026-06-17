import { AdminNav } from "@/components/admin-nav";
import { CUSTOMER_DISCLAIMER, SPONSORED_DISCLOSURE } from "@/domain/skincare";
import { seedTenant } from "@/data/seed-catalog";

export default function SettingsPage() {
  return (
    <main className="plain-page">
      <AdminNav />
      <header>
        <p className="eyebrow">Tenant settings</p>
        <h1>Widget configuration.</h1>
      </header>
      <section className="dashboard-panel settings-form">
        <label>
          Brand name
          <input defaultValue={seedTenant.name} />
        </label>
        <label>
          Domain
          <input defaultValue={seedTenant.domain} />
        </label>
        <label>
          Disclosure text
          <textarea defaultValue={CUSTOMER_DISCLAIMER} />
        </label>
        <label>
          Brand voice
          <textarea defaultValue={seedTenant.brandVoice ?? ""} />
        </label>
        <label>
          Widget color/theme
          <select defaultValue="light">
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label>
          Data retention
          <select defaultValue="30">
            <option value="30">Delete uploaded images after 30 days</option>
            <option value="14">Delete uploaded images after 14 days</option>
            <option value="7">Delete uploaded images after 7 days</option>
          </select>
        </label>
        <label className="consent-box">
          <input defaultChecked type="checkbox" />
          Sponsored recommendations enabled
        </label>
        <p className="privacy-note">{SPONSORED_DISCLOSURE}</p>
      </section>
    </main>
  );
}
