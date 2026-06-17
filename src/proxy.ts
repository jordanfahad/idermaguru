import { NextResponse, type NextRequest } from "next/server";
import { getAdminSessionCookieName, verifyAdminSession } from "@/lib/admin-auth";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
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
  matcher: ["/admin/:path*"],
};
