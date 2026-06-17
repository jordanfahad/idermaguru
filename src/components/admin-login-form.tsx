"use client";

import { Loader2, LockKeyhole, Store } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import type { AdminRole } from "@/lib/admin-auth";

export function AdminLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [role, setRole] = useState<AdminRole>("merchant");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setStatus(null);

    const response = await fetch("/api/admin/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role, email, password }),
    });
    const payload = await response.json();
    setLoading(false);

    if (!response.ok) {
      setStatus(payload.error ?? "Login failed.");
      return;
    }

    const next = searchParams.get("next");
    router.push(next || (payload.role === "super_admin" ? "/admin/live-consultations" : "/admin"));
    router.refresh();
  }

  return (
    <form className="settings-form" onSubmit={submit}>
      <div className="role-switcher" aria-label="Choose admin role">
        <button
          className={role === "merchant" ? "active" : ""}
          type="button"
          onClick={() => setRole("merchant")}
        >
          <Store size={16} />
          Merchant
        </button>
        <button
          className={role === "super_admin" ? "active" : ""}
          type="button"
          onClick={() => setRole("super_admin")}
        >
          <LockKeyhole size={16} />
          Super admin
        </button>
      </div>
      <label>
        Email
        <input
          autoComplete="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </label>
      <label>
        Password
        <input
          autoComplete={role === "super_admin" ? "current-password" : "organization-title"}
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </label>
      <button className="primary-button" type="submit">
        {loading ? <Loader2 className="spin" size={18} /> : <LockKeyhole size={18} />}
        Login as {role === "super_admin" ? "super admin" : "merchant"}
      </button>
      {status ? <p className="error-text">{status}</p> : null}
    </form>
  );
}
