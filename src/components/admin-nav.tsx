import { cookies } from "next/headers";
import Link from "next/link";
import { getAdminSessionCookieName, verifyAdminSession } from "@/lib/admin-auth";

const merchantLinks = [
  ["Overview", "/admin"],
  ["Products", "/admin/products"],
  ["Import", "/admin/products/import"],
  ["Sponsored", "/admin/sponsored"],
  ["Analytics", "/admin/analytics"],
  ["Settings", "/admin/settings"],
] as const;

const superAdminLinks = [
  ["Platform", "/admin"],
  ["Merchants", "/admin/merchants"],
  ["Create account", "/admin/merchants/new"],
  ["Live pages", "/admin/live-consultations"],
  ["All products", "/admin/products"],
  ["Analytics", "/admin/analytics"],
  ["Settings", "/admin/settings"],
] as const;

export async function AdminNav() {
  const cookieStore = await cookies();
  const session = await verifyAdminSession(cookieStore.get(getAdminSessionCookieName())?.value);
  const links = session?.role === "super_admin" ? superAdminLinks : merchantLinks;

  return (
    <nav className="admin-nav" aria-label="Admin navigation">
      {links.map(([label, href]) => (
        <Link key={href} href={href}>
          {label}
        </Link>
      ))}
      <form action="/api/admin/auth/logout" method="post">
        <button className="secondary-button" type="submit">
          Logout
        </button>
      </form>
    </nav>
  );
}
