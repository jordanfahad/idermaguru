import type { ReactNode } from "react";
import "./admin-theme.css";

/**
 * Wraps every /admin route in `.dg-admin` so the quiet-luxe admin theme
 * (admin-theme.css) applies here and ONLY here — the admin pages share semantic
 * classes (plain-page, metric, table-like…) with public pages like
 * /live-consultation-1, so the restyle must stay scoped. No markup or behavior
 * changes to the admin pages themselves; auth stays enforced in proxy.ts.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <div className="dg-admin">{children}</div>;
}
