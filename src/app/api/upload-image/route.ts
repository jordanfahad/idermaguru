import { NextResponse } from "next/server";
import { IMAGE_CONSENT_TEXT } from "@/domain/skincare";
import { trackEvent } from "@/services/analytics";
import { getClientIp, hashIp } from "@/services/privacy";
import { storeImageLocally } from "@/services/storage/local-storage";
import { getPrisma } from "@/server/db";
import { jsonError } from "../_shared";

export async function POST(request: Request) {
  const form = await request.formData();
  const sessionId = String(form.get("sessionId") ?? "");
  const tenantId = String(form.get("tenantId") ?? "");
  const accepted = form.get("accepted") === "true";
  const consentText = String(form.get("consentText") ?? IMAGE_CONSENT_TEXT);
  const file = form.get("image");

  if (!sessionId) return jsonError("sessionId is required.");
  if (!tenantId) return jsonError("tenantId is required.");
  if (!accepted) return jsonError("Image upload requires explicit consent.");
  if (!(file instanceof File)) return jsonError("Image file is required.");

  const stored = await storeImageLocally(file, sessionId);
  const prisma = getPrisma();
  let imageId = crypto.randomUUID();

  if (prisma) {
    const consent = await prisma.consentRecord.create({
      data: {
        sessionId,
        consentType: "IMAGE_UPLOAD",
        consentText,
        accepted,
        ipHash: hashIp(getClientIp(request.headers)),
        userAgent: request.headers.get("user-agent"),
      },
    });

    const image = await prisma.uploadedImage.create({
      data: {
        sessionId,
        storageKey: stored.storageKey,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        consentRecordId: consent.id,
      },
    });
    imageId = image.id;
  }

  await trackEvent({
    tenantId,
    sessionId,
    type: "CONSENT_ACCEPTED",
    metadata: { consentType: "IMAGE_UPLOAD", consentText },
  });
  await trackEvent({
    tenantId,
    sessionId,
    type: "IMAGE_UPLOADED",
    metadata: { imageId, mimeType: stored.mimeType, sizeBytes: stored.sizeBytes },
  });

  return NextResponse.json({ imageId, ...stored });
}
