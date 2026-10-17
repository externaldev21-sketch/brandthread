/**
 * Reply paging for the comments sheet. The thread endpoint inlines at most 50
 * replies per root and flags the rest with `hasMoreReplies` +
 * `repliesNextCursor`; GET …/comments/:id/replies?after= serves the next page.
 */
import type { ThreadComment } from '@/lib/safetyTypes';

/** Root id → cursor for the next reply page, for roots that have more. */
export function replyCursorsFrom(roots: ThreadComment[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const root of roots) {
    if (root.hasMoreReplies && root.repliesNextCursor) out[root.id] = root.repliesNextCursor;
  }
  return out;
}

/**
 * Inserts a fetched page of replies right after the root's last loaded reply
 * (or right after the root), skipping ids already in the list.
 */
export function insertReplies<R extends { id: string; parentId: string | null; isReply: boolean }>(
  rows: R[],
  rootId: string,
  page: R[],
): R[] {
  const rootIndex = rows.findIndex((row) => row.id === rootId && !row.isReply);
  if (rootIndex < 0) return rows;
  const known = new Set(rows.map((row) => row.id));
  const fresh = page.filter((row) => !known.has(row.id));
  if (fresh.length === 0) return rows;
  let insertAt = rootIndex + 1;
  while (insertAt < rows.length && rows[insertAt].isReply && rows[insertAt].parentId === rootId) insertAt += 1;
  return [...rows.slice(0, insertAt), ...fresh, ...rows.slice(insertAt)];
}
