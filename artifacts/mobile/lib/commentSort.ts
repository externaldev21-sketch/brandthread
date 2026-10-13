/**
 * Comment sort (polish #142), copied from YouTube's comments sheet: "Top"
 * (most liked/replied first) and "Newest". The server sorts real posts
 * (GET /api/posts/:id/comments?sort=); this mirrors the same rule for
 * preview posts whose comments live only on the device.
 */
export type CommentSort = 'top' | 'newest';

export const COMMENT_SORTS: { id: CommentSort; label: string }[] = [
  { id: 'top', label: 'Top' },
  { id: 'newest', label: 'Newest' },
];

type SortableRoot = {
  createdAt: string;
  likesCount: number;
  pinned?: boolean;
  creatorLiked?: boolean;
  replies: unknown[];
};

/** Same weights as the server's topCommentScore. */
export function topScore(c: SortableRoot): number {
  return c.likesCount + 2 * c.replies.length + (c.creatorLiked ? 5 : 0);
}

/** Orders top-level comments; the pinned one always leads. Pure. */
export function sortRoots<T extends SortableRoot>(roots: T[], sort: CommentSort): T[] {
  const time = (c: T) => Date.parse(c.createdAt) || 0;
  return [...roots].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    if (sort === 'top') {
      const diff = topScore(b) - topScore(a);
      if (diff !== 0) return diff;
    }
    return time(b) - time(a);
  });
}
