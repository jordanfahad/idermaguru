import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createAdminSession,
  getAdminSessionCookieName,
  getAdminSessionMaxAge,
  isSuperAdminCredentials,
} from "@/lib/admin-auth";
import { jsonError, parseJson, RequestValidationError } from "../../../_shared";

const LoginSchema = z.object({
  role: z.enum(["merchant", "super_admin"]),
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const input = await parseJson(request, LoginSchema);

    // Merchant accounts are not yet provisioned (see docs/SECURITY-AUDIT.md):
    // there is no credential store to verify a per-tenant merchant against, so
    // the previous code minted a merchant session for anyone. Until a
    // MerchantUser store exists, only the super-admin may authenticate and the
    // admin data plane is super_admin-only. The error is intentionally generic.
    if (input.role !== "super_admin" || !isSuperAdminCredentials(input.email, input.password)) {
      return jsonError("Invalid credentials.", 401);
    }

    const cookie = await createAdminSession(input.email, "super_admin");
    const response = NextResponse.json({ ok: true, role: "super_admin" as const });
    response.cookies.set(getAdminSessionCookieName(), cookie, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      maxAge: getAdminSessionMaxAge(),
      path: "/",
    });
    return response;
  } catch (error) {
    if (error instanceof RequestValidationError) return jsonError(error.message);
    throw error;
  }
}
