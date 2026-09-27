/**
 * Seeded PREVIEW data for the Friends screen's stories row, "Following"
 * rail, and "Friend activity" feed — there's no backend in the dev-web
 * preview to answer `getStories()` / `api.social.following()` /
 * `api.social.friendActivity()`, so the screen rendered completely empty
 * (just "Your story" and the "Find your crew" empty state) instead of
 * looking like a real, populated account. Shown only when the real API
 * calls fail outright in `isBuyerDevPreview()` — never for a real
 * signed-in production account.
 */
import type { BuyerPost, Story } from '@/services/socialTypes';

type PreviewFollowing = {
  userId: string; name: string; username: string | null;
  handle: string; initials: string; color: string; followedAt: string;
};

const now = Date.now();

export const PREVIEW_STORIES: Story[] = [
  {
    id: 'preview-story-1', authorId: 'preview-maya', authorName: 'Maya', authorHandle: 'maya.fits',
    authorInitials: 'MF', authorColor: '#3A3A3E', authorAccountType: 'buyer',
    media: [], privacy: { visibility: 'friends', hiddenFromUserIds: [] },
    viewers: [], repliesDisabled: false, createdAt: now - 2 * 3600e3, expiresAt: now + 22 * 3600e3,
  },
  {
    id: 'preview-story-2', authorId: 'preview-devon', authorName: 'Devon', authorHandle: 'devonwears',
    authorInitials: 'DW', authorColor: '#2E2E32', authorAccountType: 'buyer',
    media: [], privacy: { visibility: 'friends', hiddenFromUserIds: [] },
    viewers: [{ userId: 'someone-else', viewedAt: now }], repliesDisabled: false,
    createdAt: now - 6 * 3600e3, expiresAt: now + 18 * 3600e3,
  },
] as unknown as Story[];

export const PREVIEW_FOLLOWING: PreviewFollowing[] = [
  { userId: 'preview-maya', name: 'Maya Fields', username: 'maya.fits', handle: '@maya.fits', initials: 'MF', color: '#3A3A3E', followedAt: new Date(now - 5 * 864e5).toISOString() },
  { userId: 'preview-devon', name: 'Devon Ward', username: 'devonwears', handle: '@devonwears', initials: 'DW', color: '#2E2E32', followedAt: new Date(now - 12 * 864e5).toISOString() },
  { userId: 'preview-rae', name: 'Rae Kim', username: 'raekim', handle: '@raekim', initials: 'RK', color: '#333338', followedAt: new Date(now - 20 * 864e5).toISOString() },
];

export const PREVIEW_FRIEND_ACTIVITY: BuyerPost[] = [
  {
    id: 'preview-activity-1', authorId: 'preview-maya', authorName: 'Maya Fields', authorHandle: '@maya.fits',
    authorInitials: 'MF', authorColor: '#3A3A3E', authorAccountType: 'buyer', feedEligibility: 'profile_only',
    profileVisibility: 'public', type: 'photo', caption: 'Thrifted this whole fit for $22 🧵',
    hashtags: [], mediaColors: ['#2a2a2e', '#121214'], likesCount: 41, commentsCount: 6, repostsCount: 2,
    likedByMe: false, savedByMe: false, repostedByMe: false, isArchived: false, isDraft: false,
    createdAt: new Date(now - 3 * 3600e3).toISOString(), updatedAt: new Date(now - 3 * 3600e3).toISOString(),
  },
  {
    id: 'preview-activity-2', authorId: 'preview-devon', authorName: 'Devon Ward', authorHandle: '@devonwears',
    authorInitials: 'DW', authorColor: '#2E2E32', authorAccountType: 'buyer', feedEligibility: 'profile_only',
    profileVisibility: 'public', type: 'video', caption: 'Restock alert — link in bio', hashtags: [],
    mediaColors: ['#34343a', '#16161a'], likesCount: 118, commentsCount: 14, repostsCount: 9,
    likedByMe: true, savedByMe: false, repostedByMe: false, isArchived: false, isDraft: false,
    createdAt: new Date(now - 26 * 3600e3).toISOString(), updatedAt: new Date(now - 26 * 3600e3).toISOString(),
  },
];
