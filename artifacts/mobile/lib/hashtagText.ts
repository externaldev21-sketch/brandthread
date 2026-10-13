/**
 * Splits caption text into plain and #hashtag segments. Mirrors the server's
 * extraction rules (api-server/src/lib/hashtags.ts): a tag is '#' followed by
 * unicode letters/digits/'_', not preceded by a word character, '&', '#' or
 * '/', and never purely numeric ("#1 seller" stays plain text).
 */
export type CaptionSegment = { kind: 'text'; text: string } | { kind: 'tag'; text: string; tag: string };

const TAG_RE = /(^|[^\p{L}\p{M}\p{N}_&#/])(#([\p{L}\p{M}\p{N}_]{1,60}))/gu;
const MAX_TAG_LENGTH = 30;

export function normalizeTag(raw: string): string {
  return raw.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}_]/gu, '').slice(0, MAX_TAG_LENGTH);
}

export function splitCaption(text: string): CaptionSegment[] {
  if (!text || !text.includes('#')) return text ? [{ kind: 'text', text }] : [];
  const out: CaptionSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(TAG_RE)) {
    const lead = match[1] ?? '';
    const full = match[2];
    const start = (match.index ?? 0) + lead.length;
    const tag = normalizeTag(match[3]);
    if (!tag || /^\p{N}+$/u.test(tag)) continue;
    if (start > cursor) out.push({ kind: 'text', text: text.slice(cursor, start) });
    out.push({ kind: 'tag', text: full, tag });
    cursor = start + full.length;
  }
  if (cursor < text.length) out.push({ kind: 'text', text: text.slice(cursor) });
  return out;
}

export function hasHashtags(text: string): boolean {
  return splitCaption(text).some((s) => s.kind === 'tag');
}

export function hashtagHref(tag: string): string {
  return `/hashtag/${encodeURIComponent(tag)}`;
}

/**
 * Caption text split into plain, #hashtag and @mention segments (item 143:
 * mentions and hashtags are white-bold and tappable). Hashtags follow
 * splitCaption's rules exactly; a mention is '@' + 1–30 letters, digits,
 * '_' or '.', not preceded by a word character or '@' (so emails stay plain),
 * with any trailing '.' left as text ("thanks @maya." → "@maya" + ".").
 */
export type RichCaptionSegment = CaptionSegment | { kind: 'mention'; text: string; handle: string };

const MENTION_RE = /(^|[^\p{L}\p{M}\p{N}_.@])@([A-Za-z0-9_.]{1,30})/gu;

export function splitRichCaption(text: string): RichCaptionSegment[] {
  const out: RichCaptionSegment[] = [];
  for (const segment of splitCaption(text)) {
    if (segment.kind !== 'text' || !segment.text.includes('@')) { out.push(segment); continue; }
    const value = segment.text;
    let cursor = 0;
    for (const match of value.matchAll(MENTION_RE)) {
      const lead = match[1] ?? '';
      const handle = match[2].replace(/\.+$/, '');
      if (!handle || /^\.+$/.test(handle)) continue;
      const start = (match.index ?? 0) + lead.length;
      if (start > cursor) out.push({ kind: 'text', text: value.slice(cursor, start) });
      out.push({ kind: 'mention', text: `@${handle}`, handle: handle.toLowerCase() });
      cursor = start + 1 + handle.length;
    }
    if (cursor < value.length) out.push({ kind: 'text', text: value.slice(cursor) });
  }
  return out;
}

/** The public profile route for an @handle (works signed in and out). */
export function mentionHref(handle: string): string {
  return `/u/${encodeURIComponent(handle.toLowerCase())}`;
}
