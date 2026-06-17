import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <main className="plain-page">
      <header>
        <Link className="share-link" href="/">
          <ArrowLeft size={16} />
          Back to guru
        </Link>
        <p className="eyebrow">Customer login</p>
        <h1>See the traffic your recommendations generate.</h1>
        <p className="lead">
          Magic-link login is ready for Supabase Auth. After the project is connected, customer
          accounts can be mapped to domains and product traffic.
        </p>
      </header>
      <section className="login-panel">
        <LoginForm />
      </section>
    </main>
  );
}
