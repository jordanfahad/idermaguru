export const PRODUCTION_SITE_URL = "https://idermaguru.com";

export function getBrowserSiteUrl() {
  if (typeof window === "undefined") return PRODUCTION_SITE_URL;
  const configured = process.env.NEXT_PUBLIC_SITE_URL;

  if (configured && !configured.includes("localhost")) {
    return configured.replace(/\/$/, "");
  }

  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    return PRODUCTION_SITE_URL;
  }

  return window.location.origin;
}
