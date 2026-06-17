import { NextResponse } from "next/server";
import { getPrisma } from "@/server/db";

export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ error: "sessionId is required." }, { status: 400 });

  const prisma = getPrisma();
  if (!prisma) {
    return NextResponse.json({ sessionId, data: null, note: "DATABASE_URL is not configured." });
  }

  const session = await prisma.userSession.findUnique({
    where: { id: sessionId },
    include: {
      consents: true,
      uploadedImages: true,
      intakeProfile: true,
      safetyResults: true,
      recommendations: { include: { items: true } },
      events: true,
      conversions: true,
    },
  });

  return NextResponse.json({ session });
}
