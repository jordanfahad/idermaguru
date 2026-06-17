import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma } from "@/server/db";
import { jsonError, parseJson, RequestValidationError } from "../../_shared";

const DeleteSchema = z.object({
  sessionId: z.string(),
});

export async function POST(request: Request) {
  try {
    const { sessionId } = await parseJson(request, DeleteSchema);
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
