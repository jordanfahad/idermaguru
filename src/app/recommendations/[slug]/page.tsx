import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ExternalLink, ShieldCheck } from "lucide-react";
import {
  createFallbackRecommendation,
  type Recommendation,
} from "@/lib/recommendations";
import { getProductById } from "@/lib/products";
import { getSupabaseAdmin } from "@/lib/supabase/server";

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const recommendation = await getRecommendation(slug);

  return {
    title: recommendation.seoTitle,
    description: recommendation.seoDescription,
    openGraph: {
      title: recommendation.seoTitle,
      description: recommendation.seoDescription,
      type: "article",
    },
  };
}

export default async function RecommendationPage({ params }: Props) {
  const { slug } = await params;
  const recommendation = await getRecommendation(slug);

  return (
    <main className="plain-page">
      <header>
        <Link className="share-link" href="/">
          <ArrowLeft size={16} />
          Back to guru
        </Link>
        <p className="eyebrow">AI Derma Guru OTC routine</p>
        <h1>{recommendation.title}</h1>
        <p className="lead">{recommendation.summary}</p>
      </header>

      <section className="warning">
        <ShieldCheck size={18} />
        Cosmetic shopping guidance only. For pain, infection signs, severe acne, rapidly changing moles, or spreading
        rashes, speak with a licensed clinician.
      </section>

      <section className="routine-list" aria-label="Recommended AI Derma Guru products">
        {recommendation.routine.map((step) => {
          const embeddedProduct = step.product;
          const product = embeddedProduct ?? getProductById(step.productId);
          if (!product) return null;
          const productUrl = embeddedProduct?.url ?? `/api/out/${product.id}?recommendation=${recommendation.slug}`;
          const price = embeddedProduct?.afterPrice ?? product.price;

          return (
            <article className="product-card" key={`${step.step}-${product.id}`}>
              {embeddedProduct?.imageUrl ? <img alt={product.name} src={embeddedProduct.imageUrl} /> : null}
              <div>
                <p className="routine-step">{step.step}</p>
                <h2>{product.name}</h2>
                <p>{step.note}</p>
                <span>
                  {step.timing} - {price}
                </span>
              </div>
              <a href={productUrl}>
                Shop product
                <ExternalLink size={15} />
              </a>
            </article>
          );
        })}
      </section>

      <section className="avoid-box">
        <p>AI Derma Guru guardrails</p>
        {recommendation.avoid.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </section>
    </main>
  );
}

async function getRecommendation(slug: string): Promise<Recommendation> {
  const supabase = getSupabaseAdmin();

  if (supabase) {
    const { data } = await supabase
      .from("recommendations")
      .select("*")
      .eq("slug", slug)
      .maybeSingle();

    if (data) {
      return {
        title: data.title,
        slug: data.slug,
        concern: data.concern,
        skinType: data.skin_type,
        summary: data.summary,
        routine: Array.isArray(data.routine)
          ? (data.routine as Recommendation["routine"])
          : [],
        avoid: Array.isArray(data.avoid) ? (data.avoid as string[]) : [],
        seoTitle: data.seo_title,
        seoDescription: data.seo_description,
        createdAt: data.created_at,
      };
    }
  }

  return createFallbackRecommendation({
    concern: slug.replace(/-/g, " "),
    skinType: "combination",
    goals: ["glow"],
  });
}
