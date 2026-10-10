/**
 * Product video rules — pure, so they're unit-testable without ffmpeg, object
 * storage or a database. One short silent video per product.
 */

export const PRODUCT_VIDEO_MAX_SECONDS = 60;
/** Container durations are rarely exact; allow a few frames of slack. */
export const PRODUCT_VIDEO_DURATION_TOLERANCE_SECONDS = 0.25;
export const PRODUCT_VIDEO_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
export const PRODUCT_VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);

/** Magic-byte sniff: the declared mime type must be allowed AND the bytes must look like MP4/MOV or WebM. */
export function isSupportedProductVideo(contentType: string, bytes: Buffer): boolean {
  if (!PRODUCT_VIDEO_TYPES.has(contentType)) return false;
  const isoMedia = bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp";
  const webm = bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  return isoMedia || webm;
}

export function productVideoDurationError(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return "Could not read this video";
  if (seconds > PRODUCT_VIDEO_MAX_SECONDS + PRODUCT_VIDEO_DURATION_TOLERANCE_SECONDS) {
    return `Product videos can be at most ${PRODUCT_VIDEO_MAX_SECONDS} seconds - trim it and try again`;
  }
  return null;
}
