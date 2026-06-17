import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createAdminSession,
  getAdminSessionCookieName,
  getAdminSessionMaxAge,
  isSuperAdminCredentials,
  type AdminRole,
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
    let role: AdminRole = "merchant";

    if (input.role === "super_admin") {
      if (!isSuperAdminCredentials(input.email, input.password)) {
        return jsonError("Invalid super-admin credentials.", 401);
      }
      role = "super_admin";
    }

    const cookie = await createAdminSession(input.email, role);
    const response = NextResponse.json({ ok: true, role });
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
