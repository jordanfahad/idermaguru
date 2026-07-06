"use client";

import { useState } from "react";

/**
 * Quiet-luxe styled subscribe button. Same behavior as the original
 * SubscribeButton (POST /api/billing/checkout → Stripe checkout redirect); only
 * the presentation differs, so it sits inside the .dg design without pulling the
 * old prc-* styles.
 */
export function DgSubscribeButton({
  planId,
  label,
  variant = "ink",
}: {
  planId: string;
  label: string;
  variant?: "ink" | "brass";
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.url) {
        throw new Error(payload.error ?? "Could not start checkout. Please try again.");
      }
      window.location.href = payload.url as string;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={`btn ${variant === "brass" ? "btn-brass" : "btn-ink"} btn-block`}
        onClick={startCheckout}
        disabled={loading}
      >
        {loading ? "…" : label}
      </button>
      {error ? (
        <p style={{ color: "var(--warn-rule)", fontSize: ".82rem", marginTop: 8 }}>{error}</p>
      ) : null}
    </>
  );
}
