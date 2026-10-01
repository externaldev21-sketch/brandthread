/**
 * Shared helpers for the store identity setup screens (store-setup-name,
 * store-setup-brand, store-setup-socials). The server owns every rule
 * (artifacts/api-server/src/lib/storeIdentity.ts) and re-validates on save;
 * these mirrors only keep obviously invalid input from hitting the network
 * and let the screens show the canonical link as the seller types.
 */

export const HANDLE_RE = /^[a-z0-9_]{3,30}$/;

/** Grey levels of the monochrome accent allowlist, black to white. */
export const STORE_ACCENT_LEVELS = [0, 74, 138, 192, 229, 255] as const;

/** Hex for a grey level — mirrors STORE_ACCENT_COLORS on the server. */
export function greyHex(level: number): string {
  return `#${level.toString(16).padStart(2, '0').repeat(3).toUpperCase()}`;
}

export const STORE_ACCENT_COLORS = STORE_ACCENT_LEVELS.map(greyHex);

export function normalizeHandleInput(raw: string): string {
  return raw.trim().replace(/^@+/, '').toLowerCase();
}

/** A handle suggestion derived from the store name, e.g. "Night Owl" -> "night_owl". */
export function suggestHandle(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);
}

export type SocialPlatform = 'instagram' | 'tiktok';
export type SocialPreview =
  | { status: 'empty' }
  | { status: 'ok'; display: string }
  | { status: 'invalid'; error: string };

const SOCIAL_HOSTS: Record<SocialPlatform, string> = { instagram: 'instagram.com', tiktok: 'tiktok.com' };
const SOCIAL_HANDLE_RE: Record<SocialPlatform, RegExp> = {
  instagram: /^[a-z0-9._]{1,30}$/,
  tiktok: /^[a-z0-9._]{2,24}$/,
};
const SOCIAL_LABEL: Record<SocialPlatform, string> = { instagram: 'Instagram', tiktok: 'TikTok' };

/** Reads a handle or profile link and returns the handle it points at, or null. */
export function parseSocialHandle(platform: SocialPlatform, raw: string): string | null {
  const input = raw.trim();
  let handle: string;
  if (/^https?:\/\//i.test(input) || input.includes('/')) {
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    } catch {
      return null;
    }
    if (url.username || url.password) return null;
    if (url.hostname.toLowerCase().replace(/^(www|m)\./, '') !== SOCIAL_HOSTS[platform]) return null;
    const first = url.pathname.split('/').filter(Boolean)[0];
    if (!first) return null;
    try {
      handle = decodeURIComponent(first).replace(/^@/, '').toLowerCase();
    } catch {
      return null;
    }
  } else {
    handle = input.replace(/^@+/, '').toLowerCase();
  }
  if (!SOCIAL_HANDLE_RE[platform].test(handle) || /^\.|\.$|\.\./.test(handle)) return null;
  return handle;
}

export function previewSocialLink(platform: SocialPlatform, raw: string): SocialPreview {
  if (!raw.trim()) return { status: 'empty' };
  const handle = parseSocialHandle(platform, raw);
  if (!handle) {
    return { status: 'invalid', error: `Enter a ${SOCIAL_LABEL[platform]} handle or a link to your ${SOCIAL_LABEL[platform]} profile.` };
  }
  return { status: 'ok', display: platform === 'instagram' ? `instagram.com/${handle}` : `tiktok.com/@${handle}` };
}

/** The handle out of a stored canonical URL, for prefilling the field. */
export function handleFromStoredLink(platform: SocialPlatform, stored: string | undefined): string {
  if (!stored) return '';
  return parseSocialHandle(platform, stored) ?? stored;
}
