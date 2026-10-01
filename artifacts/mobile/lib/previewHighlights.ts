/**
 * Seeded PREVIEW data for the highlights "Select stories" grid and the
 * highlight viewer (?bt_preview=buyer&demo=1 only — never a real account).
 * Reuses the bundled fashion posters the stories tray preview already uses.
 */
import { posterUri } from './previewInbox';
import type { HighlightPickerStory } from '@/lib/api';
import type { Story } from '@/services/socialTypes';

const DAY = 24 * 3600e3;

export const PREVIEW_HIGHLIGHT_ID = 'preview-highlight-1';

export function previewHighlightPickerStories(): HighlightPickerStory[] {
  const now = Date.now();
  return [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({
    storyId: `preview-highlight-story-${i}`,
    thumbnailUrl: posterUri(i),
    slides: 1,
    visibility: i === 3 ? 'close_friends' as const : 'public' as const,
    createdAt: now - (i === 0 ? 2 * 3600e3 : (i + 1) * DAY),
    live: i === 0,
  }));
}

/** Story-shaped slides for the demo highlight opened in buyer-story-viewer. */
export function previewHighlightStories(): Story[] {
  const now = Date.now();
  return [0, 1, 2].map((i) => ({
    id: `preview-highlight-item-${i}`,
    authorId: 'preview-seller-01', authorName: 'Atelier Noire', authorHandle: '@atelier_noire',
    authorInitials: 'AN', authorColor: '#1C1C1E', authorAccountType: 'seller',
    media: [{ id: `preview-highlight-item-${i}-slide`, type: 'photo', backgroundColor: '#000000', duration: 5, imageUri: posterUri(i + 1) }],
    privacy: { visibility: 'public', replyPermission: 'everyone', hiddenFromUserIds: [], closeFriendsOnly: false },
    viewers: [], repliesDisabled: true,
    createdAt: now - (i + 3) * DAY, expiresAt: now + 365 * DAY,
    likesCount: 0,
  }) as Story);
}
