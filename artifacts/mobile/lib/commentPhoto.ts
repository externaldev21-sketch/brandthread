/** Pure helpers for photo replies in comments (components/comments/CommentPhoto.tsx). */

/** Box for a comment photo: fits inside maxW × maxH, keeps the aspect ratio. */
export function commentPhotoSize(
  width: number | null | undefined,
  height: number | null | undefined,
  maxW = 200,
  maxH = 240,
): { width: number; height: number } {
  const w = width && width > 0 ? width : 1;
  const h = height && height > 0 ? height : 1;
  const scale = Math.min(maxW / w, maxH / h);
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** The server takes JPEG / PNG / WebP; pickers re-encode HEIC to JPEG at quality < 1. */
export function uploadMimeType(mime: string | null | undefined): string {
  const m = (mime ?? '').toLowerCase();
  return m === 'image/png' || m === 'image/webp' ? m : 'image/jpeg';
}
