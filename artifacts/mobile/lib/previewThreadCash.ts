/**
 * Seeded PREVIEW Thread Cash status — the ONE fixture every screen that
 * shows a Thread Cash balance/streak in the dev-web preview must import,
 * rather than defining its own. This used to be two separate hand-rolled
 * fixtures (this file's own $4.80/3-day one, and app/thread-cash.tsx's own
 * $18.45/4-day one) that quietly drifted apart — the buyer profile's top
 * bar chip and streak card showed different numbers than the Thread Cash
 * wallet screen for the exact same preview account. Both now import this.
 *
 * The buyer profile's Thread Cash streak row has nothing real to show
 * without a live backend (there's no seller/API to answer
 * `GET /api/thread-cash` in the dev-web preview), so it silently rendered
 * nothing at all — the daily-reward streak was effectively invisible in
 * every preview screenshot. This gives it a small, real-looking partial
 * week (4 of 7 days claimed, today highlighted) to render instead.
 *
 * Gating: true only when `__DEV__` is true (stripped to `false`, dead code,
 * in every production build) — the same rule previewCatalog.ts's
 * isPreviewCatalogEnabled() applies, kept as its own tiny check here rather
 * than importing that module, which pulls in expo-asset for its poster
 * images — unnecessary weight for a screen that has no images to preview.
 * Callers must try the real API first and only fall back to this when that
 * call fails outright, never for a real signed-in production account.
 */
import type { ThreadCashStatus } from './threadCashTypes';

export function isPreviewThreadCashEnabled(): boolean {
  return __DEV__;
}

export const PREVIEW_THREAD_CASH_STATUS: ThreadCashStatus = {
  balanceCents: 1845,
  config: {
    dailyAmountCents: 10,
    streakBonusCents: 100,
    streakBonusDays: 7,
    graceHours: 20,
    expiryDays: 180,
    maxRedemptionPerOrderCents: 2000,
  },
  streak: {
    currentStreak: 4,
    longestStreak: 11,
    lastCheckInDate: new Date().toISOString().slice(0, 10),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    alreadyCheckedInToday: true,
    dayInCycle: 4,
    streakBonusDays: 7,
  },
};
