/**
 * Empty-state copy + CTA for every profile tab, in one pure table (no React
 * Native imports) so the rules are testable in one place:
 *  - your own profile gets a CTA into the real creation flow for that tab;
 *  - someone else's profile gets the message only — never a CTA.
 */

export type ProfileEmptyTab =
  | 'buyer:posts' | 'buyer:tagged' | 'buyer:reposts' | 'buyer:saved'
  | 'seller:post' | 'seller:draft' | 'seller:schedule' | 'seller:videos'
  | 'shop';

export interface ProfileEmptyCopy {
  icon: string;
  title: string;
  /** One sentence. */
  message: string;
  /** Own profile only. */
  cta?: { label: string; route: string };
}

export function profileEmptyState(tab: ProfileEmptyTab, own: boolean): ProfileEmptyCopy {
  const copy = TABLE[tab];
  return {
    icon: copy.icon,
    title: own ? copy.title : copy.publicTitle ?? copy.title,
    message: own ? copy.message : copy.publicMessage,
    cta: own ? copy.cta : undefined,
  };
}

const TABLE: Record<ProfileEmptyTab, {
  icon: string;
  title: string;
  message: string;
  publicTitle?: string;
  publicMessage: string;
  cta?: { label: string; route: string };
}> = {
  'buyer:posts': {
    icon: 'video',
    title: 'No posts yet',
    message: 'Photos and videos you post to your profile appear here.',
    publicMessage: 'Posts they share will appear here.',
    cta: { label: 'Post your first video', route: '/create-post?accountType=buyer' },
  },
  'buyer:tagged': {
    icon: 'tag',
    title: 'No tagged posts',
    message: 'Posts that tag you will appear here.',
    publicMessage: 'Posts that tag them will appear here.',
    cta: { label: 'Discover', route: '/(buyer)/discover' },
  },
  'buyer:reposts': {
    icon: 'repeat',
    title: 'No reposts yet',
    message: 'Posts you repost will appear here.',
    publicMessage: 'Posts they repost will appear here.',
  },
  'buyer:saved': {
    icon: 'bookmark',
    title: 'No saved posts yet',
    message: 'Items you save will appear here.',
    publicMessage: 'Saved items are private.',
    cta: { label: 'View saved', route: '/buyer-saved' },
  },
  'seller:post': {
    icon: 'video',
    title: 'No posts yet',
    message: 'Videos you publish show up here and in the feed.',
    publicMessage: 'Videos from this brand will appear here.',
    cta: { label: 'Create your first post', route: '/create-post' },
  },
  'seller:draft': {
    icon: 'file-text',
    title: 'No drafts',
    message: 'Posts you save as a draft wait here until you publish them.',
    publicMessage: 'Drafts are private.',
    cta: { label: 'Start a draft', route: '/create-post' },
  },
  'seller:schedule': {
    icon: 'clock',
    title: 'Nothing scheduled',
    message: 'Schedule a post and it will publish itself at the time you pick.',
    publicMessage: 'Scheduled posts are private.',
    cta: { label: 'Schedule a post', route: '/create-post?mode=schedule' },
  },
  'seller:videos': {
    icon: 'film',
    title: 'No videos yet',
    message: 'Videos you post appear here and in the feed.',
    publicMessage: 'This brand hasn’t posted any videos yet.',
    cta: { label: 'Post your first video', route: '/create-post' },
  },
  shop: {
    icon: 'shopping-bag',
    title: 'No products yet',
    message: 'Products you list appear here for shoppers to buy.',
    publicMessage: 'This shop has no live products right now.',
    cta: { label: 'Add a product', route: '/add-product' },
  },
};

/**
 * Where a profile list's empty state sits (the regression guard for the
 * "empty state clipped under the floating tab bar" bug).
 *
 * The list reserves `paddingBottom` for everything floating over its bottom
 * edge (tab bar incl. home indicator, a floating CTA), and the empty area is
 * given enough height to fill the space between the tabs row (pinned under the
 * compact header once scrolled) and that reserved band — so at the end of the
 * scroll the empty state is centred in the visible gap, never under the bar.
 */
export const EMPTY_AREA_MIN_HEIGHT = 300;
export const EMPTY_AREA_BREATHING_ROOM = 24;

export function computeEmptyArea({
  viewportHeight,
  topChrome,
  tabsHeight,
  bottomInset,
  floatingReserve = 0,
}: {
  viewportHeight: number;
  /** Height of the compact header the tabs scroll under (safe-area top included). */
  topChrome: number;
  tabsHeight: number;
  /** Everything a floating tab bar covers (incl. home indicator); the safe-area bottom when there is no bar. */
  bottomInset: number;
  floatingReserve?: number;
}): { minHeight: number; paddingBottom: number; visibleTop: number; visibleBottom: number } {
  const paddingBottom = bottomInset + floatingReserve + EMPTY_AREA_BREATHING_ROOM;
  const minHeight = Math.max(EMPTY_AREA_MIN_HEIGHT, Math.round(viewportHeight - topChrome - tabsHeight - paddingBottom));
  // At the end of the scroll, the empty area's bottom sits exactly on the
  // reserved band and its top just under the tabs row.
  const visibleBottom = viewportHeight - paddingBottom;
  return { minHeight, paddingBottom, visibleTop: visibleBottom - minHeight, visibleBottom };
}
