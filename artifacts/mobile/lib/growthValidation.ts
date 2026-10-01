/** Client-side mirrors of the server's strict pixel / link checks (server is authoritative). */
export const META_PIXEL_RE = /^[0-9]{10,20}$/;
export const TIKTOK_PIXEL_RE = /^[A-Z0-9]{10,30}$/;

export function metaPixelError(v: string): string | null {
  const t = v.trim();
  return !t || META_PIXEL_RE.test(t) ? null : 'A Meta Pixel ID is 10 to 20 digits.';
}
export function tiktokPixelError(v: string): string | null {
  const t = v.trim().toUpperCase();
  return !t || TIKTOK_PIXEL_RE.test(t) ? null : 'A TikTok Pixel ID is 10 to 30 letters and numbers.';
}

export function formatRate(r: number): string {
  return `${(r * 100).toFixed(r > 0 && r < 0.1 ? 1 : 0)}%`;
}

export function normalizeUrlInput(v: string): string | null {
  const t = v.trim();
  if (!t || /\s/.test(t)) return null;
  if (/^(mailto|tel):/i.test(t)) return t;
  const withScheme = /^https?:\/\//i.test(t) ? t : /^[a-z][a-z0-9+.-]*:/i.test(t) ? '' : `https://${t}`;
  return /^https?:\/\/[^/\s]+\.[^/\s]+/i.test(withScheme) ? withScheme : null;
}
