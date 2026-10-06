/**
 * Live Feed (app/live-feed.tsx) chat helpers — pure, so the merge rules are
 * unit-tested. Real rooms read GET /api/live/:id/comments (newest first) and
 * send through POST /api/live/:id/comment; the optimistic line a viewer sees
 * on send is swapped for the server's row once it comes back, never shown
 * twice.
 */

export interface LiveChatLine {
  /** Server comment id; a `local_` id while an optimistic send is in flight. */
  id?: string;
  user: string;
  text: string;
  createdAt?: string;
}

export const LIVE_CHAT_CAP = 80;

/** API rows (newest first) → chat lines (oldest first). */
export function liveCommentsToLines(rows: unknown): LiveChatLine[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && typeof (r as any).message === 'string')
    .map((r) => ({
      id: r.id != null ? String(r.id) : undefined,
      user: typeof r.display_name === 'string' && r.display_name ? r.display_name : 'Viewer',
      text: r.message as string,
      createdAt: typeof r.created_at === 'string' ? r.created_at : undefined,
    }))
    .reverse();
}

/** Appends `incoming` lines, skipping ids already shown, capped to the newest `cap`. */
export function mergeLiveChat(prev: LiveChatLine[], incoming: LiveChatLine[], cap = LIVE_CHAT_CAP): LiveChatLine[] {
  const seen = new Set(prev.map((l) => l.id).filter(Boolean));
  const fresh = incoming.filter((l) => !l.id || !seen.has(l.id));
  if (fresh.length === 0) return prev;
  return [...prev, ...fresh].slice(-cap);
}

/** Replaces an optimistic line with the server's row (or drops it when `confirmed` is already present). */
export function confirmLiveChatLine(prev: LiveChatLine[], localId: string, confirmed: LiveChatLine): LiveChatLine[] {
  if (confirmed.id && prev.some((l) => l.id === confirmed.id)) return prev.filter((l) => l.id !== localId);
  return prev.map((l) => (l.id === localId ? confirmed : l));
}

/** Latest server timestamp shown — the `since` cursor for the next poll. */
export function latestLiveChatCursor(lines: LiveChatLine[]): string | undefined {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const l = lines[i];
    if (l.createdAt && !(l.id ?? '').startsWith('local_')) return l.createdAt;
  }
  return undefined;
}
