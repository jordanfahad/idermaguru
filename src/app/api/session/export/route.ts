import { NextResponse } from "next/server";
import { getPrisma } from "@/server/db";
import { verifySessionToken } from "@/lib/session-token";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ error: "sessionId is required." }, { status: 400 });

  const token = request.headers.get("x-session-token") ?? url.searchParams.get("token");
  if (!(await verifySessionToken(token, sessionId))) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

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
