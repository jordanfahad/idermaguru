"use client";

import { Loader2, Plus } from "lucide-react";
import { useState } from "react";

type Merchant = {
  id: string;
  display_name: string;
  domain: string;
  owner_id: string | null;
};

export function MerchantManager({ initialMerchants }: { initialMerchants: Merchant[] }) {
  const [merchants, setMerchants] = useState(initialMerchants);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    displayName: "Powder Beauty",
    domain: "powderbeauty.com",
    email: "",
    plan: "Starter",
    catalogMode: "CSV upload preferred",
  });

  async function createMerchant() {
    setSaving(true);
    setStatus(null);
    const response = await fetch("/api/admin/merchants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
    });
    const payload = await response.json();
    setSaving(false);

    if (!response.ok) {
      setStatus(payload.error ?? "Could not create merchant.");
      return;
    }

    setMerchants((current) => [payload.merchant, ...current]);
    setStatus("Merchant account created. They can now be assigned catalog imports, widget access, and analytics.");
  }

  return (
    <section className="dashboard-panel product-manager">
      <div className="compact-grid">
        <label>
          Merchant name
          <input value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} />
        </label>
        <label>
          Domain
          <input value={draft.domain} onChange={(event) => setDraft({ ...draft, domain: event.target.value })} />
        </label>
        <label>
          Login email
          <input value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} />
        </label>
        <label>
          Plan
          <select value={draft.plan} onChange={(event) => setDraft({ ...draft, plan: event.target.value })}>
            <option>Starter</option>
            <option>Growth</option>
            <option>Enterprise</option>
          </select>
        </label>
        <label>
          Catalog source
          <select value={draft.catalogMode} onChange={(event) => setDraft({ ...draft, catalogMode: event.target.value })}>
            <option>CSV upload preferred</option>
            <option>Website crawl fallback</option>
            <option>Manual curated only</option>
          </select>
        </label>
      </div>
      <button className="primary-button" type="button" onClick={createMerchant}>
        {saving ? <Loader2 className="spin" size={18} /> : <Plus size={18} />}
        Create merchant account
      </button>
      {status ? <p className={status.startsWith("Merchant") ? "safety-note" : "error-text"}>{status}</p> : null}
      <div className="table-like">
        {merchants.map((merchant) => (
          <div className="table-row" key={merchant.id}>
            <strong>{merchant.display_name}</strong>
            <span>{merchant.domain}</span>
            <span>{merchant.owner_id ?? "Pending user"}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
