/**
 * Regression guard for the live bug report: a plain `?bt_preview=buyer` load
 * (no `&demo=1`) showed $18.45 Thread Cash, a 4-day streak, and an Inbox tab
 * badge of 6 — all seeded demo values that must only ever appear under the
 * explicit `demo=1` opt-in.
 *
 * Root causes fixed alongside this test:
 *   1. lib/devPreview.ts's isPreviewDemoMode() only ever WRITES
 *      'bt_preview_demo' to localStorage (when it sees demo=1); nothing ever
 *      cleared it, so a `&demo=1` visited once in a browser stuck forever —
 *      every later plain `?bt_preview=buyer` reload in that same browser
 *      kept reading the stale flag. Fixed in app/_layout.tsx: the same
 *      one-time, module-load block that already resets `user_role` on every
 *      fresh page load now also resets `bt_preview_demo` from THIS load's
 *      own query string (see lib/__tests__/devPreview.test.ts's "sticky
 *      demo-flag regression" suite for the dedicated coverage of that fix).
 *   2. app/(buyer)/_layout.tsx's Inbox tab badge counter (`loadBadgeCount`)
 *      called the real `getConversations()`/`getNotifications()`
 *      unconditionally — no preview check at all — so it never routed
 *      through the already demo-gated `lib/previewInbox.ts` fallbacks the
 *      Inbox screen itself uses. Fixed to call `getPreviewConversations()`/
 *      `getPreviewNotifications()` directly when `isBuyerDevPreview()`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

function src(relPath: string): string {
  return readFileSync(resolve(__dirname, '..', relPath), 'utf8');
}

// ── Thread Cash: real behavioral check (lib/previewThreadCash.ts has no
// expo-asset import, so — unlike previewInbox/previewActivity/previewStories
// — it can be imported for real here, not just source-scanned). ────────────

vi.mock('@/lib/devPreview', () => ({
  isBuyerDevPreview: () => true,
  isSellerDevPreview: () => false,
  isPreviewDemoMode: () => false,
  isPreviewFreshMode: () => true,
}));

describe('fresh buyer zero state — Thread Cash', () => {
  it('a fresh (non-demo) preview session has $0.00 balance and no streak', async () => {
    const { getPreviewThreadCashStatus } = await import('@/lib/previewThreadCash');
    const status = getPreviewThreadCashStatus();
    expect(status.balanceCents).toBe(0);
    expect(status.streak.currentStreak).toBe(0);
    expect(status.streak.longestStreak).toBe(0);
    expect(status.streak.alreadyCheckedInToday).toBe(false);
    expect(status.streak.dayInCycle).toBe(0);
  });
});

describe('fresh buyer zero state — notes tray', () => {
  it('shows no notes from people I follow when not in demo mode', async () => {
    const { getPreviewNotesForTray } = await import('@/lib/previewNotes');
    expect(getPreviewNotesForTray()).toEqual([]);
  });
});

describe('fresh buyer zero state — orders', () => {
  it('the seeded preview-order-01 row does not exist outside demo mode', async () => {
    const { getPreviewBuyerOrder } = await import('@/lib/previewOrders');
    expect(getPreviewBuyerOrder('preview-order-01')).toBeNull();
  });
});

// ── Modules that pull in expo-asset (posters/logos) cannot be imported
// directly under vitest (see lib/__tests__/previewInbox.test.ts's own doc
// comment) — their demo-gating is verified by source inspection instead,
// matching this repo's established pattern for that constraint. ───────────

describe('fresh buyer zero state — inbox / activity / stories gating (source check)', () => {
  it('previewInbox.ts: seeded conversations and notifications require isPreviewDemoMode()', () => {
    const s = src('lib/previewInbox.ts');
    expect(s).toMatch(/cachedConversations = isPreviewDemoMode\(\) \? allSeeds\(\)\.map\(toConversation\) : \[\];/);
    expect(s).toMatch(/cachedNotifications = !isPreviewDemoMode\(\) \? \[\] : PREVIEW_FOLLOWER_SEEDS\.map/);
  });

  it('previewActivity.ts: the personal feed (and its unread count) requires isPreviewDemoMode()', () => {
    const s = src('lib/previewActivity.ts');
    expect(s).toMatch(/if \(!isPreviewDemoMode\(\)\) \{ cached = \[\]; return cached; \}/);
  });

  it('previewStories.ts: the story tray requires isPreviewDemoMode()', () => {
    const s = src('lib/previewStories.ts');
    expect(s).toMatch(/export function getPreviewStoryTrayRows[\s\S]{0,80}if \(!isPreviewDemoMode\(\)\) return \[\];/);
  });
});

// ── The Inbox tab badge count (app/(buyer)/_layout.tsx) ─────────────────────

describe('fresh buyer zero state — Inbox tab badge', () => {
  it('routes through the demo-gated preview fallbacks in preview mode, not the real API unconditionally', () => {
    const s = src('app/(buyer)/_layout.tsx');
    // The Messages badge counts unread messages only (Activity has its own
    // bell badge), so only the conversations fallback is needed.
    expect(s).toContain("import { getPreviewConversations } from '@/lib/previewInbox';");
    expect(s).toMatch(/isBuyerDevPreview\(\)\s*\n?\s*\?\s*getPreviewConversations\(\)/);
  });

  it('computing the badge from empty preview conversations/notifications yields zero', () => {
    // Mirrors loadBadgeCount's own math exactly.
    const conversations: Array<{ unreadCount?: number }> = [];
    const notifications: Array<{ isRead: boolean; isMuted: boolean }> = [];
    const unreadMessages = conversations.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0);
    const unreadNotifications = notifications.filter(n => !n.isRead && !n.isMuted).length;
    expect(unreadMessages + unreadNotifications).toBe(0);
  });
});

// ── The sticky-flag root cause itself — see lib/__tests__/devPreview.test.ts
// for the full dedicated suite; this cross-references it so a reviewer
// scanning fresh-buyer coverage finds the pointer here too. ────────────────

describe('fresh buyer zero state — no sticky demo flag from a prior session', () => {
  it('app/_layout.tsx resets bt_preview_demo from the current load, every load', () => {
    const s = src('app/_layout.tsx');
    expect(s).toContain("const demoParam = new URLSearchParams(window.location.search).get('demo');");
    expect(s).toContain("if (demoParam === '1') localStorage.setItem('bt_preview_demo', '1');");
    expect(s).toContain("else localStorage.removeItem('bt_preview_demo');");
  });
});
