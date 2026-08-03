import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // /dashboard is one merchant's own click figures. It shipped both
      // crawlable and listed in the sitemap, so the only thing keeping a
      // competitor's analytics out of search results was that nobody had
      // crawled it yet.
      disallow: ["/admin", "/dashboard", "/api/", "/recommendations/live-consultation-result-"],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
