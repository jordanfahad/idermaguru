"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

/**
 * "Put the advisor on your own domain", for someone who has never heard of
 * Vercel and should not have to.
 *
 * The shape of this is dictated by the one step nobody can automate: only the
 * owner of a domain can add a DNS record to it. So the flow is type it, copy
 * one record, and watch it go live — and the watching is the part that decides
 * whether this feels like a product or like a support ticket. It polls, and it
 * says which of the two states it is in, in words rather than a status code.
 */

type Dns = { type: "CNAME" | "A"; name: string; value: string };
type Domain = { host: string; status: "PENDING" | "VERIFIED"; verifiedAt: string | null; dns: Dns };

const POLL_MS = 15_000;

export function DomainConnect() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [available, setAvailable] = useState(true);
  const [host, setHost] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Polling must not outlive the component, and must not stack up a second
  // timer every time the list changes.
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/merchant/domains", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { domains: Domain[]; available: boolean };
      setDomains(payload.domains ?? []);
      setAvailable(payload.available !== false);
    } catch {
      // A failed refresh is not worth a message; the next one is 15s away.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Only poll while something is actually waiting on DNS. A console left open
  // on a fully-live store should be silent.
  const pending = domains.some((domain) => domain.status === "PENDING");
  useEffect(() => {
    if (!pending) return;
    timer.current = window.setInterval(() => void load(), POLL_MS);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
      timer.current = null;
    };
  }, [pending, load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const response = await fetch("/api/merchant/domains", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ host }),
      });
      const payload = (await response.json()) as { domain?: Domain; error?: string };
      if (!response.ok) {
        setError(payload.error ?? "That did not work.");
        return;
      }
      setHost("");
      await load();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(target: string) {
    setBusy(true);
    try {
      await fetch(`/api/merchant/domains?host=${encodeURIComponent(target)}`, { method: "DELETE" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      window.setTimeout(() => setCopied((current) => (current === value ? null : current)), 1600);
    } catch {
      // Clipboard is blocked in some embedded contexts; the value is on screen.
    }
  }

  return (
    <section style={{ marginTop: 28 }}>
      <h2 style={{ fontSize: "1.05rem", margin: "0 0 6px" }}>Your own domain</h2>
      <p className="muted" style={{ fontSize: ".84rem", lineHeight: 1.55, margin: "0 0 16px" }}>
        Run the advisor on a subdomain of your own store — <code>advisor.yourshop.com</code>. Shoppers
        see your brand in the address bar, and the microphone permission prompt asks on your behalf
        rather than ours, which noticeably more people accept.
      </p>

      {!available && (
        <p
          style={{
            fontSize: ".82rem", lineHeight: 1.5, padding: "10px 12px", borderRadius: 10,
            background: "rgba(180,120,20,.09)", border: "1px solid rgba(180,120,20,.25)", marginBottom: 14,
          }}
        >
          Domain connection has not been switched on for this deployment yet. An administrator needs to
          set <code>VERCEL_API_TOKEN</code> and <code>VERCEL_PROJECT_ID</code>.
        </p>
      )}

      <form onSubmit={submit} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <input
          value={host}
          onChange={(event) => setHost(event.target.value)}
          placeholder="advisor.yourshop.com"
          aria-label="Domain to connect"
          spellCheck={false}
          autoCapitalize="none"
          style={{
            flex: "1 1 260px", padding: "10px 12px", borderRadius: 10,
            border: "1px solid rgba(20,17,15,.18)", fontSize: ".9rem",
          }}
        />
        <button
          type="submit"
          disabled={busy || !host.trim() || !available}
          style={{
            padding: "10px 18px", borderRadius: 10, border: 0, cursor: busy ? "wait" : "pointer",
            background: "#1f6f5c", color: "#fff", fontWeight: 600, fontSize: ".9rem",
            opacity: busy || !host.trim() || !available ? 0.55 : 1,
          }}
        >
          {busy ? "Working…" : "Connect"}
        </button>
      </form>

      {error && (
        <p role="alert" style={{ color: "#a3232b", fontSize: ".84rem", marginBottom: 12 }}>
          {error}
        </p>
      )}

      {loaded && domains.length === 0 && (
        <p className="muted" style={{ fontSize: ".82rem" }}>
          No domain connected yet — the advisor is still served from ours, which works fine.
        </p>
      )}

      {domains.map((domain) => (
        <article
          key={domain.host}
          style={{
            border: "1px solid rgba(20,17,15,.12)", borderRadius: 14, padding: "14px 16px", marginBottom: 12,
          }}
        >
          <header style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <strong style={{ fontSize: ".95rem" }}>{domain.host}</strong>
            <span
              style={{
                fontSize: ".72rem", fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase",
                padding: "3px 9px", borderRadius: 999,
                background: domain.status === "VERIFIED" ? "rgba(31,111,92,.12)" : "rgba(180,120,20,.12)",
                color: domain.status === "VERIFIED" ? "#1f6f5c" : "#8a5a12",
              }}
            >
              {domain.status === "VERIFIED" ? "Live" : "Waiting for DNS"}
            </span>
            <button
              type="button"
              onClick={() => void disconnect(domain.host)}
              disabled={busy}
              style={{
                marginInlineStart: "auto", background: "none", border: 0, cursor: "pointer",
                color: "#8a1d2e", fontSize: ".8rem", textDecoration: "underline",
              }}
            >
              Disconnect
            </button>
          </header>

          {domain.status === "PENDING" ? (
            <div style={{ marginTop: 12 }}>
              <p style={{ fontSize: ".84rem", lineHeight: 1.55, margin: "0 0 10px" }}>
                One record to add, wherever this domain&apos;s DNS is managed. We check every few
                seconds and this turns to <strong>Live</strong> on its own — it usually takes a few
                minutes, occasionally up to an hour.
              </p>
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", fontSize: ".82rem", minWidth: 420 }}>
                  <thead>
                    <tr style={{ textAlign: "start" }}>
                      <th style={{ padding: "6px 14px 6px 0", textAlign: "start" }}>Type</th>
                      <th style={{ padding: "6px 14px 6px 0", textAlign: "start" }}>Name</th>
                      <th style={{ padding: "6px 14px 6px 0", textAlign: "start" }}>Value</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ padding: "6px 14px 6px 0" }}><code>{domain.dns.type}</code></td>
                      <td style={{ padding: "6px 14px 6px 0" }}><code>{domain.dns.name}</code></td>
                      <td style={{ padding: "6px 14px 6px 0" }}><code>{domain.dns.value}</code></td>
                      <td style={{ padding: "6px 0" }}>
                        <button
                          type="button"
                          onClick={() => void copy(domain.dns.value)}
                          style={{
                            background: "none", border: "1px solid rgba(20,17,15,.18)", borderRadius: 8,
                            padding: "4px 10px", cursor: "pointer", fontSize: ".76rem",
                          }}
                        >
                          {copied === domain.dns.value ? "Copied" : "Copy"}
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="muted" style={{ fontSize: ".82rem", margin: "10px 0 0", lineHeight: 1.5 }}>
              Serving at <code>https://{domain.host}</code>. Point your <em>Skin Advisor</em> menu item
              at it, or use it as the <code>src</code> of the page embed — the tenant no longer needs
              naming in the snippet, because this hostname says whose shop it is.
            </p>
          )}
        </article>
      ))}
    </section>
  );
}
