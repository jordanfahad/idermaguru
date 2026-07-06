import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma } from "@/server/db";
import { verifySessionToken } from "@/lib/session-token";
import { jsonError, parseJson, RequestValidationError } from "../../_shared";

const DeleteSchema = z.object({
  sessionId: z.string(),
  token: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const { sessionId, token } = await parseJson(request, DeleteSchema);
    const headerToken = request.headers.get("x-session-token");
    if (!(await verifySessionToken(token ?? headerToken, sessionId))) {
      return jsonError("Not authorized.", 403);
    }

    const prisma = getPrisma();
    if (prisma) {
      await prisma.userSession.update({
        where: { id: sessionId },
        data: { status: "DELETED" },
      });
    }
    return NextResponse.json({ deleted: true });
  } catch (error) {
    if (error instanceof RequestValidationError) return jsonError(error.message);
    throw error;
  }
}
