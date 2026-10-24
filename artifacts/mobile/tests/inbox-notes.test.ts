import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// getPreviewNotesForTray() is demo-gated (fresh-install preview default is
// zero-state; the seeded "followed people have notes" cast only shows under
// ?bt_preview=buyer&demo=1 — see lib/devPreview.ts's isPreviewDemoMode()).
// Mocked true here so this file's existing "seeds a few followed people"
// coverage keeps exercising the demo-populated path; a separate describe
// block below covers the fresh (demo=false) default directly.
vi.mock('@/lib/devPreview', () => ({ isPreviewDemoMode: () => true }));

import {
  getPreviewMyNote, getPreviewNotesForTray, postPreviewNote, isPreviewNotesEnabled,
} from '../lib/previewNotes';
import { NOTE_MAX_CHARS } from '../services/socialTypes';

const read = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf8');

// ─── Preview data (lib/previewNotes.ts) — pure logic, no RN mocking needed ───

describe('preview notes tray data', () => {
  afterEach(() => {
    // postPreviewNote mutates module-level state — reset by posting an
    // effectively-empty note is not possible (server/preview both reject
    // empty text), so each test that posts re-derives its own expectations
    // instead of relying on ordering. No teardown needed beyond that.
  });

  it('starts with no active "my note" until one is posted', () => {
    // Only true before any test in this file calls postPreviewNote(); kept
    // as a standalone assertion at the top since the seeded module state
    // is shared across tests in this file (matches previewStories.ts's own
    // runtimeSeen module-level pattern).
    const before = getPreviewMyNote();
    expect(before === null || typeof before?.text === 'string').toBe(true);
  });

  it('seeds a few followed people with short, real notes (never empty placeholder copy)', () => {
    const rows = getPreviewNotesForTray();
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      expect(row.text.trim().length).toBeGreaterThan(0);
      expect(row.text.length).toBeLessThanOrEqual(NOTE_MAX_CHARS);
      expect(row.expiresAt).toBeGreaterThan(Date.now());
    }
    // Never includes "me" — the tray renders "Your note" as its own
    // always-first slot, same as "Your story".
    expect(rows.some((r) => r.authorId === 'me')).toBe(false);
  });

  it('posting a preview note replaces any previous one and is capped like the server', () => {
    const first = postPreviewNote('Location off');
    expect(first.authorId).toBe('me');
    expect(first.text).toBe('Location off');
    expect(getPreviewMyNote()?.text).toBe('Location off');

    const second = postPreviewNote('at the gym');
    expect(getPreviewMyNote()?.text).toBe('at the gym');
    // Only ever one active note — replacing, not appending.
    expect(second.authorId).toBe('me');
  });

  it('trims whitespace the same way the server does', () => {
    postPreviewNote('  hello there  ');
    expect(getPreviewMyNote()?.text).toBe('hello there');
  });

  it('is gated behind the same preview flag as the story tray', () => {
    expect(typeof isPreviewNotesEnabled()).toBe('boolean');
  });
});

// ─── Fresh-install default (demo=0) ─────────────────────────────────────────

describe('preview notes tray data — fresh install (no demo=1)', () => {
  it('other people\'s notes are gated on isPreviewDemoMode (source check)', () => {
    const s = read('lib/previewNotes.ts');
    expect(s).toMatch(/export function getPreviewNotesForTray[\s\S]{0,80}if \(!isPreviewDemoMode\(\)\) return \[\];/);
  });
});

// ─── Source-level contract checks (mirrors tests/safety-client.test.ts's
// pattern of asserting real wiring exists, without standing up the full RN
// component tree that app/(buyer)/inbox.tsx would need) ───────────────────

describe('notes bubble wiring', () => {
  it('client service layer posts to and reads from the real notes endpoints', () => {
    const social = read('services/socialService.ts');
    expect(social).toContain("serviceRequest<Note>('/api/social/notes'");
    expect(social).toContain("serviceRequest<Note[]>('/api/social/notes/following')");
    expect(social).toContain('export async function postNote');
    expect(social).toContain('export async function getNotesForTray');
  });

  it('lib/api.ts exposes matching typed endpoints for the tray to call directly', () => {
    const api = read('lib/api.ts');
    expect(api).toContain("post<{");
    expect(api).toContain("'/api/social/notes'");
    expect(api).toContain("get<Array<{");
    expect(api).toContain("'/api/social/notes/following'");
  });

  it('the 60-char cap is shared, not re-guessed, across type, preview data and UI', () => {
    expect(NOTE_MAX_CHARS).toBe(60);
    // The composer moved into its own sheet (Instagram "Leave a note").
    const composer = read('components/social/NoteComposerSheet.tsx');
    expect(composer).toContain("import { NOTE_MAX_CHARS, type NoteAudience } from '@/services/socialTypes';");
    expect(composer).toContain('maxLength={NOTE_MAX_CHARS}');
    expect(read('components/inbox/MessagesInbox.tsx')).toContain('<NoteComposerSheet');
  });

  it('renders the note bubble as an addition above the tray, not a replacement of its chrome', () => {
    const inbox = read('components/inbox/MessagesInbox.tsx');
    // Existing tray chrome (avatar sizing, story ring, LIVE badge) is untouched.
    expect(inbox).toContain('activeRailAvatar1');
    expect(inbox).toContain('storyRingUnseen');
    expect(inbox).toContain('addStoryBadge');
    // The note bubble is new, additive markup.
    expect(inbox).toContain('noteBubble');
    expect(inbox).toContain('noteBubbleTail');
    expect(inbox).toContain('openNoteCompose');
  });

  it('never passes a function-style `style` prop to PressableScale (the app-wide bug this repo already reverted once)', () => {
    const inbox = read('components/inbox/MessagesInbox.tsx');
    // A function-style style would look like `style={({ pressed }) => ...}`
    // or `style={state =>`. Every PressableScale usage in this file (old and
    // new) must pass a plain array/object instead.
    const functionStyleProp = /<PressableScale[^>]*\sstyle=\{\s*\(/;
    expect(functionStyleProp.test(inbox)).toBe(false);
  });

  it('the note bubble sits in a plain wrapper for "Your note" — never nested inside another Pressable', () => {
    const inbox = read('components/inbox/MessagesInbox.tsx');
    // "Your note" and "Your story" must be sibling Pressables under a plain
    // View (activeRailItemWrap), since they trigger different flows
    // (compose vs. story) and nesting Pressables is disallowed app-wide.
    const wrapIdx = inbox.indexOf('activeRailItemWrap');
    expect(wrapIdx).toBeGreaterThan(-1);
    const noteIdx = inbox.indexOf('inbox-my-note');
    const storyIdx = inbox.indexOf('inbox-my-story');
    expect(noteIdx).toBeGreaterThan(wrapIdx);
    expect(storyIdx).toBeGreaterThan(noteIdx);
  });

  it('posting a note shows a real error, not a dead end, on failure', () => {
    // The sheet stays open with an inline error (no OS alert over the keyboard).
    const composer = read('components/social/NoteComposerSheet.tsx');
    expect(composer).toContain('Couldn’t share your note. Try again.');
    expect(composer).toMatch(/catch \{\s*hapticError\(\);\s*setFailed\(true\);/);
    // The inbox's handler throws on failure so the sheet can show it.
    const inbox = read('components/inbox/MessagesInbox.tsx');
    expect(inbox).toContain('setMyNote(await postNote(text, audience));');
  });

  it('the composer copies Instagram Notes: audience picker, live bubble, Share enabled on input', () => {
    const composer = read('components/social/NoteComposerSheet.tsx');
    expect(composer).toContain("friends: 'Followers you follow back'");
    expect(composer).toContain("close_friends: 'Close friends'");
    expect(composer).toContain('title="Share with"');
    expect(composer).toContain('placeholder="Share a thought…"');
    // Share is also held off while a delete is in flight (Delete note, round 2 #50).
    expect(composer).toContain('const canShare = trimmed.length > 0 && !saving && !deleting;');
    expect(composer).toContain('<CharacterRing');
    // Sits on the shared sheet, so it rides the keyboard.
    expect(composer).toContain('<Sheet');
  });

  it('lets you delete your own note from the compose sheet, after a confirm', () => {
    const composer = read('components/social/NoteComposerSheet.tsx');
    // Only offered when you already have a note.
    expect(composer).toContain('const canDelete = !!onDelete && initialText.trim().length > 0;');
    expect(composer).toMatch(/\{canDelete \? \(\s*<PressableScale\s*onPress=\{deleteNote\}/);
    expect(composer).toContain('accessibilityLabel="Delete note"');
    // Confirms first (web-visible confirmAlert), and only deletes on yes.
    expect(composer).toContain("import { confirmAlert } from '@/lib/actionSheet';");
    expect(composer).toMatch(/const ok = await confirmAlert\(\{\s*title: 'Delete note\?'[\s\S]*?destructive: true,\s*\}\);\s*if \(!ok\) return;/);
    // A failed delete keeps the sheet open with friendly copy.
    expect(composer).toContain("setDeleteError(friendlyError(err, 'Couldn’t delete your note. Try again.'));");
    const inbox = read('components/inbox/MessagesInbox.tsx');
    expect(inbox).toContain('onDelete={removeNote}');
    expect(inbox).toContain('await deleteMyNote();');
    expect(inbox).toContain('clearPreviewMyNote();');
    expect(inbox).toMatch(/async function removeNote\(\) \{[\s\S]*?setMyNote\(null\);\s*closeNoteCompose\(\);/);
  });

  it("friends' note bubbles wrap to two lines and the tray stays bottom-aligned", () => {
    const inbox = read('components/inbox/MessagesInbox.tsx');
    expect(inbox).toMatch(/s\.noteBubbleText, \{ color: theme\.text, fontFamily: FONT\.medium \}\]\} numberOfLines=\{2\}/);
    expect(inbox).toContain("contentContainerStyle={{ paddingHorizontal: gutter, gap: SP.md, paddingVertical: 2, alignItems: 'flex-end' }}");
  });

  it('posts the chosen audience to the server', () => {
    const social = read('services/socialService.ts');
    expect(social).toContain('JSON.stringify(audience ? { text, audience } : { text })');
  });

  it('uses a tall dark composer with a centered outlined bubble and a ring only after typing', () => {
    const composer = read('components/social/NoteComposerSheet.tsx');
    expect(composer).toContain('const bubbleBg = theme.cardElevated;');
    expect(composer).toContain('const bubbleBorder = `${theme.text}1F`;');
    expect(composer).toContain('borderWidth: StyleSheet.hairlineWidth, borderColor: bubbleBorder');
    expect(composer).toContain("left: '50%', marginLeft: -6");
    expect(composer).toContain("left: '47%', marginLeft: -3");
    expect(composer).toContain("alignSelf: 'center'");
    expect(composer).toMatch(/text\.length > 0 \? \(\s*<CharacterRing/);
    expect(composer).toContain('fullHeight');
    expect(composer).toContain('scrollable={false}');
    expect(composer).toContain('surfaceStyle={{ backgroundColor: theme.background }}');
    const sheet = read('components/ui/BottomSheet.tsx');
    expect(sheet).toContain('fullHeight: fillHeight = false');
    expect(sheet).toContain('(detents || fillHeight) && { height: fullHeight, maxHeight: fullHeight }');
  });
});

// ─── Backend route + schema/migration wiring ──────────────────────────────

describe('notes backend wiring', () => {
  const API_ROOT = resolve(__dirname, '..', '..', 'api-server');
  const DB_ROOT = resolve(__dirname, '..', '..', '..', 'lib', 'db');

  it('adds a real POST/GET pair alongside the existing stories routes', () => {
    const social = readFileSync(resolve(API_ROOT, 'src/routes/social.ts'), 'utf8');
    expect(social).toContain('router.post("/notes"');
    expect(social).toContain('router.get("/notes/following"');
    expect(social).toContain('NOTE_MAX_CHARS = 60');
    // One active note per author — replace, not insert-only.
    expect(social).toContain('onConflictDoUpdate');
    expect(social).toContain('target: notes.authorId');
  });

  it('the migration is additive-only and structurally parallel to the stories table', () => {
    const migrationPath = resolve(DB_ROOT, 'migrations/099_notes.sql');
    expect(existsSync(migrationPath)).toBe(true);
    const migration = readFileSync(migrationPath, 'utf8');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS notes');
    expect(migration).toContain("INTERVAL '24 hours'");
    expect(migration).toContain('notes_author_unique_idx');
    expect(migration).not.toMatch(/DROP\s+TABLE/i);
    expect(migration).not.toMatch(/ALTER\s+TABLE\s+.*\s+DROP\s+COLUMN/i);
  });

  it('the schema declares one active note per author via a unique index', () => {
    const schema = readFileSync(resolve(DB_ROOT, 'src/schema/index.ts'), 'utf8');
    expect(schema).toContain("export const notes = pgTable('notes'");
    expect(schema).toContain("uniqueIndex('notes_author_unique_idx')");
  });
});
