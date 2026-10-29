/**
 * The profile-photo upload pipeline, shared by every "square identity image":
 * a person's avatar / logo (routes/seller-profile.ts) and a community's group
 * photo (routes/communities.ts). One set of checks, in one order:
 *
 *   raw image body (or an upload-session handoff) → allowed type → size cap →
 *   magic-byte signature → automatic screening → normalise (EXIF strip, cap).
 *
 * Callers own where the cleaned bytes are stored and which row points at them.
 */
import { MEDIA_REJECTED_MESSAGE, screenImageBuffer } from "./mediaModeration";
import { normalizeUploadedImage } from "./productImageResize";

export const PROFILE_IMAGE_MIMES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
// Originals now arrive untouched from the app (no client re-encode), so the caps
// fit a full-res phone photo; the server does the one encode (lib/productImageResize).
export const MAX_PROFILE_IMAGE_BYTES = 15 * 1024 * 1024;

export function hasValidImageSignature(bytes: Buffer, contentType: string): boolean {
  if (contentType === "image/jpeg" || contentType === "image/jpg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === "image/png") {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  return bytes.length >= 12
    && bytes.subarray(0, 4).toString() === "RIFF"
    && bytes.subarray(8, 12).toString() === "WEBP";
}

export type ProfileImageCheck =
  | { ok: true; image: { buffer: Buffer; contentType: string } }
  | { ok: false; status: number; body: { error: string; code?: string } };

/**
 * Validates, screens and normalises an uploaded identity image. Identity
 * images have no held state, so anything screening flags is refused.
 */
export async function checkProfileImageUpload(input: {
  bytes: unknown;
  contentType: string;
  maxBytes: number;
  label: string;
  ownerId: string;
}): Promise<ProfileImageCheck> {
  const { bytes, contentType, maxBytes, label, ownerId } = input;
  if (!PROFILE_IMAGE_MIMES.has(contentType)) {
    return { ok: false, status: 400, body: { error: `Use a JPEG, PNG, or WebP image for your ${label}.` } };
  }
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > maxBytes) {
    return { ok: false, status: 400, body: { error: `Your ${label} image must be no larger than ${Math.round(maxBytes / (1024 * 1024))} MB.` } };
  }
  if (!hasValidImageSignature(bytes, contentType)) {
    return { ok: false, status: 400, body: { error: "The uploaded file does not match its declared image type." } };
  }

  // Automatic screening (off when the AI integration env is missing).
  const screened = await screenImageBuffer(bytes, contentType);
  if ((screened.verdict === "hold" && !screened.unverified) || screened.verdict === "reject") {
    void import("./mediaModerationStore").then((m) => m.recordRejectedUpload({ ownerId, surface: label, verdict: { ...screened, verdict: "reject" } }));
    return { ok: false, status: 422, body: { error: MEDIA_REJECTED_MESSAGE, code: "IMAGE_REJECTED" } };
  }

  return { ok: true, image: await normalizeUploadedImage(bytes, contentType) };
}
