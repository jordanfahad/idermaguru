import { SkinAdvisorWidget } from "@/components/skin-advisor-widget";
import { seedProducts } from "@/data/seed-catalog";

export default function WidgetDemoPage() {
  const showcase = seedProducts.slice(0, 3);

  return (
    <main className="merchant-demo">
      <section className="merchant-hero">
        <p className="eyebrow">Merchant storefront simulation</p>
        <h1>AI Derma Guru shop preview</h1>
        <p>Shop gentle OTC routines with an embedded AI skin advisor widget.</p>
      </section>
      <section className="merchant-grid">
        {showcase.map((product) => (
          <article className="merchant-product" key={product.id}>
            {product.imageUrl ? <img alt={product.name} src={product.imageUrl} /> : null}
            <h2>{product.name}</h2>
            <p>{product.description}</p>
          </article>
        ))}
      </section>
      <SkinAdvisorWidget tenantSlug="ai-derma-guru" />
    </main>
  );
}
