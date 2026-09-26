/**
 * Seeded PREVIEW Activity feed + "Suggested for you" list.
 *
 * Mirrors lib/previewCatalog.ts's / lib/previewInbox.ts's pattern exactly:
 * the Activity tab has nothing real to show without a live backend, which
 * previously surfaced as "Your activity couldn't load. Check your
 * connection and try again." in the dev-web preview even though there was
 * never a backend to reach. This gives the screen a small, real-looking
 * world instead — every row type the redesigned screen renders, using the
 * same preview brands/posters as the rest of the buyer preview.
 *
 * Gating: `isPreviewActivityEnabled()` reuses `isPreviewCatalogEnabled()`
 * (same gate as previewCatalog/previewInbox, not a new one). Call sites must
 * still try the real API first and only fall back to this seed data when the
 * call fails or returns nothing, per those modules' established contract.
 */
import { Asset } from 'expo-asset';
import { isPreviewCatalogEnabled } from './previewCatalog';
import type { ActivityItem } from './activity';

export function isPreviewActivityEnabled(): boolean {
  return isPreviewCatalogEnabled();
}

const POSTER_SOURCES = [
  require('../assets/videos/fashion_runway_01.png'),
  require('../assets/videos/fashion_runway_02.png'),
  require('../assets/videos/fashion_runway_03.png'),
  require('../assets/videos/fashion_runway_04.png'),
  require('../assets/videos/fashion_runway_05.png'),
  require('../assets/videos/fashion_runway_06.png'),
  require('../assets/videos/fashion_runway_07.png'),
  require('../assets/videos/fashion_runway_08.png'),
  require('../assets/videos/fashion_runway_09.png'),
  require('../assets/videos/fashion_runway_10.png'),
];
function posterUri(index: number): string {
  return Asset.fromModule(POSTER_SOURCES[index]).uri;
}

// Same names/ids as previewCatalog.ts's SEED, so a buyer sees one consistent
// cast of brands across Feed, Discover, Search, Shop and now Activity. Each
// gets the matching preview poster as a stand-in profile photo (no real
// headshots in this seed set), same convention as previewInbox.ts.
const PEOPLE = [
  { userId: 'preview-seller-01', name: 'Atelier Noire', initials: 'AN', color: '#2E2A26', avatarUrl: posterUri(0) },
  { userId: 'preview-seller-02', name: 'Maison Vela', initials: 'MV', color: '#7C3AED', avatarUrl: posterUri(1) },
  { userId: 'preview-seller-03', name: 'Saint Rue', initials: 'SR', color: '#111827', avatarUrl: posterUri(2) },
  { userId: 'preview-seller-04', name: 'Orison', initials: 'OR', color: '#D6D3D1', avatarUrl: posterUri(3) },
  { userId: 'preview-seller-05', name: 'Kuro Line', initials: 'KL', color: '#1F2937', avatarUrl: posterUri(4) },
  { userId: 'preview-seller-06', name: 'Forme 22', initials: 'F2', color: '#B45309', avatarUrl: posterUri(5) },
  { userId: 'preview-seller-07', name: 'Astrae', initials: 'AS', color: '#0EA5E9', avatarUrl: posterUri(6) },
  { userId: 'preview-seller-08', name: 'Noma Archive', initials: 'NA', color: '#65A30D', avatarUrl: posterUri(7) },
  { userId: 'preview-seller-09', name: 'Echelon', initials: 'EC', color: '#DB2777', avatarUrl: posterUri(8) },
  { userId: 'preview-seller-10', name: 'Vale Studio', initials: 'VS', color: '#EA580C' },
];

function minutesAgo(mins: number): string {
  return new Date(Date.now() - mins * 60_000).toISOString();
}

let cached: ActivityItem[] | null = null;

/** The full seeded preview Activity feed. Gate on `isPreviewActivityEnabled()`. */
export function getPreviewActivity(): ActivityItem[] {
  if (cached) return cached;
  const p = PEOPLE;
  cached = [
    // ── New (unread) ──────────────────────────────────────────────────────
    {
      id: 'preview-act-follow-new-01', category: 'social', type: 'new_follower',
      title: `${p[0].name} started following you`, body: '', isRead: false,
      actorId: p[0].userId, actorName: p[0].name, actorInitials: p[0].initials, actorColor: p[0].color, actorAvatarUrl: p[0].avatarUrl,
      targetId: p[0].userId, targetType: 'user', cta: 'Follow back', createdAt: minutesAgo(4),
    },
    {
      id: 'preview-act-followback-01', category: 'social', type: 'new_follower',
      title: `${p[4].name} followed you back`, body: '', isRead: false,
      actorId: p[4].userId, actorName: p[4].name, actorInitials: p[4].initials, actorColor: p[4].color, actorAvatarUrl: p[4].avatarUrl,
      targetId: p[4].userId, targetType: 'user', createdAt: minutesAgo(11),
    },
    {
      id: 'preview-act-like-group-01', category: 'social', type: 'post_like',
      title: `${p[1].name} liked your post`, body: '', isRead: false,
      actorId: p[1].userId, actorName: p[1].name, actorInitials: p[1].initials, actorColor: p[1].color, actorAvatarUrl: p[1].avatarUrl,
      targetId: 'preview-post-01', targetType: 'post', targetImageUrl: posterUri(1), createdAt: minutesAgo(14),
    },
    {
      id: 'preview-act-like-group-02', category: 'social', type: 'post_like',
      title: `${p[2].name} liked your post`, body: '', isRead: false,
      actorId: p[2].userId, actorName: p[2].name, actorInitials: p[2].initials, actorColor: p[2].color, actorAvatarUrl: p[2].avatarUrl,
      targetId: 'preview-post-01', targetType: 'post', targetImageUrl: posterUri(1), createdAt: minutesAgo(16),
    },
    {
      id: 'preview-act-like-group-03', category: 'social', type: 'post_like',
      title: `${p[6].name} liked your post`, body: '', isRead: false,
      actorId: p[6].userId, actorName: p[6].name, actorInitials: p[6].initials, actorColor: p[6].color, actorAvatarUrl: p[6].avatarUrl,
      targetId: 'preview-post-01', targetType: 'post', targetImageUrl: posterUri(1), createdAt: minutesAgo(19),
    },
    {
      id: 'preview-act-story-like-01', category: 'social', type: 'story_like',
      title: `${p[3].name} liked your story`, body: '', isRead: false,
      actorId: p[3].userId, actorName: p[3].name, actorInitials: p[3].initials, actorColor: p[3].color, actorAvatarUrl: p[3].avatarUrl,
      targetId: 'preview-story-01', targetType: 'story', targetImageUrl: posterUri(3), createdAt: minutesAgo(22),
    },
    {
      id: 'preview-act-cash-01', category: 'social', type: 'thread_cash_received',
      title: `${p[7].name} sent you Thread Cash`, body: '$5.00 · tap to view', isRead: false,
      actorId: p[7].userId, actorName: p[7].name, actorInitials: p[7].initials, actorColor: p[7].color, actorAvatarUrl: p[7].avatarUrl,
      targetId: 'preview-transfer-01', targetType: 'thread_cash_transfer', createdAt: minutesAgo(28),
    },
    // ── Today ────────────────────────────────────────────────────────────
    {
      id: 'preview-act-comment-01', category: 'social', type: 'post_comment',
      title: `${p[5].name} commented on your post`, body: 'obsessed with this fit 😍', isRead: true,
      actorId: p[5].userId, actorName: p[5].name, actorInitials: p[5].initials, actorColor: p[5].color, actorAvatarUrl: p[5].avatarUrl,
      targetId: 'preview-post-02', targetType: 'post', targetImageUrl: posterUri(5), createdAt: minutesAgo(90),
    },
    {
      id: 'preview-act-highlight-like-01', category: 'social', type: 'story_like',
      title: `${p[8].name} liked your highlight`, body: '', isRead: true,
      actorId: p[8].userId, actorName: p[8].name, actorInitials: p[8].initials, actorColor: p[8].color, actorAvatarUrl: p[8].avatarUrl,
      targetId: 'preview-story-02', targetType: 'story', targetImageUrl: posterUri(8), createdAt: minutesAgo(150),
    },
    {
      id: 'preview-act-repost-01', category: 'social', type: 'repost',
      title: `${p[9].name} reposted your post`, body: '', isRead: true,
      actorId: p[9].userId, actorName: p[9].name, actorInitials: p[9].initials, actorColor: p[9].color, actorAvatarUrl: p[9].avatarUrl,
      targetId: 'preview-post-03', targetType: 'post', targetImageUrl: posterUri(9), createdAt: minutesAgo(240),
    },
    {
      id: 'preview-act-order-01', category: 'orders', type: 'order_shipped',
      title: 'Your order shipped', body: 'Sculpted Wool Coat is on its way.', isRead: true,
      targetId: 'preview-order-01', targetType: 'buyer_order', targetImageUrl: posterUri(0), createdAt: minutesAgo(200),
    },
    // ── This week ────────────────────────────────────────────────────────
    {
      id: 'preview-act-video-like-01', category: 'social', type: 'post_like',
      title: `${p[2].name} liked your video`, body: '', isRead: true,
      actorId: p[2].userId, actorName: p[2].name, actorInitials: p[2].initials, actorColor: p[2].color, actorAvatarUrl: p[2].avatarUrl,
      targetId: 'preview-post-04', targetType: 'post', targetImageUrl: posterUri(2), createdAt: minutesAgo(60 * 24 * 2),
    },
    {
      id: 'preview-act-mention-01', category: 'social', type: 'mention',
      title: `${p[4].name} mentioned you in a comment`, body: `check out @you's fit from last week`, isRead: true,
      actorId: p[4].userId, actorName: p[4].name, actorInitials: p[4].initials, actorColor: p[4].color, actorAvatarUrl: p[4].avatarUrl,
      targetId: 'preview-post-05', targetType: 'post', targetImageUrl: posterUri(4), createdAt: minutesAgo(60 * 24 * 3),
    },
    {
      id: 'preview-act-reply-01', category: 'social', type: 'comment_reply',
      title: `${p[6].name} replied to your comment`, body: 'right?! grabbing one before it sells out', isRead: true,
      actorId: p[6].userId, actorName: p[6].name, actorInitials: p[6].initials, actorColor: p[6].color, actorAvatarUrl: p[6].avatarUrl,
      targetId: 'preview-post-06', targetType: 'post', targetImageUrl: posterUri(6), createdAt: minutesAgo(60 * 24 * 4),
    },
    {
      id: 'preview-act-order-02', category: 'orders', type: 'payout_sent',
      title: 'Payout on its way', body: 'Your Thread Cash redemption was approved.', isRead: true,
      targetId: 'preview-order-02', targetType: 'payout', createdAt: minutesAgo(60 * 24 * 5),
    },
    // ── This month / earlier ────────────────────────────────────────────
    {
      id: 'preview-act-follow-old-01', category: 'social', type: 'new_follower',
      title: `${p[3].name} started following you`, body: '', isRead: true,
      actorId: p[3].userId, actorName: p[3].name, actorInitials: p[3].initials, actorColor: p[3].color, actorAvatarUrl: p[3].avatarUrl,
      targetId: p[3].userId, targetType: 'user', createdAt: minutesAgo(60 * 24 * 20), cta: undefined,
    },
    {
      id: 'preview-act-like-old-01', category: 'social', type: 'post_like',
      title: `${p[9].name} liked your post`, body: '', isRead: true,
      actorId: p[9].userId, actorName: p[9].name, actorInitials: p[9].initials, actorColor: p[9].color, actorAvatarUrl: p[9].avatarUrl,
      targetId: 'preview-post-07', targetType: 'post', targetImageUrl: posterUri(7), createdAt: minutesAgo(60 * 24 * 45),
    },
  ];
  return cached;
}

export interface PreviewSuggestedPerson {
  userId: string;
  name: string;
  handle: string;
  initials: string;
  color: string;
  avatarUrl?: string;
  reason: string;
  isFollowing: boolean;
}

let cachedSuggestions: PreviewSuggestedPerson[] | null = null;

/** The seeded "Suggested for you" list. Gate on `isPreviewActivityEnabled()`. */
export function getPreviewSuggestedPeople(): PreviewSuggestedPerson[] {
  if (cachedSuggestions) return cachedSuggestions;
  const reasons = [
    'Followed by Atelier Noire + 4 others',
    'Followed by Astrae + 1 other',
    'New on Brandthread',
    'Followed by Orison',
    'New on Brandthread',
  ];
  cachedSuggestions = PEOPLE.slice(5).map((person, index) => ({
    userId: person.userId,
    name: person.name,
    handle: `@${person.name.toLowerCase().replace(/\s+/g, '')}`,
    initials: person.initials,
    color: person.color,
    avatarUrl: person.avatarUrl,
    reason: reasons[index] ?? 'Suggested for you',
    isFollowing: false,
  }));
  return cachedSuggestions;
}
