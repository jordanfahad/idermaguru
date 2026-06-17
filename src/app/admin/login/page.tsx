import { Suspense } from "react";
import { AdminLoginForm } from "@/components/admin-login-form";

export default function AdminLoginPage() {
  return (
    <main className="plain-page">
      <section className="login-panel">
        <p className="eyebrow">Secure access</p>
        <h1>Admin login.</h1>
        <p className="lead">
          Merchants can manage their storefront performance. Super admin can override live consultation pages,
          vendor mix, products, bundles, and attribution settings.
        </p>
        <Suspense>
          <AdminLoginForm />
        </Suspense>
      </section>
    </main>
  );
}
