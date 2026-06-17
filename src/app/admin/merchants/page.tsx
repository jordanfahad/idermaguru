import { AdminNav } from "@/components/admin-nav";
import { MerchantManager } from "@/components/merchant-manager";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function MerchantsPage() {
  const supabase = getSupabaseAdmin();
  const { data } = supabase
    ? await supabase.from("partner_domains").select("id, display_name, domain, owner_id").order("created_at", { ascending: false })
    : { data: [] };

  return (
    <main className="plain-page">
      <AdminNav />
      <header>
        <p className="eyebrow">Super admin</p>
        <h1>Merchant accounts.</h1>
        <p className="lead">
          Create merchant accounts, assign domains, and decide whether product data comes from CSV upload, manual
          curation, or a website fallback.
        </p>
      </header>
      <MerchantManager initialMerchants={data ?? []} />
    </main>
  );
}
