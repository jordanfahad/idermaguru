import { AdminNav } from "@/components/admin-nav";

export default function ProductImportPage() {
  return (
    <main className="plain-page">
      <AdminNav />
      <header>
        <p className="eyebrow">CSV import</p>
        <h1>Import merchant products.</h1>
        <p className="lead">
          Upload a CSV with product safety metadata, approved claims, concern tags, and sponsored
          settings. Inputs are sanitized server-side before creation.
        </p>
      </header>
      <section className="dashboard-panel">
        <form action="/api/admin/products/import-csv" method="post" encType="multipart/form-data">
          <input name="tenantSlug" type="hidden" value="ai-derma-guru" />
          <label>
            CSV file
            <input accept=".csv,text/csv" name="file" type="file" />
          </label>
          <button className="primary-button" type="submit">
            Import CSV
          </button>
        </form>
      </section>
    </main>
  );
}
