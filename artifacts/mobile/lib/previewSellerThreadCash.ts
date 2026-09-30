/**
 * Seeded PREVIEW seller Thread Cash — balance + ledger entries, shown only
 * in the __DEV__ web preview when the real API isn't reachable, same rule
 * as lib/previewThreadCash.ts (the buyer wallet's own fixture). A fresh
 * seller always sees $0.00 and no history; the seeded numbers below only
 * ever appear under the explicit `?bt_preview=seller&demo=1` opt-in.
 *
 * Sources here are seller-earned only ('live_gift', 'send_received' as a
 * message payment, 'cash_out') — a seller never sees the buyer-only sources
 * (daily_checkin, streak_bonus, checkout_spend, ...).
 */
import type { ThreadCashEntry } from './threadCashTypes';
import { isPreviewDemoMode } from './devPreview';

export const PREVIEW_SELLER_THREAD_CASH_BALANCE_CENTS = 4260;

const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString();

export const PREVIEW_SELLER_THREAD_CASH_HISTORY: ThreadCashEntry[] = [
  { id: 'stc-1', buyerId: 'preview-seller', amountCents: 500, source: 'live_gift', referenceId: null, note: 'Gift during your Live', createdAt: daysAgo(0) },
  { id: 'stc-2', buyerId: 'preview-seller', amountCents: 200, source: 'send_received', referenceId: null, note: 'From Jordan Reyes', createdAt: daysAgo(1) },
  { id: 'stc-3', buyerId: 'preview-seller', amountCents: -2000, source: 'cash_out', referenceId: null, note: 'Cashed out to payout balance', createdAt: daysAgo(2) },
  { id: 'stc-4', buyerId: 'preview-seller', amountCents: 1500, source: 'live_gift', referenceId: null, note: 'Gift during your Live', createdAt: daysAgo(3) },
  { id: 'stc-5', buyerId: 'preview-seller', amountCents: 60, source: 'send_received', referenceId: null, note: 'From Amara Chen', createdAt: daysAgo(4) },
  { id: 'stc-6', buyerId: 'preview-seller', amountCents: 4000, source: 'live_gift', referenceId: null, note: 'Gift during your Live', createdAt: daysAgo(5) },
];

export function getPreviewSellerThreadCashBalanceCents(): number {
  return isPreviewDemoMode() ? PREVIEW_SELLER_THREAD_CASH_BALANCE_CENTS : 0;
}

export function getPreviewSellerThreadCashHistory(): ThreadCashEntry[] {
  return isPreviewDemoMode() ? PREVIEW_SELLER_THREAD_CASH_HISTORY : [];
}
