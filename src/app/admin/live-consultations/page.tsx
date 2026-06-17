import { AdminNav } from "@/components/admin-nav";
import { LiveConsultationAdmin } from "@/components/live-consultation-admin";
import { getLiveConsultationConfig } from "@/services/live-consultations";

export const dynamic = "force-dynamic";

export default async function LiveConsultationsAdminPage() {
  const config = await getLiveConsultationConfig("live-consultation-1");
  return (
    <main className="plain-page">
      <AdminNav />
      <header>
        <p className="eyebrow">Live consultation pages</p>
        <h1>Super-admin campaign control.</h1>
        <p className="lead">
          Set the unique URL, number of vendors, partner weight percentages, and curated products or bundles for each
          standalone consultation page.
        </p>
      </header>
      <LiveConsultationAdmin config={config} />
    </main>
  );
}
