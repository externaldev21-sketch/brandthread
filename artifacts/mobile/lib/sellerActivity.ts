/**
 * Seller Activity — pure logic for the /seller-activity screen.
 *
 * Reads the same notifications feed as the buyer Activity Center, narrowed to
 * what happens around a seller's content and profile (likes, comments,
 * replies, mentions and tags, reposts and shares, saves, new followers) and
 * grouped Today / This week / Earlier. Orders, payouts and inventory alerts
 * stay in Orders; they are not Activity.
 */
import {
  buildActivitySections,
  type ActivityItem,
  type ActivityRow,
  type ActivitySection,
} from './activity';

export type SellerActivityChip = 'all' | 'likes' | 'comments' | 'mentions' | 'reposts' | 'followers';

export const SELLER_ACTIVITY_CHIPS: readonly { key: SellerActivityChip; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'likes', label: 'Likes' },
  { key: 'comments', label: 'Comments' },
  { key: 'mentions', label: 'Mentions' },
  { key: 'reposts', label: 'Reposts' },
  { key: 'followers', label: 'Followers' },
];

const CHIP_TYPES: Record<Exclude<SellerActivityChip, 'all'>, ReadonlySet<string>> = {
  likes: new Set(['post_like', 'story_like']),
  comments: new Set(['post_comment', 'comment_reply']),
  mentions: new Set(['mention', 'story_mention', 'post_tag']),
  reposts: new Set(['repost', 'story_reshare', 'post_share']),
  followers: new Set(['new_follower']),
};
/** Shown under All only. */
const ALL_ONLY_TYPES: ReadonlySet<string> = new Set(['post_save']);

const SELLER_ACTIVITY_TYPES: ReadonlySet<string> = new Set([
  ...Object.values(CHIP_TYPES).flatMap((set) => [...set]),
  ...ALL_ONLY_TYPES,
]);

export function isSellerActivityItem(item: Pick<ActivityItem, 'type'>): boolean {
  return SELLER_ACTIVITY_TYPES.has(item.type);
}

export function matchesSellerChip(item: Pick<ActivityItem, 'type'>, chip: SellerActivityChip): boolean {
  if (!isSellerActivityItem(item)) return false;
  return chip === 'all' ? true : CHIP_TYPES[chip].has(item.type);
}

/** New, unmuted seller activity — drives the bell dot. */
export function hasUnreadSellerActivity(items: readonly Pick<ActivityItem, 'type' | 'isRead' | 'isMuted'>[]): boolean {
  return items.some((item) => !item.isRead && !item.isMuted && isSellerActivityItem(item));
}

export type SellerSectionKey = 'today' | 'this_week' | 'earlier';
export type SellerActivitySection = ActivitySection<ActivityRow> & { key: SellerSectionKey; data: ActivityRow[] };

const TITLES: Record<SellerSectionKey, string> = { today: 'Today', this_week: 'This week', earlier: 'Earlier' };

/** Today / This week / Earlier — unread-regardless-of-age folds into Today, month into Earlier. */
export function buildSellerActivitySections(items: readonly ActivityItem[], now: Date = new Date()): SellerActivitySection[] {
  const buckets: Record<SellerSectionKey, ActivityRow[]> = { today: [], this_week: [], earlier: [] };
  for (const section of buildActivitySections(items, now)) {
    const key: SellerSectionKey = section.key === 'new' || section.key === 'today'
      ? 'today'
      : section.key === 'this_week' ? 'this_week' : 'earlier';
    buckets[key].push(...section.items);
  }
  return (['today', 'this_week', 'earlier'] as const)
    .filter((key) => buckets[key].length > 0)
    .map((key) => ({ key, title: TITLES[key], items: buckets[key], data: buckets[key] }));
}

export function sellerChipEmpty(chip: SellerActivityChip): { icon: string; title: string; message: string } {
  switch (chip) {
    case 'likes': return { icon: 'heart', title: 'No likes yet', message: 'Likes on your posts show up here.' };
    case 'comments': return { icon: 'message-circle', title: 'No comments yet', message: 'Comments on your posts show up here.' };
    case 'mentions': return { icon: 'at-sign', title: 'No mentions yet', message: 'Mentions and tags show up here.' };
    case 'reposts': return { icon: 'repeat', title: 'No reposts yet', message: 'Reposts of your posts show up here.' };
    case 'followers': return { icon: 'user-plus', title: 'No new followers yet', message: 'New followers show up here.' };
    default: return { icon: 'activity', title: 'No activity yet', message: 'Likes and followers show up here.' };
  }
}
