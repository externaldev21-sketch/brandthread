/**
 * Monthly Wrapped — pure helpers (unit-tested in lib/__tests__/wrapped.test.ts).
 *
 * The recap for a month is offered on the buyer's profile for the first 7
 * days of the next month (device-local date), once, and can be dismissed for
 * good. Cards: intro · pieces · top brands · most-posted piece (if any) ·
 * supporter rank (only when true) · share — 4 to 6 cards.
 */
import type { Wrapped } from '@/services/wrappedService';

export const WRAPPED_CARD_DAYS = 7;

/** "2026-09" → "September". */
export function monthName(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
}

/** The month whose recap is on offer `now`, or null outside days 1–7. */
export function offeredMonth(now: Date): string | null {
  if (now.getDate() > WRAPPED_CARD_DAYS) return null;
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
}

export function dismissKey(userId: string, month: string): string {
  return `bt:wrapped-dismissed:${userId}:${month}`;
}

export type WrappedCard = 'intro' | 'pieces' | 'brands' | 'mostPosted' | 'supporter' | 'share';

export function wrappedCards(w: Wrapped): WrappedCard[] {
  const cards: WrappedCard[] = ['intro', 'pieces', 'brands'];
  if (w.mostPosted) cards.push('mostPosted');
  if (w.supporter) cards.push('supporter');
  cards.push('share');
  return cards;
}

export function piecesLine(w: Pick<Wrapped, 'totalPieces' | 'brandCount'>): string {
  const pieces = `${w.totalPieces} ${w.totalPieces === 1 ? 'piece' : 'pieces'}`;
  const brands = w.brandCount;
  return brands ? `${pieces} · ${brands} ${brands === 1 ? 'brand' : 'brands'}` : pieces;
}
