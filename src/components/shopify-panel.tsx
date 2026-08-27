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
 * Reads a JSON body without assuming there is one.
 *
 * A serverless timeout or crash answers with the platform's own HTML page, and
 * calling response.json() on that reported "Unexpected token 'A'" instead of
 * what actually went wrong.
 */
async function readJson(response: Response) {
  try {
    return (await response.json()) as Record<string, never> & { error?: string; [key: string]: unknown };
  } catch {
    return null;
  }
}

/**
 * What the sync actually did, in the one place a merchant will look.
 *
 * The route has always returned more than this panel showed. Two of the
 * numbers matter enough to say out loud:
 *
 * `retired` is a write — products the store no longer sells, taken off the
 * shelf. Somebody who cannot see that number cannot tell a healthy sync from
 * one that quietly emptied their catalogue.
 *
 * `withIngredients` is how a merchant finds out their metafield is named
 * something other than custom.ingredients, or holds references rather than
 * words. Without it the failure is invisible: the sync reports success, and
 * the ingredient chip is simply never there.
 */
export function syncSummary(shop: string, payload: Record<string, unknown>): string {
  const count = (key: string) => (typeof payload[key] === "number" ? (payload[key] as number) : 0);
  const parts = [`Imported ${count("imported")} of ${count("fetched")} products from ${shop}`];

  if (count("skipped")) parts.push(`${count("skipped")} skipped (no usable price)`);
  if (count("retired")) parts.push(`${count("retired")} no longer in the store, marked out of stock`);
  parts.push(
    count("withIngredients")
      ? `${count("withIngredients")} with an ingredient list`
      : "no ingredient lists found — check the metafield is custom.ingredients and holds text, not references",
  );

  return (
    parts.join(" — ") +
    (payload.truncated
      ? ". This was only part of the store, so nothing was retired; sync again for the rest."
      : ".")
  );
}

function failureFor(status: number) {
  if (status === 401) return "Your admin session expired. Sign in again and retry.";
  if (status === 504 || status === 408) {
    return "The store took too long to answer and the sync timed out. Try again — it resumes where it left off.";
  }
  return `Sync failed (HTTP ${status}).`;
}

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
      const payload = await readJson(response);
      if (!response.ok || !payload) {
        throw new Error(payload?.error ?? failureFor(response.status));
      }
      setMessage(syncSummary(shop, payload));
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
        <table className="shopify-table">
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
                <td data-label="Connected">{new Date(shop.installed_at).toLocaleDateString()}</td>
                <td data-label="Last sync">
                  {shop.last_sync_at ? new Date(shop.last_sync_at).toLocaleString() : "Never"}
                </td>
                <td data-label="Products">{shop.last_sync_count ?? "—"}</td>
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
