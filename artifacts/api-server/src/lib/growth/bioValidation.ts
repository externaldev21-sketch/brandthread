/** Validation for link-in-bio content. Everything public is normalised here. */

export const SOCIAL_KEYS = ["instagram", "tiktok", "youtube", "x", "facebook", "website", "email"] as const;
export type SocialKey = (typeof SOCIAL_KEYS)[number];

const HANDLE_RE = /^@?([A-Za-z0-9._]{1,30})$/;
const HOSTS: Record<string, string[]> = {
  instagram: ["instagram.com"],
  tiktok: ["tiktok.com"],
  youtube: ["youtube.com", "youtu.be"],
  x: ["x.com", "twitter.com"],
  facebook: ["facebook.com", "fb.com"],
};

/** Only http(s) URLs with a real host; no credentials; <= 500 chars. */
export function normalizeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v || v.length > 500 || /[\s<>"']/.test(v)) return null;
  const withScheme = /^https?:\/\//i.test(v) ? v : /^[a-z][a-z0-9+.-]*:/i.test(v) ? "" : `https://${v}`;
  if (!withScheme) return null;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password) return null;
    if (!u.hostname.includes(".") || u.hostname.length > 253) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** A bio link may be a web URL or a mailto:/tel: link. */
export function normalizeBioLinkUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (/^mailto:/i.test(v)) {
    const addr = v.slice(7);
    return /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(addr) && addr.length <= 200 ? `mailto:${addr}` : null;
  }
  if (/^tel:/i.test(v)) {
    const num = v.slice(4);
    return /^\+?[0-9() .-]{5,25}$/.test(num) ? `tel:${num.replace(/[ ().-]/g, "")}` : null;
  }
  return normalizeHttpUrl(v);
}

export function normalizeSocial(key: string, raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v) return null;
  if (key === "email") {
    return /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(v) && v.length <= 200 ? `mailto:${v}` : null;
  }
  if (key === "website") return normalizeHttpUrl(v);
  if (!(key in HOSTS)) return null;
  const handle = HANDLE_RE.exec(v);
  if (handle) {
    const h = handle[1];
    if (key === "instagram") return `https://www.instagram.com/${h}`;
    if (key === "tiktok") return `https://www.tiktok.com/@${h}`;
    if (key === "x") return `https://x.com/${h}`;
    if (key === "facebook") return `https://www.facebook.com/${h}`;
    if (key === "youtube") return `https://www.youtube.com/@${h}`;
  }
  const url = normalizeHttpUrl(v);
  if (!url) return null;
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  return HOSTS[key].some((h) => host === h || host.endsWith(`.${h}`)) ? url : null;
}

export function normalizeSocials(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== "object") return out;
  for (const key of SOCIAL_KEYS) {
    const n = normalizeSocial(key, (input as Record<string, unknown>)[key]);
    if (n) out[key] = n;
  }
  return out;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
export function normalizeAccent(raw: unknown): string | null {
  return typeof raw === "string" && HEX_RE.test(raw.trim()) ? raw.trim().toLowerCase() : null;
}

export function cleanText(raw: unknown, max: number): string {
  return typeof raw === "string" ? raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max) : "";
}

export function slugifyBio(raw: string): string {
  const s = raw.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/-{2,}/g, "-").replace(/^[-_]+|[-_]+$/g, "").slice(0, 40);
  return s.length >= 3 ? s : "";
}

export const BIO_SLUG_RE = /^[a-z0-9][a-z0-9_-]{2,39}$/;
/** Link buttons per page — the store website shows up to five (storeSiteDesign.MAX_STORE_SITE_LINKS). */
export const MAX_BIO_LINKS = 5;
export const MAX_FEATURED = 6;
