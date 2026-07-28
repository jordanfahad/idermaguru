import { NextResponse, type NextRequest } from "next/server";
import { getAdminSessionCookieName, verifyAdminSession } from "@/lib/admin-auth";

// Endpoints the embeddable widget calls cross-origin from a merchant's store.
const WIDGET_API_PREFIXES = ["/api/widget", "/api/chat", "/api/recommendations", "/api/events"];

function isWidgetApi(pathname: string): boolean {
  return WIDGET_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function corsHeaders(): Record<string, string> {
  // Public, non-credentialed JSON endpoints — safe to allow any origin so the
  // widget works on any merchant store. Cookied admin routes are not in scope here.
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
  };
}

/**
 * A hostname that exists to serve one merchant's advisor and nothing else.
 *
 * A merchant points `advisor.theirstore.com` at this deployment so the
 * microphone prompt says their name instead of ours. Without the guard below
 * that subdomain also serves DermaGuru's marketing site, pricing, login and
 * admin — on the merchant's own brand.
 *
 * Set ADVISOR_HOSTS to a comma-separated list to be explicit; otherwise any
 * host beginning "advisor." is treated as one.
 */
export function isAdvisorHost(host: string | null): boolean {
  const name = (host ?? "").toLowerCase().split(":")[0].trim();
  if (!name) return false;
  const configured = (process.env.ADVISOR_HOSTS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return configured.length ? configured.includes(name) : name.startsWith("advisor.");
}

/**
 * What an advisor host is allowed to serve. Everything the advisor itself
 * needs, the legal pages its disclaimer links to, and nothing else.
 */
const ADVISOR_ALLOWED = ["/advisor", "/api/", "/privacy-policy", "/terms-of-use", "/opengraph-image"];

function allowedOnAdvisorHost(pathname: string): boolean {
  return ADVISOR_ALLOWED.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isAdvisorHost(request.headers.get("host"))) {
    // The root IS the advisor here. Rewritten, not redirected, so the shopper
    // sees advisor.theirstore.com rather than .../advisor.
    if (pathname === "/") {
      const url = request.nextUrl.clone();
      url.pathname = "/advisor";
      return NextResponse.rewrite(url);
    }
    if (!allowedOnAdvisorHost(pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  if (isWidgetApi(pathname)) {
    if (request.method === "OPTIONS") {
      return new NextResponse(null, { status: 204, headers: corsHeaders() });
    }
    const response = NextResponse.next();
    for (const [key, value] of Object.entries(corsHeaders())) {
      response.headers.set(key, value);
    }
    return response;
  }

  if (!pathname.startsWith("/admin") || pathname === "/admin/login") {
    return NextResponse.next();
  }

  const session = await verifyAdminSession(request.cookies.get(getAdminSessionCookieName())?.value);
  if (!session) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  const superAdminOnly = pathname.startsWith("/admin/live-consultations") || pathname.startsWith("/admin/merchants");
  if (superAdminOnly && session.role !== "super_admin") {
    const url = request.nextUrl.clone();
    url.pathname = "/admin";
    url.searchParams.set("locked", "super-admin");
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Everything except Next's internals and static files. The previous list
    // named only /admin and the widget APIs, so the middleware never ran on a
    // page route at all — which meant an advisor subdomain would have served
    // the marketing homepage, with the admin login one path away.
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:js|css|map|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|mp3|txt|xml)$).*)",
  ],
};
