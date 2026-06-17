"use client";

import { ArrowRight, Loader2 } from "lucide-react";
import { useState } from "react";

export function SubscribeButton({
  planId,
  label,
  highlighted = false,
}: {
  planId: string;
  label: string;
  highlighted?: boolean;
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
    <div className="prc-cta">
      <button
        type="button"
        className={`prc-btn ${highlighted ? "prc-btn-primary" : "prc-btn-ghost"}`}
        onClick={startCheckout}
        disabled={loading}
      >
        {loading ? <Loader2 className="spin" size={18} /> : null}
        {label}
        {!loading ? <ArrowRight size={17} /> : null}
      </button>
      {error ? <p className="prc-error">{error}</p> : null}
    </div>
  );
}
