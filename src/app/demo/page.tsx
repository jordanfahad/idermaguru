import Link from "next/link";
import { SkinAdvisorWidget } from "@/components/skin-advisor-widget";

export default function DemoPage() {
  return (
    <main className="plain-page">
      <header>
        <p className="eyebrow">AI Cosmetologist / AI Derma Guru demo</p>
        <h1>Scanner-style OTC skincare recommendations.</h1>
        <p className="lead">
          A multi-tenant SaaS widget for conservative skincare guidance, catalog-safe product discovery,
          sponsored disclosure, click attribution, and revenue tracking.
        </p>
        <Link className="share-link" href="/admin">
          Merchant admin
        </Link>
      </header>
      <SkinAdvisorWidget mode="full" tenantSlug="ai-derma-guru" />
    </main>
  );
}
