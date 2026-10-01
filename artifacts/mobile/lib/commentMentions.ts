/**
 * Pure helpers for @mentions in comments (no React / native imports so they
 * are unit-testable). The regex mirrors the server's `extractMentions`
 * (api-server lib/activityEvents.ts); the server stays the source of truth for
 * who was actually mentioned — `mentions` on each comment — and only those
 * handles render as tappable.
 */
export interface CommentMentionRef { userId: string; handle: string }

export type MentionSegment =
  | { type: 'text'; text: string }
  | { type: 'mention'; text: string; userId: string; handle: string };

const MENTION_RE = /(^|[^\w@.])@([A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?)/g;

/** Split a comment body into plain text and verified-mention segments. */
export function parseMentionSegments(body: string, mentions?: CommentMentionRef[] | null): MentionSegment[] {
  if (!body) return [];
  if (!mentions || mentions.length === 0) return [{ type: 'text', text: body }];
  const byHandle = new Map(mentions.map((m) => [m.handle.replace(/^@/, '').toLowerCase(), m]));
  const out: MentionSegment[] = [];
  let cursor = 0;
  const re = new RegExp(MENTION_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(body))) {
    const found = byHandle.get(match[2].toLowerCase());
    if (!found) continue;
    const start = match.index + match[1].length;
    const end = start + match[2].length + 1;
    if (start > cursor) out.push({ type: 'text', text: body.slice(cursor, start) });
    out.push({ type: 'mention', text: body.slice(start, end), userId: found.userId, handle: found.handle.replace(/^@/, '') });
    cursor = end;
  }
  if (cursor < body.length) out.push({ type: 'text', text: body.slice(cursor) });
  return out.length ? out : [{ type: 'text', text: body }];
}

/** The "@partial" token at the very end of the composer text, if any. */
export function activeMentionQuery(text: string): string | null {
  const match = /(?:^|\s)@([A-Za-z0-9_.]{0,29})$/.exec(text);
  return match ? match[1] : null;
}

/** Replace the trailing "@partial" with "@handle " (the caller keeps focus). */
export function insertMentionHandle(text: string, handle: string): string {
  const clean = handle.replace(/^@+/, '');
  return text.replace(/@[A-Za-z0-9_.]{0,29}$/, `@${clean} `);
}
