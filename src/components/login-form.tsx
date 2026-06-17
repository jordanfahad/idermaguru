"use client";

import { Loader2, Mail } from "lucide-react";
import { FormEvent, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/browser";
import { getBrowserSiteUrl } from "@/lib/site-url";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(null);
    setIsLoading(true);

    const supabase = getSupabaseBrowser();

    if (!supabase) {
      setStatus("Supabase Auth is not connected yet. Add project env vars after creating the database.");
      setIsLoading(false);
      return;
    }

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${getBrowserSiteUrl()}/auth/callback?next=/dashboard`,
      },
    });

    setStatus(error ? error.message : "Check your inbox for the magic login link.");
    setIsLoading(false);
  }

  return (
    <form onSubmit={submit}>
      <label>
        Email
        <input
          autoComplete="email"
          inputMode="email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="founder@brand.com"
          required
          type="email"
          value={email}
        />
      </label>
      <button className="primary-button" type="submit">
        {isLoading ? <Loader2 className="spin" size={18} /> : <Mail size={18} />}
        Send magic link
      </button>
      {status ? <p className="safety-note">{status}</p> : null}
    </form>
  );
}
