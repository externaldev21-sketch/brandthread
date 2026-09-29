/**
 * Seeded PREVIEW data for the Notes bubbles above the Messages stories tray
 * (app/(buyer)/inbox.tsx) — there's no backend in the dev-web preview to
 * answer `api.social.notesFollowing()`/`postNote()`, so this gives the tray
 * a full, real-looking demo: "Your note" starts empty (tap-to-post, like
 * Instagram's own "Your thoughts go here...") and three followed people
 * already have short active notes.
 *
 * Reuses the same preview people `lib/previewStories.ts` seeds for the tray
 * itself, so a note bubble here sits above the exact same avatar/name
 * everywhere else in the preview.
 *
 * Gated by `isPreviewStoriesEnabled()` (same gate as previewStories.ts) —
 * only used when the real notes-tray fetch fails outright, never for a real
 * signed-in account.
 */
import type { Note } from '@/services/socialTypes';
import { isPreviewDemoMode } from './devPreview';

// Deliberately duplicates previewCatalog.ts's `isPreviewCatalogEnabled()`
// check (rather than importing it) so this module never pulls in
// `expo-asset`/bundled poster images it doesn't need — notes are plain text,
// no avatar art of their own. Keep this in sync with previewCatalog.ts's gate.
export function isPreviewNotesEnabled(): boolean {
  // Stripped to `false` in production builds — this whole module becomes
  // dead code there, not just a runtime-skipped branch.
  if (!__DEV__) return false;
  return true;
}

const now = Date.now();
const HOUR = 3600e3;

// ─── Seeded notes from people the buyer follows ───────────────────────────
// authorIds match lib/previewStories.ts's UNSEEN_PEOPLE/SEEN_PEOPLE, so
// these note bubbles float above the same tray circles.
const SEEDED_NOTES: Note[] = [
  {
    authorId: 'preview-story-rae', authorName: 'Rae Kim', authorHandle: '@raekim',
    authorInitials: 'RK', authorColor: '#333338',
    text: 'Location off', createdAt: now - 1 * HOUR, expiresAt: now + 23 * HOUR,
  },
  {
    authorId: 'preview-story-theo', authorName: 'Theo Park', authorHandle: '@theo.fits',
    authorInitials: 'TP', authorColor: '#3D3D42',
    text: 'at the thrift store', createdAt: now - 2 * HOUR, expiresAt: now + 22 * HOUR,
  },
  {
    authorId: 'preview-story-nova', authorName: 'Nova Dane', authorHandle: '@nova.dane',
    authorInitials: 'ND', authorColor: '#2A2A2E',
    text: 'new drop soon 👀', createdAt: now - 3 * HOUR, expiresAt: now + 21 * HOUR,
  },
];

// Runtime "my note" state — posting one in preview mode (there's no backend
// to persist it to) just updates this in-memory value, same pattern as
// previewStories.ts's runtimeSeen set for "viewed this session".
let myPreviewNote: Note | null = null;

/** Active notes from followed people, for the stories tray — does not
 *  include "me" (app/(buyer)/inbox.tsx renders "Your note" as its own
 *  always-first slot, same as "Your story"). Fresh install by default: a
 *  brand-new account follows nobody, so this is empty unless `demo=1`. */
export function getPreviewNotesForTray(): Note[] {
  if (!isPreviewDemoMode()) return [];
  return SEEDED_NOTES.filter(n => n.expiresAt > Date.now());
}

/** My own active note, or null if I haven't posted one this session. */
export function getPreviewMyNote(): Note | null {
  return myPreviewNote && myPreviewNote.expiresAt > Date.now() ? myPreviewNote : null;
}

/** Post (or replace) my own preview note — mirrors the real POST
 *  /api/social/notes contract (trim, 60-char cap enforced by the caller). */
export function postPreviewNote(text: string): Note {
  const trimmed = text.trim();
  const nowTs = Date.now();
  myPreviewNote = {
    authorId: 'me', authorName: 'You', authorHandle: '@you',
    authorInitials: 'Y', authorColor: '#3A3A3E',
    text: trimmed, createdAt: nowTs, expiresAt: nowTs + 24 * HOUR,
  };
  return myPreviewNote;
}
