"use client";

import { Copy, ShieldCheck, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import type { ProductCatalogItem } from "@/domain/skincare";

export function SponsoredCuration({ products }: { products: ProductCatalogItem[] }) {
  const [concern, setConcern] = useState("dull skin and simple glow routine");
  const [headline, setHeadline] = useState("Simple glow routine");
  const [selected, setSelected] = useState(products.slice(0, 4).map((product) => product.id));
  const [disclosure, setDisclosure] = useState(
    "Some recommendations may include sponsored partner products. They are shown only after passing safety and suitability checks.",
  );

  const selectedProducts = useMemo(
    () => products.filter((product) => selected.includes(product.id)),
    [products, selected],
  );

  function toggleProduct(productId: string) {
    setSelected((current) =>
      current.includes(productId) ? current.filter((id) => id !== productId) : [...current, productId].slice(0, 6),
    );
  }

  const embedCode = `<script src="https://your-domain.com/skin-advisor-widget.js" data-tenant="ai-derma-guru" data-theme="light" data-locale="en"></script>`;

  return (
    <section className="sponsored-layout">
      <div className="dashboard-panel sponsored-editor">
        <p className="eyebrow">Sponsored result set</p>
        <h2>Curate a merchant-safe routine.</h2>
        <p className="summary">
          Sponsored placement is capped by the recommendation engine and can never override red flags, allergy filters,
          pregnancy rules, or catalog approval.
        </p>
        <label>
          Target concern
          <input value={concern} onChange={(event) => setConcern(event.target.value)} />
        </label>
        <label>
          Routine headline
          <input value={headline} onChange={(event) => setHeadline(event.target.value)} />
        </label>
        <label>
          Disclosure text
          <textarea value={disclosure} onChange={(event) => setDisclosure(event.target.value)} />
        </label>
        <div className="product-pick-list">
          {products.map((product) => (
            <button
              className={selected.includes(product.id) ? "product-picker active" : "product-picker"}
              key={product.id}
              onClick={() => toggleProduct(product.id)}
              type="button"
            >
              {product.imageUrl ? <img alt="" src={product.imageUrl} /> : null}
              <span>{product.name}</span>
            </button>
          ))}
        </div>
      </div>

      <aside className="dashboard-panel sponsored-preview">
        <p className="eyebrow">Preview</p>
        <h2>{headline}</h2>
        <p className="summary">{concern}</p>
        <p className="privacy-note">
          <ShieldCheck size={16} />
          {disclosure}
        </p>
        <div className="widget-products">
          {selectedProducts.map((product, index) => (
            <article className="widget-product-card" key={product.id}>
              <div className="widget-product-body">
                {product.imageUrl ? <img className="product-shot" alt={product.name} src={product.imageUrl} /> : null}
                <div>
                  <span>Routine {index + 1}</span>
                  <h3>{product.name}</h3>
                  <p>{product.brand} · merchant-approved OTC product</p>
                </div>
              </div>
            </article>
          ))}
        </div>
        <div className="embed-box">
          <div>
            <Sparkles size={18} />
            <strong>Shopify / website embed</strong>
          </div>
          <code>{embedCode}</code>
          <button className="secondary-button" type="button" onClick={() => navigator.clipboard?.writeText(embedCode)}>
            <Copy size={16} />
            Copy embed
          </button>
        </div>
      </aside>
    </section>
  );
}
