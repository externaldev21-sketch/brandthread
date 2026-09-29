/**
 * Seeded PREVIEW data for the Messages stories tray (app/(buyer)/inbox.tsx)
 * and the story viewer it opens (app/buyer-story-viewer.tsx) — there's no
 * backend in the dev-web preview to answer `api.social.storiesFollowing()`,
 * so this gives the tray a full, real-looking demo: "Your story", two LIVE
 * people, three with unseen stories, and two with seen stories, every one
 * with a real bundled photo (never a gray initials circle).
 *
 * Reuses the same 10 fashion preview posters (`posterUri`, from
 * lib/previewInbox.ts) and the same LIVE seller ids as
 * lib/live/previewLiveData.ts (`preview-seller-01` = Atelier Noire,
 * `preview-seller-02` = Maison Vela) so a LIVE tray circle here is the exact
 * same creator whose ring lights up everywhere else in the preview.
 *
 * Gated by `isPreviewInboxEnabled()` (same gate as lib/previewInbox.ts) —
 * only used when the real `storiesFollowing()` call fails outright, never
 * for a real signed-in account.
 */
import { posterUri } from './previewInbox';
import { isPreviewCatalogEnabled } from './previewCatalog';
import { isPreviewDemoMode } from './devPreview';
import type { Story, StoryMedia } from '@/services/socialTypes';

export function isPreviewStoriesEnabled(): boolean {
  return isPreviewCatalogEnabled();
}

/** One tray row (mirrors the real `/api/social/stories/following` shape). */
export interface PreviewStoryTrayRow {
  authorId: string;
  authorName: string;
  authorHandle: string;
  authorInitials: string;
  authorColor: string;
  avatarUrl: string;
  isLive: boolean;
  /** Base "seen" state before any runtime viewing this session. */
  seen: boolean;
  closeFriendsOnly: boolean;
  latestCreatedAt: number;
}

const now = Date.now();
const HOUR = 3600e3;

function slide(index: number, id: string, durationSec = 5): StoryMedia {
  return {
    id,
    type: 'photo',
    backgroundColor: '#0A0A0B',
    duration: durationSec,
    imageUri: posterUri(index),
  };
}

function privacy(closeFriendsOnly = false): Story['privacy'] {
  return {
    visibility: closeFriendsOnly ? 'friends' : 'public',
    replyPermission: 'everyone',
    hiddenFromUserIds: [],
    closeFriendsOnly,
  };
}

// ─── "Your story" ───────────────────────────────────────────────────────────
// authorId 'me' matches MY_USER_ID (services/socialService.ts) and the
// viewer's own explicit `authorId !== 'me'` guard that hides the mute/report/
// block menu for your own story even when Clerk's userId is unavailable in
// the web preview.
export const PREVIEW_MY_STORY: Story = {
  id: 'preview-story-me-1',
  authorId: 'me',
  authorName: 'You',
  authorHandle: '@you',
  authorInitials: 'Y',
  authorColor: '#3A3A3E',
  authorAccountType: 'buyer',
  media: [slide(3, 'preview-story-me-1-a'), slide(3, 'preview-story-me-1-b')],
  privacy: privacy(),
  viewers: [],
  repliesDisabled: false,
  createdAt: now - 4 * HOUR,
  expiresAt: now + 20 * HOUR,
};

// ─── LIVE (no story object needed — tapping opens the live pager) ──────────
export const PREVIEW_LIVE_TRAY_ROWS: PreviewStoryTrayRow[] = [
  {
    authorId: 'preview-seller-01', authorName: 'Atelier Noire', authorHandle: '@atelier_noire',
    authorInitials: 'AN', authorColor: '#232323', avatarUrl: posterUri(0),
    isLive: true, seen: false, closeFriendsOnly: false, latestCreatedAt: now,
  },
  {
    authorId: 'preview-seller-02', authorName: 'Maison Vela', authorHandle: '@maison_vela',
    authorInitials: 'MV', authorColor: '#474747', avatarUrl: posterUri(1),
    isLive: true, seen: false, closeFriendsOnly: false, latestCreatedAt: now,
  },
];

// ─── Unseen stories (newest first) ─────────────────────────────────────────
const UNSEEN_PEOPLE = [
  // Rae Kim posts to Close Friends only — gives the tray's close-friends
  // ring a real, always-present demo case in preview mode.
  { authorId: 'preview-story-rae', name: 'Rae Kim', handle: '@raekim', initials: 'RK', color: '#333338', poster: 6, hoursAgo: 1, closeFriendsOnly: true },
  { authorId: 'preview-story-theo', name: 'Theo Park', handle: '@theo.fits', initials: 'TP', color: '#3D3D42', poster: 7, hoursAgo: 3, closeFriendsOnly: false },
  { authorId: 'preview-story-nova', name: 'Nova Dane', handle: '@nova.dane', initials: 'ND', color: '#2A2A2E', poster: 8, hoursAgo: 5, closeFriendsOnly: false },
];

// ─── Seen stories ───────────────────────────────────────────────────────────
const SEEN_PEOPLE = [
  { authorId: 'preview-story-sasha', name: 'Sasha Cole', handle: '@sasha.cole', initials: 'SC', color: '#3A3A3E', poster: 4, hoursAgo: 10, closeFriendsOnly: false },
  { authorId: 'preview-story-wyn', name: 'Wyn Ives', handle: '@wynives', initials: 'WI', color: '#292929', poster: 9, hoursAgo: 18, closeFriendsOnly: false },
];

type PreviewPerson = { authorId: string; name: string; handle: string; initials: string; color: string; poster: number; hoursAgo: number; closeFriendsOnly: boolean };

function storyFor(person: PreviewPerson): Story {
  return {
    id: `preview-story-${person.authorId}-1`,
    authorId: person.authorId,
    authorName: person.name,
    authorHandle: person.handle,
    authorInitials: person.initials,
    authorColor: person.color,
    authorAccountType: 'buyer',
    media: [slide(person.poster, `preview-story-${person.authorId}-1-a`)],
    privacy: privacy(person.closeFriendsOnly),
    viewers: [],
    repliesDisabled: false,
    createdAt: now - person.hoursAgo * HOUR,
    expiresAt: now + (24 - person.hoursAgo) * HOUR,
  };
}

export const PREVIEW_UNSEEN_STORIES: Story[] = UNSEEN_PEOPLE.map(storyFor);
export const PREVIEW_SEEN_STORIES: Story[] = SEEN_PEOPLE.map(storyFor);

function rowFor(person: PreviewPerson, seen: boolean): PreviewStoryTrayRow {
  return {
    authorId: person.authorId,
    authorName: person.name,
    authorHandle: person.handle,
    authorInitials: person.initials,
    authorColor: person.color,
    avatarUrl: posterUri(person.poster),
    isLive: false,
    seen,
    closeFriendsOnly: person.closeFriendsOnly,
    latestCreatedAt: now - person.hoursAgo * HOUR,
  };
}

// Runtime "viewed this session" overrides — a story tapped in preview mode
// moves from unseen to seen on the next render, same as the real backend
// once `trackStoryView`/`api.social.viewStory` land (which no-op against a
// nonexistent preview backend).
const runtimeSeen = new Set<string>();
export function markPreviewStorySeen(authorId: string): void {
  runtimeSeen.add(authorId);
}

/** All non-live, non-"me" tray rows (unseen first, newest first, then seen),
 *  reflecting any stories viewed this session. Fresh install by default: a
 *  brand-new account follows nobody, so the tray is empty (real "your story"
 *  after posting one still comes back through the real API/socialService,
 *  not this module). The full seeded cast only appears under `demo=1`. */
export function getPreviewStoryTrayRows(): PreviewStoryTrayRow[] {
  if (!isPreviewDemoMode()) return [];
  const unseen = UNSEEN_PEOPLE.map(p => rowFor(p, runtimeSeen.has(p.authorId)));
  const seen = SEEN_PEOPLE.map(p => rowFor(p, true));
  return [...PREVIEW_LIVE_TRAY_ROWS, ...unseen, ...seen];
}

/** The full `Story` (with real media) for a preview tray authorId, or null. */
export function getPreviewStoryFor(authorId: string): Story | null {
  if (!isPreviewDemoMode()) return null;
  if (authorId === 'me') return PREVIEW_MY_STORY;
  return [...PREVIEW_UNSEEN_STORIES, ...PREVIEW_SEEN_STORIES].find(s => s.authorId === authorId) ?? null;
}
