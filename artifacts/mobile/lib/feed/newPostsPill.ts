/**
 * Instagram's "New posts" pill: while the viewer is scrolled into the feed,
 * a quiet background check looks at the top of the feed; when posts appear
 * there that the viewer's list doesn't have, a pill floats under the header.
 * Tapping it scrolls back to the top and refreshes. The list itself is never
 * swapped under the viewer's finger.
 *
 * Pure rules here (unit-tested); the hook + pill live in
 * components/buyer-feed/NewPostsPill.tsx.
 */

/** How often the top of the feed is checked while the viewer is scrolled in. */
export const NEW_POSTS_POLL_MS = 60_000;
/** How many top posts the check reads. */
export const NEW_POSTS_CHECK_LIMIT = 6;
/** The pill only matters once the first post is off screen. */
export const NEW_POSTS_MIN_INDEX = 1;

/** Ids at the top of the fresh page that the current list doesn't contain. */
export function freshPostIds(currentIds: readonly string[], topIds: readonly string[]): string[] {
  const have = new Set(currentIds);
  return topIds.filter((id) => !have.has(id));
}

/** Whether to run the background check right now. */
export function shouldCheckForNewPosts(s: {
  focused: boolean; activeIndex: number; loading: boolean; pillShown: boolean; hasPosts: boolean;
}): boolean {
  return s.focused && s.hasPosts && !s.loading && !s.pillShown && s.activeIndex >= NEW_POSTS_MIN_INDEX;
}
