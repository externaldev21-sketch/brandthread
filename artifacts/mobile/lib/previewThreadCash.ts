/**
 * Seeded PREVIEW Thread Cash status.
 *
 * The buyer profile's Thread Cash streak row has nothing real to show
 * without a live backend (there's no seller/API to answer
 * `GET /api/thread-cash` in the dev-web preview), so it silently rendered
 * nothing at all — the daily-reward streak was effectively invisible in
 * every preview screenshot. This gives it a small, real-looking partial
 * week (3 of 7 days claimed, today highlighted) to render instead.
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
  balanceCents: 480,
  config: {
    dailyAmountCents: 10,
    streakBonusCents: 100,
    streakBonusDays: 7,
    graceHours: 0,
    expiryDays: null,
    maxRedemptionPerOrderCents: null,
  },
  streak: {
    currentStreak: 3,
    longestStreak: 5,
    lastCheckInDate: new Date().toISOString().slice(0, 10),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    alreadyCheckedInToday: true,
    dayInCycle: 3,
    streakBonusDays: 7,
  },
};
