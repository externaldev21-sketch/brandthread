/**
 * Threads (For You) first page, followed brands first — the Instagram Home
 * order: new posts from accounts you follow, then suggested posts.
 *
 * Signed in, the first page starts with GET /api/feed/followed-fresh (new,
 * unwatched posts from followed brands, last 72h) and continues with the
 * regular `getThreadPostsPage(..., 'for-you')` page. The fresh ids go into
 * `cursor.seenPostIds`, so later pages never repeat them. Signed out (incl.
 * the web preview) the protected endpoint is never called; any failure of it
 * falls back to the regular page alone.
 */
import { hasServiceToken, serviceRequest } from '@/lib/serviceConfig';
import {
  getThreadPostsPage,
  mapApiPostToSellerThreadPost,
  type SellerThreadPost,
  type ThreadFeedCursor,
  type ThreadFeedPage,
} from '@/services/socialService';

const FRESH_LIMIT = 20;
const FRESH_HOURS = 72;

/** Fresh posts first, then the regular page minus duplicates; fresh ids marked seen. */
export function mergeFollowedFirst(fresh: SellerThreadPost[], page: ThreadFeedPage): ThreadFeedPage {
  if (fresh.length === 0) return page;
  const freshIds = new Set<string>();
  const head = fresh.filter(post => {
    if (typeof post.id !== 'string' || freshIds.has(post.id)) return false;
    freshIds.add(post.id);
    return true;
  });
  return {
    posts: [...head, ...page.posts.filter(post => !freshIds.has(post.id))],
    cursor: {
      ...page.cursor,
      seenPostIds: [...new Set([...page.cursor.seenPostIds, ...freshIds])],
    },
    hasMore: page.hasMore,
  };
}

async function fetchFollowedFresh(): Promise<SellerThreadPost[]> {
  try {
    if (!(await hasServiceToken())) return [];
    const rows = await serviceRequest<unknown>(
      `/api/feed/followed-fresh?limit=${FRESH_LIMIT}&hours=${FRESH_HOURS}`,
      {},
      false,
    );
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((row: any) => typeof row?.id === 'string')
      .map((row, index) => mapApiPostToSellerThreadPost(row, index));
  } catch {
    return [];
  }
}

/** First Threads (For You) page: followed brands' new posts, then the regular feed. */
export async function getThreadsFirstPage(cursor: ThreadFeedCursor, limit: number): Promise<ThreadFeedPage> {
  const [fresh, page] = await Promise.all([
    fetchFollowedFresh(),
    getThreadPostsPage(cursor, limit, 'for-you'),
  ]);
  return mergeFollowedFirst(fresh, page);
}
