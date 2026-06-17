"use client";

import { Copy, Download, FileUp, Link2, Loader2, Plus, Save, Search, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { PRODUCTION_SITE_URL } from "@/lib/site-url";
import type { LiveConsultationConfig, LiveConsultationProduct } from "@/data/live-consultations";

const productCsvTemplate = [
  [
    "title",
    "product",
    "description",
    "price",
    "beforePrice",
    "afterPrice",
    "link",
    "imageUrl",
    "vendor",
    "category",
    "priority",
    "inventorySize",
    "variantId",
    "routineSlot",
    "safety",
    "keywords",
  ],
  [
    "Example Glow Serum",
    "Example Glow Serum",
    "A priority serum for dullness, dark spots, and uneven-looking tone.",
    "AED 89",
    "AED 120",
    "AED 89",
    "https://example.com/products/example-glow-serum",
    "https://example.com/images/example-glow-serum.jpg",
    "Cicabelle",
    "Serum",
    "90",
    "25",
    "1234567890",
    "2. Tone support",
    "Patch test first. Stop use if severe irritation occurs.",
    "glow,dark spots,niacinamide,pigmentation",
  ],
];

const PRODUCT_PAGE_SIZE = 100;

export function LiveConsultationAdmin({ config }: { config: LiveConsultationConfig }) {
  const [draft, setDraft] = useState<LiveConsultationConfig>(() => ({
    ...config,
    products: dedupeProducts(config.products),
  }));
  const [limit, setLimit] = useState(config.vendors.length);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [productPage, setProductPage] = useState(1);
  const vendors = draft.vendors;
  const activeVendors = useMemo(() => vendors.slice(0, limit), [vendors, limit]);
  const total = activeVendors.reduce((sum, vendor) => sum + vendor.share, 0);
  const publicUrl = `${PRODUCTION_SITE_URL}/${draft.slug}`;
  const productStats = useMemo(() => buildProductStats(draft.products, activeVendors), [draft.products, activeVendors]);
  const filteredProducts = useMemo(
    () => filterProducts(draft.products, productSearch),
    [draft.products, productSearch],
  );
  const totalProductPages = Math.max(1, Math.ceil(filteredProducts.length / PRODUCT_PAGE_SIZE));
  const currentProductPage = Math.min(productPage, totalProductPages);
  const paginatedProducts = filteredProducts.slice(
    (currentProductPage - 1) * PRODUCT_PAGE_SIZE,
    currentProductPage * PRODUCT_PAGE_SIZE,
  );

  function updateShare(name: string, share: number) {
    setDraft((current) => ({
      ...current,
      vendors: current.vendors.map((vendor) => (vendor.name === name ? { ...vendor, share } : vendor)),
    }));
  }

  function updateProduct(
    productId: string,
    field: "vendor" | "bundleTag" | "url" | "priority" | "inventorySize",
    value: string,
  ) {
    setDraft((current) => ({
      ...current,
      products: current.products.map((product) =>
        product.id === productId
          ? {
              ...product,
              [field]: field === "priority" || field === "inventorySize" ? Number(value) : value,
            }
          : product,
      ),
    }));
  }

  async function importCsv(file: File | null) {
    if (!file) return;
    const text = await file.text();
    const rows = parseCsv(text);
    const primaryVendor = activeVendors[0]?.name ?? draft.primaryVendor;
    const imported = rows
      .map((row, index): LiveConsultationProduct | null => {
        const name = row.title || row.product || row.name;
        const url = row.link || row.url || row.productUrl;
        if (!name || !url) return null;
        const category = row.category || "Curated product";
        return {
          id: `csv-${Date.now()}-${index}`,
          vendor: row.vendor || primaryVendor,
          name,
          category,
          imageUrl:
            row.imageUrl ||
            row.image ||
            "https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=700&q=80",
          price: row.price || "Merchant price",
          url,
          routineSlot: row.routineSlot || `${index + 1}. ${category}`,
          why: row.description || row.why || "Selected by the merchant as a priority product for this consultation page.",
          safety: row.safety || "Follow label directions, patch test, and stop use if severe irritation occurs.",
          trust: "Selected from the approved product catalog with brand-authenticity and suitability checks.",
          bundleTag: row.priority ? `Priority ${row.priority}` : row.bundleTag || "Priority product",
          priority: Number(row.priority || 75),
          beforePrice: row.beforePrice || row.compareAtPrice || "",
          afterPrice: row.afterPrice || row.salePrice || row.price || "",
          variantId: row.variantId || row.shopifyVariantId || "",
          inventorySize: parseInventorySize(row.inventorySize || row.inventory || row.stock || row.quantity),
          keywords: [name, category, row.description || "", row.keywords || ""]
            .join(" ")
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter((token) => token.length > 2),
        };
      })
      .filter((product): product is LiveConsultationProduct => Boolean(product));

    const result = upsertProducts(draft.products, imported);
    setDraft((current) => ({ ...current, products: result.products }));
    setStatus(
      `${result.created} added, ${result.updated} updated, ${result.removedDuplicates} duplicate${
        result.removedDuplicates === 1 ? "" : "s"
      } removed. Save to publish.`,
    );
  }

  function downloadTemplate() {
    const csv = productCsvTemplate.map((row) => row.map(csvCell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "ai-derma-guru-priority-products-template.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function saveConfig() {
    setSaving(true);
    setStatus(null);
    const products = dedupeProducts(draft.products);
    const configToSave = { ...draft, vendors: activeVendors, products };
    const response = await fetch(`/api/live-consultations/${draft.slug}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(configToSave),
    });
    const payload = await response.json();
    setSaving(false);

    if (!response.ok) {
      setStatus(payload.error ?? "Could not save live consultation settings.");
      return;
    }
    setDraft({ ...payload.config, products: dedupeProducts(payload.config.products) });
    setStatus("Saved. The public consultation page will use this vendor mix and product order.");
  }

  return (
    <section className="dashboard-panel live-admin">
      <div className="result-heading">
        <div>
          <p className="eyebrow">Super admin</p>
          <h2>Control live consultation result mix.</h2>
        </div>
        <button className="secondary-button" type="button">
          <Plus size={16} />
          New page
        </button>
      </div>

      <div className="compact-grid">
        <label>
          Unique page identifier
          <input value={draft.slug} onChange={(event) => setDraft({ ...draft, slug: event.target.value })} />
        </label>
        <label>
          Number of vendors
          <select value={limit} onChange={(event) => setLimit(Number(event.target.value))}>
            {vendors.map((vendor, index) => (
              <option key={vendor.name} value={index + 1}>
                {index + 1} vendor{index ? "s" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="vendor-control-list">
        {activeVendors.map((vendor) => (
          <label key={vendor.name}>
            <span>
              <SlidersHorizontal size={16} />
              {vendor.name}
            </span>
            <input
              max="100"
              min="0"
              onChange={(event) => updateShare(vendor.name, Number(event.target.value))}
              type="range"
              value={vendor.share}
            />
            <strong>{vendor.share}%</strong>
          </label>
        ))}
      </div>

      <div className={total === 100 ? "allocation-ok" : "allocation-warning"}>
        Current allocation: {total}%. Keep the total at 100% before publishing a paid campaign.
      </div>
      <button className="primary-button" type="button" onClick={saveConfig}>
        {saving ? <Loader2 className="spin" size={18} /> : <Save size={18} />}
        Save live consultation settings
      </button>
      {status ? (
        <p className={status.startsWith("Saved") || status.includes("added") || status.includes("updated") ? "safety-note" : "error-text"}>
          {status}
        </p>
      ) : null}

      <div className="embed-box product-import-box">
        <div>
          <FileUp size={18} />
          <strong>Optional priority product upload</strong>
        </div>
        <p>
          Upload a CSV when a merchant wants faster curated results. Supported headers: title, product, description,
          price, beforePrice, afterPrice, link, imageUrl, vendor, category, priority, inventorySize, variantId. If
          inventorySize is blank or 0, that product is treated as out of stock and excluded.
        </p>
        <div className="csv-action-row">
          <button className="secondary-button" type="button" onClick={downloadTemplate}>
            <Download size={16} />
            Download CSV template
          </button>
          <label className="secondary-button">
            <FileUp size={16} />
            Upload product CSV
            <input accept=".csv,text/csv" hidden onChange={(event) => importCsv(event.target.files?.[0] ?? null)} type="file" />
          </label>
        </div>
      </div>

      <div className="embed-box">
        <div>
          <Link2 size={18} />
          <strong>Public consultation URL</strong>
        </div>
        <code>{publicUrl}</code>
        <button className="secondary-button" type="button" onClick={() => navigator.clipboard?.writeText(publicUrl)}>
          <Copy size={16} />
          Copy URL
        </button>
      </div>

      <section className="product-catalog-manager">
        <div className="product-stats-grid">
          <StatCard label="Total products" value={productStats.totalProducts} />
          <StatCard label="Vendor" value={productStats.vendorName} detail={productStats.domain} />
          <StatCard label="In stock" value={productStats.inStock} />
          <StatCard label="Out of stock" value={productStats.outOfStock} />
          <StatCard label="Priority over 80" value={productStats.highPriority} />
          <StatCard label="Priority under 30" value={productStats.lowPriority} />
        </div>

        <div className="catalog-toolbar">
          <label className="catalog-search">
            <Search size={18} />
            <input
              placeholder="Search products, vendor, category, URL, or keyword..."
              value={productSearch}
              onChange={(event) => {
                setProductSearch(event.target.value);
                setProductPage(1);
              }}
            />
          </label>
          <span>
            Showing {paginatedProducts.length} of {filteredProducts.length} products
          </span>
        </div>

        <div className="table-like">
          <div className="table-row product-admin-row product-admin-header">
            <strong>Product</strong>
            <strong>Vendor</strong>
            <strong>Campaign tag</strong>
            <strong>Product URL</strong>
            <strong>Priority</strong>
            <strong>Inventory</strong>
            <strong>Price</strong>
          </div>
        {paginatedProducts.map((product) => (
          <div className="table-row product-admin-row" key={product.id}>
            <strong>{product.name}</strong>
            <select value={product.vendor} onChange={(event) => updateProduct(product.id, "vendor", event.target.value)}>
              {vendors.map((vendor) => (
                <option key={vendor.name}>{vendor.name}</option>
              ))}
            </select>
            <input
              value={product.bundleTag ?? product.category}
              onChange={(event) => updateProduct(product.id, "bundleTag", event.target.value)}
            />
            <input
              aria-label={`${product.name} product URL`}
              value={product.url}
              onChange={(event) => updateProduct(product.id, "url", event.target.value)}
            />
            <input
              aria-label={`${product.name} priority`}
              min="0"
              max="100"
              type="number"
              value={product.priority ?? 50}
              onChange={(event) => updateProduct(product.id, "priority", event.target.value)}
            />
            <input
              aria-label={`${product.name} inventory size`}
              min="0"
              type="number"
              value={product.inventorySize ?? ""}
              placeholder="0"
              onChange={(event) => updateProduct(product.id, "inventorySize", event.target.value)}
            />
            <span>{product.price}</span>
          </div>
        ))}
        </div>

        <div className="pagination-row">
          <button
            className="secondary-button"
            type="button"
            disabled={currentProductPage <= 1}
            onClick={() => setProductPage((page) => Math.max(1, page - 1))}
          >
            Previous 100
          </button>
          <span>
            Page {currentProductPage} of {totalProductPages}
          </span>
          <button
            className="secondary-button"
            type="button"
            disabled={currentProductPage >= totalProductPages}
            onClick={() => setProductPage((page) => Math.min(totalProductPages, page + 1))}
          >
            Next 100
          </button>
        </div>
      </section>
    </section>
  );
}

function StatCard({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <article className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </article>
  );
}

function buildProductStats(products: LiveConsultationProduct[], vendors: LiveConsultationConfig["vendors"]) {
  const vendorName = vendors.map((vendor) => vendor.name).join(", ") || "No vendor";
  const domain = vendors.map((vendor) => vendor.domain).join(", ");
  return {
    totalProducts: products.length,
    vendorName,
    domain,
    inStock: products.filter(isProductInStock).length,
    outOfStock: products.filter((product) => product.inventorySize !== undefined && !isProductInStock(product)).length,
    highPriority: products.filter((product) => Number(product.priority ?? 0) > 80).length,
    lowPriority: products.filter((product) => Number(product.priority ?? 0) < 30).length,
  };
}

function filterProducts(products: LiveConsultationProduct[], query: string) {
  const clean = query.trim().toLowerCase();
  if (!clean) return products;
  return products.filter((product) =>
    [
      product.name,
      product.vendor,
      product.category,
      product.bundleTag,
      product.url,
      product.price,
      String(product.priority ?? ""),
      String(product.inventorySize ?? ""),
      ...(product.keywords ?? []),
    ]
      .join(" ")
      .toLowerCase()
      .includes(clean),
  );
}

function isProductInStock(product: LiveConsultationProduct) {
  if (product.inventorySize === undefined) return true;
  return Number(product.inventorySize) > 0;
}

function upsertProducts(existingProducts: LiveConsultationProduct[], importedProducts: LiveConsultationProduct[]) {
  const existing = dedupeProducts(existingProducts);
  const existingByKey = mapProductsByKeys(existing);
  const imported = dedupeProducts(importedProducts);

  let created = 0;
  let updated = 0;
  const importedMerged = imported.map((importedProduct) => {
    const previous = productKeys(importedProduct)
      .map((key) => existingByKey.get(key))
      .find((product): product is LiveConsultationProduct => Boolean(product));
    if (previous) {
      updated += 1;
      return mergeProducts(previous, { ...importedProduct, id: previous.id });
    }
    created += 1;
    return importedProduct;
  });

  const importedKeys = new Set(imported.flatMap(productKeys));
  const remainingExisting = existing.filter((product) => !productKeys(product).some((key) => importedKeys.has(key)));
  const products = [...importedMerged, ...remainingExisting];

  return {
    products,
    created,
    updated,
    removedDuplicates: Math.max(0, existingProducts.length + importedProducts.length - products.length),
  };
}

function dedupeProducts(products: LiveConsultationProduct[]) {
  const deduped: LiveConsultationProduct[] = [];
  const keyToIndex = new Map<string, number>();

  for (const product of products) {
    const keys = productKeys(product);
    const existingIndex = keys.map((key) => keyToIndex.get(key)).find((index) => index !== undefined);

    if (existingIndex !== undefined) {
      deduped[existingIndex] = mergeProducts(deduped[existingIndex], product);
      for (const key of productKeys(deduped[existingIndex])) keyToIndex.set(key, existingIndex);
      continue;
    }

    const nextIndex = deduped.length;
    deduped.push(product);
    for (const key of keys) keyToIndex.set(key, nextIndex);
  }

  return deduped;
}

function mapProductsByKeys(products: LiveConsultationProduct[]) {
  const map = new Map<string, LiveConsultationProduct>();
  for (const product of products) {
    for (const key of productKeys(product)) map.set(key, product);
  }
  return map;
}

function productKeys(product: LiveConsultationProduct) {
  const keys: string[] = [];
  const urlKey = productUrlKey(product.url);
  if (urlKey) keys.push(`url:${urlKey}`);

  const variantId = product.variantId?.trim().toLowerCase();
  const nameKey = canonicalProductName(product.name);
  if (variantId && nameKey) keys.push(`variant:${normalizeKey(product.vendor)}:${variantId}:${nameKey}`);
  if (nameKey) keys.push(`name:${normalizeKey(product.vendor)}:${nameKey}`);

  return keys.length ? keys : [`id:${product.id}`];
}

function mergeProducts(first: LiveConsultationProduct, second: LiveConsultationProduct) {
  const winner = productPreferenceScore(second) >= productPreferenceScore(first) ? second : first;
  const fallback = winner === second ? first : second;
  const inventoryValues = [first.inventorySize, second.inventorySize].filter(
    (value): value is number => value !== undefined && Number.isFinite(Number(value)),
  );

  return {
    ...fallback,
    ...winner,
    id: winner.id || fallback.id,
    priority: Math.max(Number(first.priority ?? 0), Number(second.priority ?? 0)),
    inventorySize: inventoryValues.length ? Math.max(...inventoryValues.map(Number)) : undefined,
    keywords: Array.from(new Set([...(first.keywords ?? []), ...(second.keywords ?? [])])),
  };
}

function productPreferenceScore(product: LiveConsultationProduct) {
  const inventory = product.inventorySize;
  const inventoryScore = inventory === undefined ? 0 : Number(inventory) > 0 ? 1000 + Number(inventory) : -500;
  const draftPenalty = /\bdraft\b/i.test(product.name) ? -250 : 0;
  return inventoryScore + Number(product.priority ?? 0) + draftPenalty;
}

function productUrlKey(url: string) {
  const clean = url.trim();
  if (!clean) return "";

  try {
    const parsed = new URL(clean);
    const path = parsed.pathname.replace(/\/+$/, "").toLowerCase();
    const productHandle = path.match(/\/products\/([^/]+)/)?.[1];
    return `${parsed.hostname.replace(/^www\./, "").toLowerCase()}${productHandle ? `/products/${productHandle}` : path}`;
  } catch {
    return clean.replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
  }
}

function normalizeKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function canonicalProductName(value: string) {
  return normalizeKey(
    value
      .replace(/\[draft version\]/gi, "")
      .replace(/\bdraft version\b/gi, "")
      .replace(/\bcopy\b/gi, ""),
  );
}

function parseCsv(text: string) {
  const [headerLine, ...lines] = text.split(/\r?\n/).filter(Boolean);
  if (!headerLine) return [];
  const headers = splitCsvLine(headerLine).map((header) => header.trim());
  return lines.map((line) => {
    const values = splitCsvLine(line);
    return headers.reduce<Record<string, string>>((row, header, index) => {
      row[header] = values[index]?.trim() ?? "";
      return row;
    }, {});
  });
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function parseInventorySize(value: string) {
  if (!value.trim()) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function splitCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (const char of line) {
    if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values.map((value) => value.replace(/^"|"$/g, ""));
}
