/**
 * Seeded PREVIEW stories with interactive stickers (?bt_preview=buyer&demo=1
 * only, via storyId=preview-stickers-1 / preview-stickers-mine). One slide per
 * sticker: poll, question, product link, drop countdown. Votes and answers are
 * applied in memory by the viewer in this mode: there is no backend here.
 */
import { posterUri } from './previewInbox';
import { isPreviewDemoMode } from './devPreview';
import type { Story, StoryOverlay, StoryStickerState } from '@/services/socialTypes';

export const PREVIEW_STICKER_STORY = 'preview-stickers-1';
export const PREVIEW_STICKER_STORY_MINE = 'preview-stickers-mine';

export const isPreviewStickerStory = (id: string | undefined | null) =>
  !!id && id.startsWith('preview-stickers-') && isPreviewDemoMode();

const HOUR = 3600e3;

function build(id: string, mine: boolean): Story {
  const now = Date.now();
  const releaseAt = new Date(now + 2 * 24 * HOUR + 3 * HOUR + 12 * 60_000).toISOString();
  const ov = (o: Partial<StoryOverlay> & { id: string; type: StoryOverlay['type'] }): StoryOverlay => ({ x: 76, y: 340, rotation: 0, scale: 1, ...o });
  const slide = (n: number, overlays: StoryOverlay[]) => ({
    id: `${id}-slide-${n}`, type: 'photo' as const, backgroundColor: '#1C1C1E', duration: 60, imageUri: posterUri(n + 2), overlays,
  });
  const state: StoryStickerState = {
    serverNow: now,
    polls: { poll: mine
      ? { counts: [18, 11], percentages: [62, 38], total: 29, myVote: null }
      : { counts: null, percentages: null, total: null, myVote: null } },
    questions: { question: { answered: false, count: mine ? 7 : null } },
    products: { product: { productId: 'preview-product-1', name: 'Chrome Zip Hoodie', imageUrl: posterUri(1), priceCents: 14800, available: true, soldOut: false } },
    countdowns: { countdown: { dropId: 'preview-drop-1', name: 'Autumn Capsule', releaseAt, launched: false, live: false, subscribed: false } },
  };
  return {
    id, authorId: mine ? 'me' : 'preview-seller-01', authorName: mine ? 'You' : 'Atelier Noire',
    authorHandle: mine ? '@you' : '@atelier_noire', authorInitials: mine ? 'Y' : 'AN', authorColor: '#1C1C1E', authorAccountType: 'seller',
    media: [
      slide(0, [ov({ id: 'poll', type: 'poll', pollQuestion: 'Black or silver?', pollOptions: [{ label: 'Black', votes: 0 }, { label: 'Silver', votes: 0 }] })]),
      slide(1, [ov({ id: 'question', type: 'question', questionPrompt: 'What should we drop next?' })]),
      slide(2, [ov({ id: 'product', type: 'product', productId: 'preview-product-1', productName: 'Chrome Zip Hoodie', productImageUri: posterUri(1), productPriceCents: 14800 })]),
      slide(3, [ov({ id: 'countdown', type: 'countdown', dropId: 'preview-drop-1', dropName: 'Autumn Capsule', dropReleaseAt: releaseAt })]),
    ],
    privacy: { visibility: 'public', replyPermission: 'everyone', hiddenFromUserIds: [], closeFriendsOnly: false },
    viewers: [], repliesDisabled: false, createdAt: now - 2 * HOUR, expiresAt: now + 22 * HOUR, likesCount: 0,
    stickerState: state,
  } as Story;
}

export function previewStickerStory(id: string): Story | null {
  if (!isPreviewStickerStory(id)) return null;
  return build(id, id === PREVIEW_STICKER_STORY_MINE);
}

/** Demo answers for the author's "responses" sheet. */
export const PREVIEW_STICKER_ANSWERS = [
  { userId: 'preview-seller-04', name: 'Orison', handle: '@orison', initials: 'O', avatarUrl: null, answer: 'A longer silver coat, please.', createdAt: Date.now() - 20 * 60_000 },
  { userId: 'preview-seller-07', name: 'Astrae', handle: '@astrae', initials: 'A', avatarUrl: null, answer: 'More of the wide trousers in black.', createdAt: Date.now() - 55 * 60_000 },
];
