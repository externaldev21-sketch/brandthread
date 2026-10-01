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
