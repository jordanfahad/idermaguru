import { AdminNav } from "@/components/admin-nav";
import { SponsoredCuration } from "@/components/sponsored-curation";
import { listTenantProducts } from "@/services/catalog";

export const dynamic = "force-dynamic";

export default async function SponsoredAdminPage() {
  const products = await listTenantProducts("ai-derma-guru");

  return (
    <main className="plain-page">
      <AdminNav />
      <header>
        <p className="eyebrow">Sponsored recommendations</p>
        <h1>Curate unique merchant result sets.</h1>
        <p className="lead">
          Build a sponsored routine preview, keep the disclosure visible, and copy a widget embed for Shopify or any
          merchant website.
        </p>
      </header>
      <SponsoredCuration products={products} />
    </main>
  );
}
