import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxUploadBytes = 5 * 1024 * 1024;

export type StoredFile = {
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
};

export async function storeImageLocally(file: File, sessionId: string): Promise<StoredFile> {
  if (!allowedMimeTypes.has(file.type)) {
    throw new Error("Only JPG, PNG, or WebP images are allowed.");
  }

  if (file.size > maxUploadBytes) {
    throw new Error("Image must be 5MB or smaller.");
  }

  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const storageKey = `uploads/${sessionId}/${crypto.randomUUID()}.${extension}`;
  const absolutePath = path.join(process.cwd(), ".local-storage", storageKey);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, Buffer.from(await file.arrayBuffer()));

  return {
    storageKey,
    mimeType: file.type,
    sizeBytes: file.size,
  };
}
