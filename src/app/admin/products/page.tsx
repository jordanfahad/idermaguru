import { AdminNav } from "@/components/admin-nav";
import { AdminProductManager } from "@/components/admin-product-manager";
import { listTenantProducts } from "@/services/catalog";

export const dynamic = "force-dynamic";

export default async function AdminProductsPage() {
  const products = await listTenantProducts("ai-derma-guru");

  return (
    <main className="plain-page">
      <AdminNav />
      <header>
        <p className="eyebrow">Catalog</p>
        <h1>Approved OTC products.</h1>
        <p className="lead">
          Only products in this tenant-scoped catalog can be recommended by the assistant.
        </p>
      </header>
      <AdminProductManager initialProducts={products} />
    </main>
  );
}
