/**
 * Seeded PREVIEW "Story mentions" (Activity rail, See all, tap-through viewer).
 *
 * The dev-web preview has no backend to answer api.social.storyMentions(), so
 * with `&demo=1` this gives the rail a small realistic world: the same people
 * and preview posters as lib/previewActivity.ts / lib/previewStories.ts, two of
 * them tagging me more than once, a mix of unseen / seen / handled.
 *
 * Gated strictly by isPreviewDemoMode() AND isPreviewActivityEnabled() — a
 * fresh preview (no `demo=1`) and every real session get nothing.
 */
import { posterUri } from './previewInbox';
import { isPreviewDemoMode } from './devPreview';
import { isPreviewActivityEnabled } from './previewActivity';
import type { Story, StoryMentionItem } from '@/services/socialTypes';

const HOUR = 3600e3;

type Seed = {
  storyId: string; userId: string; name: string; handle: string; initials: string; color: string;
  poster: number; slides: number[]; hoursAgo: number; seen?: boolean; handledAction?: 'reshared' | 'dismissed';
};

const SEEDS: Seed[] = [
  { storyId: 'preview-mention-rae-1', userId: 'preview-story-rae', name: 'Rae Kim', handle: '@raekim', initials: 'RK', color: '#333338', poster: 6, slides: [6, 2], hoursAgo: 1 },
  { storyId: 'preview-mention-theo-1', userId: 'preview-story-theo', name: 'Theo Park', handle: '@theo.fits', initials: 'TP', color: '#3D3D42', poster: 7, slides: [7], hoursAgo: 3 },
  { storyId: 'preview-mention-rae-0', userId: 'preview-story-rae', name: 'Rae Kim', handle: '@raekim', initials: 'RK', color: '#333338', poster: 6, slides: [5], hoursAgo: 6, seen: true },
  { storyId: 'preview-mention-nova-1', userId: 'preview-story-nova', name: 'Nova Dane', handle: '@nova.dane', initials: 'ND', color: '#2A2A2E', poster: 8, slides: [8], hoursAgo: 9, seen: true, handledAction: 'reshared' },
  { storyId: 'preview-mention-sasha-1', userId: 'preview-story-sasha', name: 'Sasha Cole', handle: '@sasha.cole', initials: 'SC', color: '#3A3A3E', poster: 4, slides: [4, 3], hoursAgo: 14, seen: true, handledAction: 'dismissed' },
];

function buildStory(seed: Seed, createdAt: number): Story {
  return {
    id: seed.storyId,
    authorId: seed.userId,
    authorName: seed.name,
    authorHandle: seed.handle,
    authorInitials: seed.initials,
    authorColor: seed.color,
    authorAccountType: 'buyer',
    media: seed.slides.map((poster, index) => ({
      id: `${seed.storyId}-${index}`,
      type: 'photo' as const,
      backgroundColor: '#111113',
      duration: 5,
      imageUri: posterUri(poster),
      // The first slide carries the sticker that tagged me.
      overlays: index === 0 ? [{
        id: `${seed.storyId}-mention`, type: 'mention' as const, x: 96, y: 500, rotation: -6, scale: 1,
        mentionHandle: '@you', mentionName: 'You', mentionStyle: 'solid' as const, opacity: 1,
      }] : [],
    })),
    privacy: { visibility: 'public', replyPermission: 'everyone', hiddenFromUserIds: [], closeFriendsOnly: false },
    viewers: [],
    repliesDisabled: false,
    createdAt,
    expiresAt: createdAt + 24 * HOUR,
  };
}

let cached: StoryMentionItem[] | null = null;
const runtimeSeen = new Set<string>();

/** Preview mentions are on only for `&demo=1` (never a fresh preview, never a real session). */
export function isPreviewStoryMentionsEnabled(): boolean {
  return isPreviewActivityEnabled() && isPreviewDemoMode();
}

/** Seeded mentions, newest first, reflecting anything viewed this preview session. */
export function getPreviewStoryMentions(): StoryMentionItem[] {
  if (!isPreviewStoryMentionsEnabled()) return [];
  if (!cached) {
    const now = Date.now();
    cached = SEEDS.map((seed) => {
      const createdAt = now - seed.hoursAgo * HOUR;
      return {
        storyId: seed.storyId,
        tagger: {
          userId: seed.userId, name: seed.name, handle: seed.handle, initials: seed.initials,
          color: seed.color, avatarUrl: posterUri(seed.poster), accountType: 'buyer',
        },
        thumbnailUrl: posterUri(seed.slides[0]),
        slide: 0,
        seen: !!seed.seen,
        handled: !!seed.handledAction,
        handledAction: seed.handledAction ?? null,
        mentionedAt: createdAt,
        story: buildStory(seed, createdAt),
      };
    });
  }
  return cached.map((item) => (runtimeSeen.has(item.storyId) ? { ...item, seen: true } : item));
}

/** Viewing a preview mention lights its ring down, like the real view record would. */
export function markPreviewStoryMentionSeen(storyId: string): void {
  runtimeSeen.add(storyId);
}
