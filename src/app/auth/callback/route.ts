import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const DEFAULT_NEXT = "/dashboard";

/**
 * Where to send a merchant once the magic link has been exchanged.
 *
 * `next` rides in on a URL anyone can compose and mail out, and
 * `new URL(next, origin)` resolves an absolute value against that value's own
 * origin rather than ours — so /auth/callback?next=https://evil.example, or the
 * protocol-relative ?next=//evil.example, turned the login callback into an
 * open redirector wearing idermaguru.com. Only a path beginning with a single
 * "/" can name somewhere on this site.
 *
 * Tab, newline and carriage return are stripped first because the URL parser
 * strips them too, anywhere in the string: "/<tab>/evil.example" reaches it as
 * "//evil.example". A backslash in second position is the same trick from the
 * other side — for http(s) the parser reads "\" as "/".
 */
function safeNextPath(next: string | null): string {
  const candidate = (next ?? "").replace(/[\t\n\r]/g, "");
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.startsWith("/\\")) {
    return DEFAULT_NEXT;
  }
  return candidate;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const redirectTo = new URL(safeNextPath(requestUrl.searchParams.get("next")), requestUrl.origin);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!code || !supabaseUrl || !supabaseKey) {
    return NextResponse.redirect(redirectTo);
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options);
        });
      },
    },
  });

  await supabase.auth.exchangeCodeForSession(code);
  return NextResponse.redirect(redirectTo);
}
