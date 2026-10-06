/** #hashtag / @mention handling for the post caption. */
export type CaptionToken = { text: string; kind: 'text' | 'hashtag' | 'mention' };

const TOKEN_RE = /([#@][\p{L}\p{N}_.]+)/gu;

export function tokenizeCaption(caption: string): CaptionToken[] {
  const out: CaptionToken[] = [];
  let last = 0;
  for (const match of caption.matchAll(TOKEN_RE)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ text: caption.slice(last, index), kind: 'text' });
    out.push({ text: match[0], kind: match[0].startsWith('#') ? 'hashtag' : 'mention' });
    last = index + match[0].length;
  }
  if (last < caption.length) out.push({ text: caption.slice(last), kind: 'text' });
  return out;
}

export function extractHashtags(caption: string): string[] {
  const tags = new Set<string>();
  for (const match of caption.matchAll(/#[\p{L}\p{N}_]+/gu)) tags.add(match[0]);
  return [...tags];
}

/** The `@partial` (or `#partial`) the cursor is currently inside, if any. */
export function activeToken(caption: string, cursor: number): { trigger: '@' | '#'; query: string; start: number } | null {
  const upto = caption.slice(0, cursor);
  const match = /([#@])([\p{L}\p{N}_.]*)$/u.exec(upto);
  if (!match) return null;
  const start = cursor - match[0].length;
  if (start > 0 && !/\s/.test(caption[start - 1])) return null;
  return { trigger: match[1] as '@' | '#', query: match[2], start };
}

export function replaceToken(caption: string, token: { start: number }, cursor: number, replacement: string): { text: string; cursor: number } {
  const text = `${caption.slice(0, token.start)}${replacement} ${caption.slice(cursor)}`;
  return { text, cursor: token.start + replacement.length + 1 };
}

export const CAPTION_MAX = 2200;
