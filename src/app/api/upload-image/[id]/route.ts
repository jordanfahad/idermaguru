import { NextResponse } from "next/server";
import { getPrisma } from "@/server/db";
import { verifySessionToken } from "@/lib/session-token";
import { jsonError } from "../../_shared";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const token =
    request.headers.get("x-session-token") ?? new URL(request.url).searchParams.get("token");
  const prisma = getPrisma();

  if (prisma) {
    const image = await prisma.uploadedImage.findUnique({
      where: { id },
      select: { sessionId: true },
    });
    if (!image) return jsonError("Not found.", 404);
    if (!(await verifySessionToken(token, image.sessionId))) {
      return jsonError("Not authorized.", 403);
    }
    await prisma.uploadedImage.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  return NextResponse.json({ deleted: true });
}
