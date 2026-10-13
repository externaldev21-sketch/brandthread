/**
 * DM link previews (polish #163). The first web link in a message gets a
 * card (Instagram Direct's link card): image, title, site. The server does
 * the fetching (GET /api/link-preview, SSRF-guarded); this keeps one request
 * per URL per app session.
 */
export type LinkPreview = {
  url: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  siteName: string;
};

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/i;

/** First http(s) link in a message, without trailing punctuation. Pure. */
export function firstLink(text: string | null | undefined): string | null {
  const match = text?.match(URL_RE)?.[0];
  if (!match) return null;
  let url = match.replace(/[.,;:!?)\]}>]+$/, '');
  // Keep a closing paren that belongs to the URL, e.g. …/Foo_(bar)
  if ((url.match(/\(/g)?.length ?? 0) > (url.match(/\)/g)?.length ?? 0) && match.charAt(url.length) === ')') url += ')';
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

const cache = new Map<string, Promise<LinkPreview | null>>();

export function loadLinkPreview(
  url: string,
  fetchPreview: (url: string) => Promise<{ preview: LinkPreview | null }>,
): Promise<LinkPreview | null> {
  let pending = cache.get(url);
  if (!pending) {
    pending = fetchPreview(url).then((r) => r.preview ?? null, () => {
      cache.delete(url); // a network blip may succeed next time
      return null;
    });
    cache.set(url, pending);
  }
  return pending;
}
