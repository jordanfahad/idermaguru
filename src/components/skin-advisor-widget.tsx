"use client";

import { Activity, AlertTriangle, Camera, Check, ExternalLink, Loader2, MessageCircle, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CUSTOMER_DISCLAIMER, IMAGE_CONSENT_TEXT, type ProductCatalogItem, type RoutineRecommendation } from "@/domain/skincare";

type WidgetProps = {
  tenantSlug?: string;
  mode?: "embedded" | "full";
  theme?: "light" | "dark";
};

type ApiResult = {
  recommendation: RoutineRecommendation;
  explanation: string;
  id?: string;
};

export function SkinAdvisorWidget({ tenantSlug = "ai-derma-guru", mode = "embedded" }: WidgetProps) {
  const [open, setOpen] = useState(mode === "full");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [step, setStep] = useState<"intro" | "intake" | "image" | "results">("intro");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [imageConsent, setImageConsent] = useState(false);
  const [form, setForm] = useState({
    ageRange: "",
    country: "",
    mainConcern: "I have dull skin and want a simple routine.",
    secondaryConcerns: "",
    skinType: "combination",
    sensitivity: "low",
    pregnantOrBreastfeeding: false,
    allergies: "",
    currentProducts: "",
    currentActives: "",
    prescriptionUse: false,
    severitySelfRated: 3,
    duration: "",
    symptoms: "",
    budgetMax: 250,
    routinePreference: "simple",
    fragrancePreference: "fragrance-free preferred",
    texturePreference: "lightweight",
    sunscreenUse: "sometimes",
    previousIrritationHistory: "",
  });

  async function start() {
    setLoading(true);
    setError(null);
    const response = await fetch("/api/chat/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenantSlug,
        locale: navigator.language,
        sourceUrl: window.location.href,
        referrer: document.referrer,
      }),
    });
    const payload = await response.json();
    setLoading(false);

    if (!response.ok) {
      setError(payload.error ?? "Could not start a session.");
      return;
    }

    setSessionId(payload.sessionId);
    setTenantId(payload.tenant.id);
    setStep("intake");
  }

  async function submitIntake() {
    setLoading(true);
    setError(null);
    const intake = {
      ...form,
      secondaryConcerns: split(form.secondaryConcerns),
      allergies: split(form.allergies),
      currentProducts: split(form.currentProducts),
      currentActives: split(form.currentActives),
      symptoms: split(form.symptoms),
      budgetMax: Number(form.budgetMax),
    };
    const response = await fetch("/api/recommendations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantSlug, sessionId, intake }),
    });
    const payload = await response.json();
    setLoading(false);

    if (!response.ok) {
      setError(payload.error ?? "Could not create recommendations.");
      return;
    }

    setResult(payload);
    setStep("results");
  }

  async function uploadImage(file?: File) {
    if (!file || !sessionId || !tenantId) return;
    const body = new FormData();
    body.set("sessionId", sessionId);
    body.set("tenantId", tenantId);
    body.set("accepted", String(imageConsent));
    body.set("consentText", IMAGE_CONSENT_TEXT);
    body.set("image", file);
    await fetch("/api/upload-image", { method: "POST", body });
  }

  const panel = (
    <section className="widget-panel" aria-label="AI Derma Guru widget">
      <div className="widget-header">
        <div>
          <p className="eyebrow">AI Derma Guru</p>
          <h2>AI Cosmetologist</h2>
        </div>
        {mode === "embedded" ? (
          <button className="icon-only" type="button" onClick={() => setOpen(false)} aria-label="Close advisor">
            <X size={18} />
          </button>
        ) : null}
      </div>

      {step === "intro" ? (
        <div className="widget-step">
          <p className="privacy-note">{CUSTOMER_DISCLAIMER}</p>
          <p className="privacy-note">
            Privacy: we use anonymous sessions, minimal data, optional image consent, and deletion/export endpoints.
          </p>
          <button className="primary-button" type="button" onClick={start}>
            {loading ? <Loader2 className="spin" size={18} /> : <MessageCircle size={18} />}
            Start consultation
          </button>
          {error ? <p className="error-text">{error}</p> : null}
        </div>
      ) : null}

      {step === "intake" ? (
        <div className="widget-step">
          <label>
            Main concern
            <textarea
              value={form.mainConcern}
              onChange={(event) => setForm({ ...form, mainConcern: event.target.value })}
            />
          </label>
          <div className="compact-grid">
            <label>
              Age range
              <input value={form.ageRange} onChange={(event) => setForm({ ...form, ageRange: event.target.value })} placeholder="25-34" />
            </label>
            <label>
              Country
              <input value={form.country} onChange={(event) => setForm({ ...form, country: event.target.value })} placeholder="UAE" />
            </label>
            <label>
              Skin type
              <select value={form.skinType} onChange={(event) => setForm({ ...form, skinType: event.target.value })}>
                <option>dry</option>
                <option>normal</option>
                <option>combination</option>
                <option>oily</option>
                <option>sensitive</option>
              </select>
            </label>
            <label>
              Sensitivity
              <select value={form.sensitivity} onChange={(event) => setForm({ ...form, sensitivity: event.target.value })}>
                <option>low</option>
                <option>moderate</option>
                <option>high</option>
                <option>very sensitive</option>
              </select>
            </label>
          </div>
          <label>
            Allergies
            <input value={form.allergies} onChange={(event) => setForm({ ...form, allergies: event.target.value })} placeholder="salicylic acid, fragrance" />
          </label>
          <label>
            Current actives or prescriptions
            <input value={form.currentActives} onChange={(event) => setForm({ ...form, currentActives: event.target.value })} placeholder="retinol, acids, prescription creams" />
          </label>
          <div className="toggle-row">
            <label>
              <input
                checked={form.pregnantOrBreastfeeding}
                onChange={(event) => setForm({ ...form, pregnantOrBreastfeeding: event.target.checked })}
                type="checkbox"
              />
              Pregnant or breastfeeding
            </label>
            <label>
              <input
                checked={form.prescriptionUse}
                onChange={(event) => setForm({ ...form, prescriptionUse: event.target.checked })}
                type="checkbox"
              />
              Using prescription treatment
            </label>
          </div>
          <button className="secondary-button" type="button" onClick={() => setStep("image")}>
            <Camera size={18} />
            Optional photo
          </button>
          <button className="primary-button" type="button" onClick={submitIntake}>
            {loading ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
            Get OTC routine
          </button>
          {error ? <p className="error-text">{error}</p> : null}
        </div>
      ) : null}

      {step === "image" ? (
        <div className="widget-step">
          <p className="privacy-note">{IMAGE_CONSENT_TEXT}</p>
          <label className="consent-box">
            <input
              checked={imageConsent}
              onChange={(event) => setImageConsent(event.target.checked)}
              type="checkbox"
            />
            I accept optional image-upload consent.
          </label>
          <input
            accept="image/jpeg,image/png,image/webp"
            disabled={!imageConsent}
            type="file"
            onChange={(event) => uploadImage(event.target.files?.[0])}
          />
          <button className="primary-button" type="button" onClick={submitIntake}>
            Continue without photo
          </button>
        </div>
      ) : null}

      {step === "results" && result ? (
        <WidgetResults result={result} sessionId={sessionId} tenantSlug={tenantSlug} />
      ) : null}
    </section>
  );

  if (mode === "full") return panel;

  return (
    <div className="widget-embed">
      {open ? panel : null}
      <button className="floating-widget-button" type="button" onClick={() => setOpen(true)}>
        <MessageCircle size={22} />
        AI Derma Guru
      </button>
    </div>
  );
}

function WidgetResults({
  result,
  sessionId,
  tenantSlug,
}: {
  result: ApiResult;
  sessionId: string | null;
  tenantSlug: string;
}) {
  if (!result.recommendation.safety.recommendationAllowed) {
    return (
      <div className="widget-step">
        <AlertTriangle size={22} />
        <p>{result.recommendation.summary}</p>
      </div>
    );
  }

  return (
    <div className="widget-step">
      <p className="privacy-note">{result.recommendation.disclosureText}</p>
      <p>{result.explanation}</p>
      <div className="widget-products">
        {result.recommendation.items.map((item) => (
          <TrackedProductCard key={item.product.id} item={item} sessionId={sessionId} tenantSlug={tenantSlug} />
        ))}
      </div>
    </div>
  );
}

function TrackedProductCard({
  item,
  sessionId,
  tenantSlug,
}: {
  item: RoutineRecommendation["items"][number];
  sessionId: string | null;
  tenantSlug: string;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [tracked, setTracked] = useState(false);
  const product: ProductCatalogItem = item.product;

  useEffect(() => {
    if (!ref.current || tracked) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setTracked(true);
        fetch("/api/events/impression", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            tenantId: product.tenantId,
            sessionId,
            productId: product.id,
            metadata: { slot: item.slot },
          }),
        });
      }
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [item.slot, product.id, product.tenantId, sessionId, tracked]);

  return (
    <article ref={ref} className="widget-product-card">
      <div className="widget-product-topline">
        <span>Routine: {item.slot}</span>
        {item.sponsored ? <mark>Sponsored</mark> : null}
      </div>
      <div className="widget-product-body">
        {product.imageUrl ? <img className="product-shot" alt={product.name} src={product.imageUrl} /> : null}
        <div>
          <h3>{product.name}</h3>
          <p className="routine-meta">{product.brand} · {product.category} · {product.currency} {product.price}</p>
        </div>
      </div>
      <div className="routine-detail">
        <strong>Why use it</strong>
        <p>{item.reason}</p>
      </div>
      <div className="routine-detail">
        <strong>How it fits the routine</strong>
        <p>{item.usageGuidance}</p>
      </div>
      <div className="routine-detail">
        <strong>Safety concerns</strong>
        <ul>
          {item.cautions.slice(0, 3).map((caution) => (
            <li key={caution}>{caution}</li>
          ))}
        </ul>
      </div>
      <div className="routine-detail">
        <strong>Origin and brand trust</strong>
        <p>
          Merchant-approved OTC catalog product from {product.brand}. Claims are limited to approved cosmetic metadata,
          current stock status, and suitability filters.
        </p>
      </div>
      <a href={`/api/r/${product.id}?tenant=${tenantSlug}&sessionId=${sessionId ?? ""}`}>
        Shop product
        <ExternalLink size={15} />
      </a>
    </article>
  );
}

function split(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
