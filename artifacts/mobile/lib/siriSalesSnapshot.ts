/**
 * Today's sales, handed to the "Sales today" Siri Shortcut
 * (ios-extensions/SiriShortcuts/SalesTodayIntent.swift). Whenever the app
 * loads the seller's "today" numbers, it saves them to the app's standard
 * UserDefaults through React Native's built-in Settings module; the intent
 * reads them back and answers "You've sold $1,240.00 across 8 orders today."
 *
 * The intent never answers from an earlier day's numbers: the snapshot
 * carries its local calendar day, and a stale one makes Siri say to open
 * the app instead. Switching or signing out of an account clears it.
 */
import { Platform, Settings } from 'react-native';
import { formatCents } from '@/lib/money';

export const SIRI_SALES_KEYS = {
  day: 'bt.salesToday.day',
  amount: 'bt.salesToday.amount',
  orders: 'bt.salesToday.orders',
} as const;

/** Local calendar day as YYYY-MM-DD (what the Swift side compares against). */
export function localDayKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function siriSalesSnapshot(
  today: { totalCents: number; orderCount: number },
  now = new Date(),
): Record<string, string | number> {
  return {
    [SIRI_SALES_KEYS.day]: localDayKey(now),
    [SIRI_SALES_KEYS.amount]: formatCents(Math.max(0, Math.round(today.totalCents))),
    [SIRI_SALES_KEYS.orders]: Math.max(0, Math.round(today.orderCount)),
  };
}

export function saveSiriSalesSnapshot(today: { totalCents?: unknown; orderCount?: unknown } | null | undefined): void {
  if (Platform.OS !== 'ios' || !today) return;
  if (typeof today.totalCents !== 'number' || typeof today.orderCount !== 'number') return;
  try {
    Settings.set(siriSalesSnapshot({ totalCents: today.totalCents, orderCount: today.orderCount }));
  } catch {
    // Best-effort: Siri says to open the app when there's no snapshot.
  }
}

export function clearSiriSalesSnapshot(): void {
  if (Platform.OS !== 'ios') return;
  try {
    Settings.set({ [SIRI_SALES_KEYS.day]: '', [SIRI_SALES_KEYS.amount]: '', [SIRI_SALES_KEYS.orders]: 0 });
  } catch {
    // Nothing stored yet.
  }
}
