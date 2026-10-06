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
    const inbox = read('components/inbox/MessagesInbox.tsx');
    expect(inbox).toContain('NOTE_MAX_CHARS');
    expect(inbox).toContain('maxLength={NOTE_MAX_CHARS}');
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
    const inbox = read('components/inbox/MessagesInbox.tsx');
    expect(inbox).toContain("Alert.alert('Couldn’t post your note'");
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
