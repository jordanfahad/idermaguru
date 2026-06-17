import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminSessionCookieName, verifyAdminSession } from "@/lib/admin-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { jsonError, parseJson, RequestValidationError } from "../../_shared";

const MerchantSchema = z.object({
  displayName: z.string().min(2),
  domain: z.string().min(3),
  email: z.string().email().optional().or(z.literal("")),
  plan: z.string().optional(),
  catalogMode: z.string().optional(),
});

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "super_admin") return jsonError("Super-admin login required.", 401);

  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ merchants: [] });
  const { data, error } = await supabase.from("partner_domains").select("*").order("created_at", { ascending: false });
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ merchants: data ?? [] });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session || session.role !== "super_admin") return jsonError("Super-admin login required.", 401);

  try {
    const input = await parseJson(request, MerchantSchema);
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json({
        merchant: {
          id: crypto.randomUUID(),
          display_name: input.displayName,
          domain: input.domain,
          owner_id: input.email || null,
        },
      });
    }

    const { data, error } = await supabase
      .from("partner_domains")
      .insert({
        display_name: input.displayName,
        domain: input.domain,
        owner_id: null,
      })
      .select("id, display_name, domain, owner_id")
      .single();
    if (error) return jsonError(error.message, 500);
    return NextResponse.json({ merchant: data });
  } catch (error) {
    if (error instanceof RequestValidationError) return jsonError(error.message);
    throw error;
  }
}

async function getSession() {
  const cookieStore = await cookies();
  return verifyAdminSession(cookieStore.get(getAdminSessionCookieName())?.value);
}
