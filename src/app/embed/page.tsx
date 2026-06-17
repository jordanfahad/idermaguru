import { SkinAdvisorWidget } from "@/components/skin-advisor-widget";

type EmbedPageProps = {
  searchParams: Promise<{
    tenant?: string;
  }>;
};

export default async function EmbedPage({ searchParams }: EmbedPageProps) {
  const params = await searchParams;
  const tenantSlug = params.tenant || "ai-derma-guru";

  return (
    <main className="embed-page">
      <SkinAdvisorWidget mode="full" tenantSlug={tenantSlug} />
    </main>
  );
}
