import { NextResponse } from "next/server";
import { getPrisma } from "@/server/db";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const prisma = getPrisma();

  if (prisma) {
    await prisma.uploadedImage.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  return NextResponse.json({ deleted: true });
}
