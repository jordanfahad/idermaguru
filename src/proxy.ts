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

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

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
    "/admin/:path*",
    "/api/widget/:path*",
    "/api/chat/:path*",
    "/api/recommendations",
    "/api/events/:path*",
  ],
};
