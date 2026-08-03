import { NextResponse, type NextRequest } from "next/server";
import { getAdminSessionCookieName, verifyAdminSession } from "@/lib/admin-auth";

// Endpoints the embeddable widget calls cross-origin from a merchant's store.
const WIDGET_API_PREFIXES = ["/api/widget", "/api/chat", "/api/recommendations", "/api/events"];

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

/**
 * Prefix match on whole path segments: "/api/chat" covers "/api/chat/start"
 * but never "/api/chat-admin". A plain startsWith would hand a future route
 * the allowance of whichever existing one it happens to share letters with.
 */
function matchesApiPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isWidgetApi(pathname: string): boolean {
  return matchesApiPrefix(pathname, WIDGET_API_PREFIXES);
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
const ADVISOR_ALLOWED = ["/advisor", "/privacy-policy", "/terms-of-use", "/opengraph-image"];

/**
 * The only API this host answers, read off the code that actually runs on it.
 *
 * `/api/voice-agent` is the advisor's whole conversation — the turn itself,
 * transcribe, speech, vision and client-log. `/api/cart` is the permalink
 * behind "add routine to cart", which the advisor links to relatively and so
 * resolves on the merchant's own subdomain. The widget endpoints are here
 * because dermaguru-widget.js sends its requests back to the origin the script
 * was served from, so a merchant who serves the script from their subdomain
 * gets chat, recommendations and events on it; those four are the public,
 * non-credentialed set that already answers any origin (see corsHeaders).
 *
 * This list was once the single entry "/api/", which meant that pointing DNS
 * at us also published POST /api/admin/auth/login on the merchant's brand —
 * unlimited guessing against one hardcoded address, see src/lib/admin-auth.ts
 * — along with /api/billing/portal, /api/billing/checkout and
 * /api/shopify/install. Adding a prefix here publishes it on every merchant
 * domain we serve, so add one only for something the advisor itself calls.
 */
const ADVISOR_API_PREFIXES = ["/api/voice-agent", "/api/cart", ...WIDGET_API_PREFIXES];

function allowedOnAdvisorHost(pathname: string): boolean {
  if (isApiPath(pathname)) return matchesApiPrefix(pathname, ADVISOR_API_PREFIXES);
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
      // A blocked API answers 404, never the redirect a blocked page gets.
      // NextResponse.redirect is a 307, which preserves the method and the
      // body, so a POST of admin credentials aimed at this host would be
      // replayed at "/" by any client that follows redirects rather than
      // stopped — and a redirect still tells the caller the endpoint exists
      // somewhere. 404 is also the truth: on a merchant's subdomain there is
      // no API plane beyond the advisor's own.
      if (isApiPath(pathname)) {
        return new NextResponse(null, { status: 404 });
      }
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
    // Everything except Next's internals, static files, and the speech route.
    //
    // The previous list named only /admin and the widget APIs, so the
    // middleware never ran on a page route at all — which meant an advisor
    // subdomain would have served the marketing homepage, with the admin login
    // one path away.
    //
    // Speech is excluded deliberately. Those responses are `public, immutable`
    // so they can be served from a point of presence near the shopper, and
    // there is nothing to gain from waking middleware on an audio file that is
    // already allowed on every host. Running on it risks the one cache that
    // matters most for how fast the advisor feels.
    "/((?!_next/static|_next/image|favicon\\.ico|api/voice-agent/speech|.*\\.(?:js|css|map|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|mp3|txt|xml)$).*)",
  ],
};
