/**
 * `?bt_preview=…&demo=1` dev-preview fixtures for the official @brandthread
 * account: one official video Thread (with a creator credit) and one 6-photo
 * slideshow Thread, built from the bundled runway sample assets. Only ever
 * read behind isPreviewDemoMode() — real sessions use the server.
 */
import { Asset } from 'expo-asset';
import type { SellerThreadPost } from '@/services/socialService';
import { OFFICIAL_ACCOUNT_ID, OFFICIAL_BIO, OFFICIAL_DISPLAY_NAME } from '@/lib/officialAccount';
import { demoRunwayVideoUri } from '@/lib/demoMedia';

/* eslint-disable @typescript-eslint/no-require-imports */
const VIDEO = demoRunwayVideoUri(4);
const POSTERS = [
  require('../assets/videos/fashion_runway_04.jpg'),
  require('../assets/videos/fashion_runway_06.jpg'),
  require('../assets/videos/fashion_runway_07.jpg'),
  require('../assets/videos/fashion_runway_08.jpg'),
  require('../assets/videos/fashion_runway_09.jpg'),
  require('../assets/videos/fashion_runway_10.jpg'),
];
/* eslint-enable @typescript-eslint/no-require-imports */

const uri = (module: number) => Asset.fromModule(module).uri;

const base = {
  authorId: OFFICIAL_ACCOUNT_ID,
  authorAccountType: 'seller' as const,
  authorName: OFFICIAL_DISPLAY_NAME,
  authorHandle: '@brandthread',
  authorInitials: 'BT',
  authorColor: '#1C1C1E',
  sellerId: OFFICIAL_ACCOUNT_ID,
  brandId: OFFICIAL_ACCOUNT_ID,
  feedEligibility: 'thread_eligible' as const,
  hashtags: [],
  postStatus: 'published' as const,
  isDraft: false,
  isArchived: false,
  isDeleted: false,
  productTags: [],
  visibility: { allowComments: true, allowReposts: true, showLikeCount: true },
  scheduledAt: null,
  createdAt: '2026-10-14T18:00:00.000Z',
  updatedAt: '2026-10-14T18:00:00.000Z',
  publishedAt: '2026-10-14T18:00:00.000Z',
  commentsCount: 48,
  repostsCount: 112,
  savedCount: 690,
  sharesCount: 214,
  likedByMe: false,
  savedByMe: false,
  repostedByMe: false,
  friendReposts: [],
  isOfficial: true,
};

export function previewOfficialPosts(): SellerThreadPost[] {
  return [
    {
      ...base,
      id: 'preview-official-video',
      caption: 'Welcome to Brandthread. Fits, drops and the people behind them.',
      mediaUris: [VIDEO],
      thumbnailUri: uri(POSTERS[0]),
      aspectRatio: '9:16',
      contentType: 'video',
      likesCount: 18300,
      viewsCount: 64200,
      credit: { handle: 'galoreyyz', name: null, userId: null, accountType: null },
    },
    {
      ...base,
      id: 'preview-official-slideshow',
      caption: 'Rae Urban Sport — the full editorial. Swipe through.',
      mediaUris: POSTERS.map(uri),
      thumbnailUri: uri(POSTERS[0]),
      aspectRatio: '4:5',
      contentType: 'slideshow',
      likesCount: 9400,
      viewsCount: 30100,
      credit: null,
    },
    {
      ...base,
      id: 'preview-official-photo',
      caption: 'One look, one frame.',
      mediaUris: [uri(POSTERS[3])],
      thumbnailUri: uri(POSTERS[3]),
      aspectRatio: '4:5',
      contentType: 'photo',
      likesCount: 5100,
      viewsCount: 14800,
      credit: { handle: 'movrrs', name: null, userId: null, accountType: null },
    },
  ];
}

/** GET /api/public/sellers/:id `profile` shape for the official account. */
export function previewOfficialProfile() {
  return {
    clerkId: OFFICIAL_ACCOUNT_ID,
    brandName: OFFICIAL_DISPLAY_NAME,
    displayName: OFFICIAL_DISPLAY_NAME,
    username: 'brandthread',
    bio: OFFICIAL_BIO,
    verified: true,
    isOfficial: true,
    productsCount: 0,
    videosCount: 11,
    likesCount: 182000,
    followersCount: 12400,
    followingCount: 0,
  };
}

/** Profile grid for the demo: the slideshow, the video, then more starter-set videos. */
export function previewOfficialGrid(): SellerThreadPost[] {
  const [video, slideshow] = previewOfficialPosts();
  const more = POSTERS.slice(1).concat(POSTERS.slice(1, 4)).map((poster, i): SellerThreadPost => ({
    ...video,
    id: `preview-official-video-${i + 2}`,
    thumbnailUri: uri(poster),
    viewsCount: 12000 + i * 3100,
    credit: null,
  }));
  return [slideshow, video, ...more];
}

/** demo=1 bulk-upload sample: two credited videos and one 6-photo slideshow. */
export function previewBulkItems() {
  const photo = (m: number, i: number) => ({ id: `demo-photo-${i}`, uri: uri(m), kind: 'photo' as const, duration: 0, width: 1080, height: 1350 });
  return [
    { kind: 'video' as const, assets: [{ id: 'demo-video-1', uri: VIDEO, kind: 'video' as const, duration: 14, width: 1080, height: 1920 }], caption: 'Night shift fits.', creditHandle: 'galoreyyz', creditName: '' },
    { kind: 'video' as const, assets: [{ id: 'demo-video-2', uri: VIDEO, kind: 'video' as const, duration: 22, width: 1080, height: 1920 }], caption: 'Bully Monday, live.', creditHandle: 'iammjonahdavid', creditName: 'Bully Monday' },
    { kind: 'slideshow' as const, assets: POSTERS.map(photo), caption: 'Rae Urban Sport — the full editorial.', creditHandle: '', creditName: '' },
  ];
}
