"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plug, RefreshCw } from "lucide-react";

type Shop = {
  shop_domain: string;
  scopes: string | null;
  installed_at: string;
  last_sync_at: string | null;
  last_sync_count: number | null;
};

/**
 * Connect a Shopify store and pull its catalogue, without touching a console.
 * Syncing rewrites the catalogue every shopper is recommended from, so both
 * endpoints behind this panel require an admin session.
 */
export function ShopifyPanel() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [configured, setConfigured] = useState(true);
  const [shopInput, setShopInput] = useState("");
  const [syncing, setSyncing] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/shopify/status");
      const payload = await response.json();
      if (response.ok) {
        setShops(payload.shops ?? []);
        setConfigured(Boolean(payload.configured));
      }
    } catch {
      // panel is informational; leave the last known state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function connect() {
    const shop = shopInput.trim().toLowerCase();
    if (!shop) return;
    const domain = shop.endsWith(".myshopify.com") ? shop : `${shop}.myshopify.com`;
    window.location.href = `/api/shopify/install?shop=${encodeURIComponent(domain)}`;
  }

  async function sync(shop: string) {
    setSyncing(shop);
    setMessage(null);
    try {
      const response = await fetch("/api/shopify/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shop }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? "Sync failed.");
      setMessage(
        `Imported ${payload.imported} of ${payload.fetched} products from ${shop}` +
          (payload.skipped ? ` (${payload.skipped} skipped: no usable price).` : "."),
      );
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sync failed.");
    } finally {
      setSyncing(null);
    }
  }

  return (
    <section className="dashboard-panel">
      <h2>Shopify</h2>
      <p className="muted">
        Connect a store to recommend from its live catalogue. Products sync with the safety fields the
        advisor needs; drafts and out-of-stock items are excluded.
      </p>

      {!configured ? (
        <p className="warning">
          Shopify isn&rsquo;t configured. Set SHOPIFY_API_KEY and SHOPIFY_API_SECRET, then redeploy.
        </p>
      ) : null}

      <div className="shopify-connect">
        <input
          value={shopInput}
          onChange={(event) => setShopInput(event.target.value)}
          placeholder="your-store.myshopify.com"
          aria-label="Shopify store domain"
          onKeyDown={(event) => {
            if (event.key === "Enter") connect();
          }}
        />
        <button className="primary-button" type="button" onClick={connect} disabled={!configured || !shopInput.trim()}>
          <Plug size={15} />
          Connect store
        </button>
      </div>

      {message ? <p className="shopify-message">{message}</p> : null}

      {loading ? (
        <p className="muted">Loading connected stores…</p>
      ) : shops.length ? (
        <table className="table-like">
          <thead>
            <tr>
              <th>Store</th>
              <th>Connected</th>
              <th>Last sync</th>
              <th>Products</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shops.map((shop) => (
              <tr key={shop.shop_domain}>
                <td>{shop.shop_domain}</td>
                <td>{new Date(shop.installed_at).toLocaleDateString()}</td>
                <td>{shop.last_sync_at ? new Date(shop.last_sync_at).toLocaleString() : "Never"}</td>
                <td>{shop.last_sync_count ?? "—"}</td>
                <td>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => sync(shop.shop_domain)}
                    disabled={syncing !== null}
                  >
                    {syncing === shop.shop_domain ? (
                      <Loader2 className="spin" size={14} />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                    {syncing === shop.shop_domain ? "Syncing…" : "Sync catalogue"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">No stores connected yet.</p>
      )}
    </section>
  );
}
