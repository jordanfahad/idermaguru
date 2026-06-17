"use client";

import {
  ArrowRight,
  BarChart3,
  ExternalLink,
  Loader2,
  LogIn,
  Mic,
  MicOff,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { Product } from "@/lib/products";
import type { Recommendation } from "@/lib/recommendations";

type Props = {
  products: Product[];
};

type AdvisorResponse = {
  recommendation: Recommendation;
  products: Product[];
  pageUrl: string;
  warning?: string;
  source: "ai" | "fallback";
};

type SpeechRecognitionConstructor = new () => {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionEvent = {
  results: {
    [index: number]: {
      [index: number]: {
        transcript: string;
      };
    };
    length: number;
  };
};

const concernChips = [
  "dark spots after acne",
  "redness and sensitivity",
  "texture and dullness",
  "dry flaky barrier",
  "oily t-zone with blemishes",
];

export function AdvisorExperience({ products }: Props) {
  const [concern, setConcern] = useState(
    "I have post-acne dark spots, a little redness, and I want a simple glow routine.",
  );
  const [skinType, setSkinType] = useState("combination");
  const [goals, setGoals] = useState("glow, calm, even tone");
  const [isListening, setIsListening] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<AdvisorResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const featuredProducts = useMemo(() => products.slice(0, 4), [products]);

  async function submitConcern() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          concern,
          skinType,
          goals: goals
            .split(",")
            .map((goal) => goal.trim())
            .filter(Boolean),
        }),
      });

      if (!response.ok) {
        throw new Error("The beauty advisor could not create a routine yet.");
      }

      const payload = (await response.json()) as AdvisorResponse;
      setResult(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsLoading(false);
    }
  }

  function startVoice() {
    const api = window as typeof window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const Recognition = api.SpeechRecognition ?? api.webkitSpeechRecognition;

    if (!Recognition) {
      setError("Voice input is not available in this browser.");
      return;
    }

    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      const transcript = event.results[event.results.length - 1][0].transcript;
      setConcern((current) => `${current ? `${current} ` : ""}${transcript}`.trim());
    };
    recognition.onend = () => setIsListening(false);
    recognition.start();
    setIsListening(true);
  }

  return (
    <main>
      <nav className="topbar" aria-label="Primary navigation">
        <Link className="brand" href="/">
          <span className="brand-mark">ADG</span>
          <span>AI Derma Guru</span>
        </Link>
        <div className="nav-actions">
          <Link className="icon-link" href="/dashboard" aria-label="View traffic dashboard">
            <BarChart3 size={18} />
          </Link>
          <Link className="icon-link with-text" href="/login">
            <LogIn size={18} />
            Login
          </Link>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">AI cosmetic concierge for skincare shoppers</p>
          <h1>Sephora-style beauty advice, built to send qualified traffic.</h1>
          <p className="hero-text">
            Shoppers speak or type their skin concern, get a fun OTC beauty routine, and every
            recommendation becomes a trackable SEO page with approved product links.
          </p>
          <div className="hero-metrics" aria-label="Product metrics">
            <span>
              <strong>Voice</strong>
              Intake
            </span>
            <span>
              <strong>SEO</strong>
              Pages
            </span>
            <span>
              <strong>OTC</strong>
              Only
            </span>
          </div>
        </div>
      </section>

      <section className="advisor-shell" aria-label="AI skincare advisor">
        <div className="advisor-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">AI Derma Guru</p>
              <h2>Tell me what your skin is doing today.</h2>
            </div>
            <button
              className={`mic-button ${isListening ? "active" : ""}`}
              type="button"
              onClick={isListening ? undefined : startVoice}
              aria-label={isListening ? "Listening" : "Start voice input"}
              title={isListening ? "Listening" : "Start voice input"}
            >
              {isListening ? <MicOff size={20} /> : <Mic size={20} />}
            </button>
          </div>

          <textarea
            value={concern}
            onChange={(event) => setConcern(event.target.value)}
            placeholder="Share your concern, routine, budget, or vibe..."
          />

          <div className="chip-row" aria-label="Concern examples">
            {concernChips.map((chip) => (
              <button key={chip} type="button" onClick={() => setConcern(chip)}>
                {chip}
              </button>
            ))}
          </div>

          <div className="form-grid">
            <label>
              Skin type
              <select value={skinType} onChange={(event) => setSkinType(event.target.value)}>
                <option value="dry">Dry</option>
                <option value="normal">Normal</option>
                <option value="combination">Combination</option>
                <option value="oily">Oily</option>
                <option value="sensitive">Sensitive</option>
              </select>
            </label>
            <label>
              Goals
              <input value={goals} onChange={(event) => setGoals(event.target.value)} />
            </label>
          </div>

          <button className="primary-button" type="button" onClick={submitConcern}>
            {isLoading ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
            Get my routine
          </button>

          {error ? <p className="error-text">{error}</p> : null}
          <p className="safety-note">
            Cosmetic guidance only. This does not diagnose skin conditions or replace a licensed
            clinician.
          </p>
        </div>

        <div className="result-panel" aria-live="polite">
          {result ? (
            <RecommendationResult result={result} />
          ) : (
            <div className="empty-state">
              <Search size={28} />
              <h2>Your routine will appear here.</h2>
              <p>
                The advisor creates product picks, safety notes, and a public page URL that can
                rank later for long-tail skin concerns.
              </p>
              <div className="mini-products">
                {featuredProducts.map((product) => (
                  <span key={product.id}>{product.brand}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function RecommendationResult({ result }: { result: AdvisorResponse }) {
  return (
    <div className="recommendation">
      <div className="result-heading">
        <div>
          <p className="eyebrow">{result.source === "ai" ? "AI routine" : "Smart fallback"}</p>
          <h2>{result.recommendation.title}</h2>
        </div>
        <Link className="share-link" href={result.pageUrl}>
          SEO page
          <ArrowRight size={16} />
        </Link>
      </div>

      {result.warning ? (
        <div className="warning">
          <ShieldCheck size={18} />
          {result.warning}
        </div>
      ) : null}

      <p className="summary">{result.recommendation.summary}</p>

      <div className="routine-list">
        {result.recommendation.routine.map((step) => {
          const product = result.products.find((item) => item.id === step.productId);
          if (!product) return null;

          return (
            <article className="product-card" key={`${step.step}-${product.id}`}>
              <div>
                <p className="routine-step">{step.step}</p>
                <h3>{product.name}</h3>
                <p>{step.note}</p>
                <span>{step.timing}</span>
              </div>
              <a href={`/api/out/${product.id}?recommendation=${result.recommendation.slug}`}>
                Shop
                <ExternalLink size={15} />
              </a>
            </article>
          );
        })}
      </div>

      <div className="avoid-box">
        <p>Keep it pretty, keep it careful:</p>
        {result.recommendation.avoid.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
    </div>
  );
}
