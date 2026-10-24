/**
 * Link sticker URL handling for the story composer (buyer-story-create.tsx).
 *
 * People type "example.com/shop" far more often than a full URL, so a
 * missing scheme becomes https://. Anything that isn't a plain http(s) web
 * address (other schemes, no dot in the host, spaces) is rejected so a dead
 * or unsafe link is never published.
 */

export const STORY_LINK_LABEL_MAX = 30;

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
// host: dot-separated labels ending in a 2+ letter TLD, optional port, then an optional path/query/fragment.
const WEB_URL = /^https?:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?(?:[/?#]\S*)?$/i;

/** A valid http(s) URL for a link sticker (scheme added when missing), or null when the input isn't one. */
export function normalizeStoryLinkUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const scheme = SCHEME.exec(trimmed)?.[1]?.toLowerCase();
  // "localhost:3000" parses as a scheme too; only a real "x://" or a known web scheme counts.
  const hasScheme = !!scheme && (trimmed.slice(scheme.length + 1).startsWith('//') || scheme === 'http' || scheme === 'https');
  if (hasScheme && scheme !== 'http' && scheme !== 'https') return null;
  const url = hasScheme ? trimmed.replace(SCHEME, (m) => m.toLowerCase()) : `https://${trimmed.replace(/^\/+/, '')}`;
  return WEB_URL.test(url) ? url : null;
}

/** What the sticker shows when no label was typed: the URL without its scheme or trailing slash. */
export function storyLinkDisplay(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
}
