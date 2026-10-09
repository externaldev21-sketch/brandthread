/**
 * Settings → Notifications, copied from Instagram's notification settings
 * (Mobbin: https://mobbin.com/flows/058b1099-edb5-4d07-9493-89c5cf60a6f8):
 * "Pause all" with a duration sheet, "Sleep mode", then one row per category
 * that opens a page of Off / On (or Off / From profiles I follow / From
 * everyone) choices, each with an example line under it.
 *
 * Keys and values match api-server lib/pushTypes.ts. Pure module so the page
 * structure is unit-testable.
 */
export type PushTypeValue = 'off' | 'following' | 'everyone';
export type Role = 'buyer' | 'seller';

export interface SettingSection {
  /** Server key (lib/pushTypes.ts), or 'promotions' for the promotional opt-in. */
  key: string;
  title: string;
  /** Offers "From profiles I follow". */
  audience: boolean;
  example: string;
  /** The seller's side of the same notification, when it reads differently. */
  sellerExample?: string;
  role?: Role;
}

export interface SettingsPage {
  id: string;
  title: string;
  sections: SettingSection[];
}

export const SETTINGS_PAGES: SettingsPage[] = [
  {
    id: 'posts',
    title: 'Posts and comments',
    sections: [
      { key: 'likes', title: 'Likes', audience: true, example: 'username liked your post.' },
      { key: 'comments', title: 'Comments', audience: true, example: 'username commented: "Where is this from?"' },
      { key: 'mentions', title: 'Mentions and tags', audience: true, example: 'username mentioned you in a comment.' },
      { key: 'reposts', title: 'Reposts and shares', audience: false, example: 'username reposted your post.' },
    ],
  },
  {
    id: 'following',
    title: 'Following and followers',
    sections: [
      { key: 'new_followers', title: 'New followers', audience: false, example: 'username started following you.' },
      { key: 'accepted_follow_requests', title: 'Accepted follow requests', audience: false, example: 'username accepted your follow request.' },
    ],
  },
  {
    id: 'messages',
    title: 'Messages',
    sections: [
      { key: 'messages', title: 'Messages', audience: false, example: 'username: Is this still available?' },
      { key: 'message_reactions', title: 'Message reactions', audience: false, example: 'username reacted to your message.' },
      { key: 'manufacturer_messages', title: 'Manufacturer messages', audience: false, example: 'Your manufacturer sent a new message.', role: 'seller' },
    ],
  },
  {
    id: 'calls',
    title: 'Calls',
    sections: [
      { key: 'calls', title: 'Incoming calls', audience: false, example: 'Incoming voice call' },
      { key: 'missed_calls', title: 'Missed calls', audience: false, example: 'Missed voice call' },
    ],
  },
  {
    id: 'live',
    title: 'Live',
    sections: [
      { key: 'live', title: 'Live videos', audience: false, example: 'username started a live video.' },
    ],
  },
  {
    id: 'orders',
    title: 'Orders and shopping',
    sections: [
      { key: 'new_orders', title: 'New orders', audience: false, example: 'New order #1042 for $84.00', role: 'seller' },
      { key: 'order_updates', title: 'Order confirmations', audience: false, example: 'Your order #1042 is confirmed.', role: 'buyer' },
      { key: 'shipped', title: 'Shipped', audience: false, example: 'Your order #1042 has shipped.', role: 'buyer' },
      { key: 'delivered', title: 'Delivered', audience: false, example: 'Your order #1042 was delivered.', role: 'buyer' },
      { key: 'returns_refunds', title: 'Returns and refunds', audience: false, example: 'Your refund for order #1042 is on its way.', sellerExample: 'A customer asked to return order #1042.' },
      { key: 'payouts', title: 'Payouts', audience: false, example: 'Your payout of $420.00 was sent.', role: 'seller' },
      { key: 'reviews', title: 'Reviews', audience: false, example: 'username left a 5-star review.', role: 'seller' },
      { key: 'promotions', title: 'Promotions and offers', audience: false, example: 'A brand you follow just dropped something new.' },
    ],
  },
];

/** The pages and sections this account type sees. */
export function pagesFor(role: Role): SettingsPage[] {
  return SETTINGS_PAGES.map((page) => ({
    ...page,
    sections: page.sections
      .filter((s) => !s.role || s.role === role)
      .map((s) => (role === 'seller' && s.sellerExample ? { ...s, example: s.sellerExample } : s)),
  })).filter((page) => page.sections.length > 0);
}

export function pageById(role: Role, id: string | undefined): SettingsPage | undefined {
  return pagesFor(role).find((p) => p.id === id);
}

/** Choice rows for a section, in Instagram's order. */
export function optionsFor(section: SettingSection): Array<{ value: PushTypeValue; label: string }> {
  return section.audience
    ? [
        { value: 'off', label: 'Off' },
        { value: 'following', label: 'From profiles I follow' },
        { value: 'everyone', label: 'From everyone' },
      ]
    : [
        { value: 'off', label: 'Off' },
        { value: 'everyone', label: 'On' },
      ];
}

/** Durations offered by the Pause all sheet (minutes), as Instagram offers them. */
export const PAUSE_OPTIONS: Array<{ minutes: number; label: string }> = [
  { minutes: 15, label: '15 minutes' },
  { minutes: 60, label: '1 hour' },
  { minutes: 120, label: '2 hours' },
  { minutes: 240, label: '4 hours' },
  { minutes: 480, label: '8 hours' },
];

/** "Paused until 3:45 PM" for the Pause all subtitle; null when not paused. */
export function pausedUntilLabel(pausedUntil: string | null | undefined, now = new Date()): string | null {
  if (!pausedUntil) return null;
  const until = new Date(pausedUntil);
  if (!Number.isFinite(until.getTime()) || until.getTime() <= now.getTime()) return null;
  const time = until.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `Paused until ${time}`;
}
