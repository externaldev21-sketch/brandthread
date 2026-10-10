/**
 * Memo comparator for the feed's full-screen SpotlightPage (app/(tabs)/feed.tsx).
 *
 * A like/save/repost on one page must re-render only that page. Two things
 * make that true together:
 *  - the screen's engagement handlers (onLike, onSave, ...) keep a stable
 *    identity across a like (they read the latest engagements through a ref),
 *  - this comparator compares `engagement` by value, because the call site
 *    builds `engagements[id] ?? initialEngagement(item)` — a new object every
 *    render for a post with no entry yet — even though nothing changed.
 */

export type FeedEngagement = {
  liked: boolean; likes: number;
  saved: boolean; saves: number;
  reposted: boolean; reposts: number;
  following: boolean;
  comments?: readonly unknown[];
};

export function engagementEqual(a: FeedEngagement | undefined, b: FeedEngagement | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.liked === b.liked && a.likes === b.likes
    && a.saved === b.saved && a.saves === b.saves
    && a.reposted === b.reposted && a.reposts === b.reposts
    && a.following === b.following && (a.comments?.length ?? 0) === (b.comments?.length ?? 0);
}

/** The SpotlightPage props the comparator looks at. */
export type SpotlightPageMemoProps = {
  item: unknown;
  isActive: boolean;
  preload?: boolean;
  isFirstItem?: boolean;
  pageWidth?: number;
  pageHeight?: number;
  bottomClearance?: number;
  videoFrameInset?: number;
  immersive?: boolean;
  hasTabBar?: boolean;
  soundOn?: boolean;
  engagement?: FeedEngagement;
  onLike?: unknown;
  onDoubleTapLike?: unknown;
  onSave?: unknown;
  onRepost?: unknown;
  onFollow?: unknown;
  onOpenComments?: unknown;
  onShopTag?: unknown;
  onOpenCreator?: unknown;
  onNotInterested?: unknown;
  onVideoWatched?: unknown;
  onToggleSound?: unknown;
  reduceMotion?: boolean;
};

export function spotlightPagePropsEqual(prev: SpotlightPageMemoProps, next: SpotlightPageMemoProps): boolean {
  return prev.item === next.item
    && prev.isActive === next.isActive
    && prev.preload === next.preload
    && prev.isFirstItem === next.isFirstItem
    && prev.pageWidth === next.pageWidth
    && prev.pageHeight === next.pageHeight
    && prev.bottomClearance === next.bottomClearance
    && prev.videoFrameInset === next.videoFrameInset
    && prev.immersive === next.immersive
    && prev.hasTabBar === next.hasTabBar
    && prev.soundOn === next.soundOn
    && engagementEqual(prev.engagement, next.engagement)
    && prev.onLike === next.onLike
    && prev.onDoubleTapLike === next.onDoubleTapLike
    && prev.onSave === next.onSave
    && prev.onRepost === next.onRepost
    && prev.onFollow === next.onFollow
    && prev.onOpenComments === next.onOpenComments
    && prev.onShopTag === next.onShopTag
    && prev.onOpenCreator === next.onOpenCreator
    && prev.onNotInterested === next.onNotInterested
    && prev.onVideoWatched === next.onVideoWatched
    && prev.onToggleSound === next.onToggleSound
    && prev.reduceMotion === next.reduceMotion;
}
