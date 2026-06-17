"use client";

import { Download, FileUp, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import type { ProductCatalogItem } from "@/domain/skincare";

const sampleCsv = [
  [
    "sku",
    "name",
    "brand",
    "category",
    "description",
    "url",
    "imageUrl",
    "price",
    "currency",
    "inStock",
    "ingredients",
    "activeIngredients",
    "skinTypes",
    "concerns",
    "avoidIf",
    "pregnancySafety",
    "fragranceFree",
    "nonComedogenic",
    "sensitiveSkinSuitable",
    "merchantPriority",
    "sponsoredBidCpc",
  ].join(","),
  [
    "CICA-SA-001",
    "CeraVe SA Smoothing Cleanser 236 ml",
    "CeraVe",
    "cleanser",
    "Rinse-off cleanser for oily skin texture and mild blackheads.",
    "https://cicabelle.com/products/cerave-sa-smoothing-cleanser-236-ml",
    "https://cicabelle.com/cdn/shop/files/77991_1_1.jpg?v=1720613416&width=1080",
    "65",
    "AED",
    "true",
    "glycerin|salicylic acid|niacinamide",
    "salicylic acid",
    "oily|combination",
    "blackheads|oily skin|pores|texture",
    "salicylic acid allergy|very sensitive|barrier damage",
    "CAUTION",
    "true",
    "true",
    "false",
    "95",
    "0",
  ].join(","),
].join("\n");

export function AdminProductManager({ initialProducts }: { initialProducts: ProductCatalogItem[] }) {
  const [products, setProducts] = useState(initialProducts);
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    sku: "",
    name: "",
    brand: "Derma Guru Lab",
    category: "serum",
    description: "",
    url: "https://aiderma.guru/products/",
    price: 99,
  });

  async function createProduct() {
    const response = await fetch("/api/admin/products", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenantSlug: "ai-derma-guru",
        ...draft,
        currency: "AED",
        inStock: true,
        ingredientsJson: [],
        activeIngredientsJson: [],
        skinTypesJson: ["normal"],
        concernsJson: ["routine building"],
        avoidIfJson: [],
        pregnancySafety: "UNKNOWN",
        fragranceFree: false,
        nonComedogenic: false,
        sensitiveSkinSuitable: false,
        claimsJson: [],
        approvedClaimsJson: [],
        merchantPriority: 0,
        sponsoredBidCpc: 0,
      }),
    });
    const payload = await response.json();
    if (payload.product) setProducts((current) => [payload.product, ...current]);
  }

  async function updateProduct(product: ProductCatalogItem) {
    await fetch(`/api/admin/products/${product.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenantSlug: "ai-derma-guru",
        name: product.name,
        price: product.price,
        inStock: product.inStock,
        merchantPriority: product.merchantPriority,
        sponsoredBidCpc: product.sponsoredBidCpc,
      }),
    });
  }

  async function deleteProduct(productId: string) {
    await fetch(`/api/admin/products/${productId}?tenantSlug=ai-derma-guru`, { method: "DELETE" });
    setProducts((current) => current.filter((product) => product.id !== productId));
  }

  function downloadTemplate() {
    const blob = new Blob([sampleCsv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "ai-derma-guru-product-import-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importProducts(file: File | null) {
    if (!file) return;
    setImporting(true);
    setStatus(null);
    const body = new FormData();
    body.set("tenantSlug", "ai-derma-guru");
    body.set("file", file);

    const response = await fetch("/api/admin/products/import-csv", { method: "POST", body });
    const payload = await response.json();
    setImporting(false);

    if (!response.ok) {
      setStatus(payload.error ?? "Could not import CSV.");
      return;
    }

    setProducts((current) => [...payload.created, ...current]);
    setStatus(`${payload.created.length} product${payload.created.length === 1 ? "" : "s"} imported into All products.`);
  }

  return (
    <section className="dashboard-panel product-manager">
      <div className="catalog-import-toolbar">
        <div>
          <strong>Fast catalog upload</strong>
          <p>Download the sample template, fill merchant products, then upload the CSV for faster recommendations.</p>
        </div>
        <div className="catalog-import-actions">
          <button className="secondary-button" type="button" onClick={downloadTemplate}>
            <Download size={16} />
            Download sample template
          </button>
          <label className="secondary-button">
            {importing ? <Loader2 className="spin" size={16} /> : <FileUp size={16} />}
            Upload CSV
            <input
              accept=".csv,text/csv"
              disabled={importing}
              hidden
              onChange={(event) => importProducts(event.target.files?.[0] ?? null)}
              type="file"
            />
          </label>
        </div>
      </div>
      {status ? <p className={status.includes("imported") ? "safety-note" : "error-text"}>{status}</p> : null}

      <div className="compact-grid">
        <input placeholder="SKU" value={draft.sku} onChange={(event) => setDraft({ ...draft, sku: event.target.value })} />
        <input placeholder="Name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        <input placeholder="Description" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
        <input placeholder="URL" value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} />
      </div>
      <button className="secondary-button" type="button" onClick={createProduct}>
        <Plus size={16} />
        Create product
      </button>

      <div className="table-like">
        {products.map((product) => (
          <div className="table-row product-admin-row" key={product.id}>
            <input
              value={product.name}
              onChange={(event) =>
                setProducts((current) =>
                  current.map((item) => (item.id === product.id ? { ...item, name: event.target.value } : item)),
                )
              }
            />
            <span>{product.category}</span>
            <label>
              <input
                checked={product.inStock}
                onChange={(event) =>
                  setProducts((current) =>
                    current.map((item) => (item.id === product.id ? { ...item, inStock: event.target.checked } : item)),
                  )
                }
                type="checkbox"
              />
              Active
            </label>
            <div className="row-actions">
              <button className="icon-only" type="button" onClick={() => updateProduct(product)} aria-label="Save product">
                <Save size={16} />
              </button>
              <button className="icon-only" type="button" onClick={() => deleteProduct(product.id)} aria-label="Delete product">
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
