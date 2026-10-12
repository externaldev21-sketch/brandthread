/**
 * Profile banner API shapes + the upload query string (kept apart from
 * lib/api.ts so they're testable without the full client).
 */
/**
 * TikTok-style profile banner (the profile cover): a looping muted video or a
 * GIF. `url` is what plays — the MP4 rendition (videos, and GIFs the server
 * converted) or the original GIF; `gifUrl` is a GIF banner's original file.
 * `type: 'image'` is only a seller's former 3:1 storefront banner, adopted
 * as their banner server-side (never offered in the picker).
 */
export interface ProfileBanner { type: 'video' | 'gif' | 'image'; url: string; posterUrl: string | null; gifUrl?: string | null }
/** Normalized (0–1) crop rect from the banner crop screen. */
export interface ProfileBannerCrop { x: number; y: number; width: number; height: number }

/** `?trimStart=…&cropX=…` for the cover/banner upload routes ('' when neither is set). */
export function coverQuery(
  trim?: { start: number; duration: number } | null,
  crop?: ProfileBannerCrop | null,
): string {
  const params: string[] = [];
  if (trim) params.push(`trimStart=${trim.start.toFixed(2)}`, `trimDuration=${trim.duration.toFixed(2)}`);
  if (crop) {
    params.push(
      `cropX=${crop.x.toFixed(4)}`,
      `cropY=${crop.y.toFixed(4)}`,
      `cropW=${crop.width.toFixed(4)}`,
      `cropH=${crop.height.toFixed(4)}`,
    );
  }
  return params.length ? `?${params.join('&')}` : '';
}
