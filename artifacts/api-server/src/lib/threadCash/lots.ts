/**
 * FIFO lot accounting over the append-only Thread Cash ledger.
 *
 * The ledger stays the source of truth (balance = SUM(amount_cents)). A
 * "lot" is one credit entry plus what is left of it. Replaying the entries
 * in order yields each lot's remaining amount, where spending always
 * consumes the lot that expires soonest (non-expiring lots last). Expiry
 * is then just another ledger entry: a negative `expiry` row that zeroes
 * one specific lot, keyed `expiry:<lotEntryId>` so it can only ever post
 * once.
 *
 * Pure functions only; expiry.ts does the I/O.
 */
import { CASH_OUT_SOURCES, computeExpiresAt, isExpiringCreditSource } from "./rules";

export type LedgerEntryLike = {
  id: string;
  amountCents: number;
  source: string;
  referenceId: string | null;
  createdAt: Date;
};

export type Lot = {
  entryId: string;
  source: string;
  earnedAt: Date;
  /** null = never expires. */
  expiresAt: Date | null;
  originalCents: number;
  remainingCents: number;
};

export const EXPIRY_REFERENCE_PREFIX = "expiry:";

export function expiryReferenceFor(lotEntryId: string): string {
  return `${EXPIRY_REFERENCE_PREFIX}${lotEntryId}`;
}

function byConsumptionOrder(a: Lot, b: Lot): number {
  const ax = a.expiresAt ? a.expiresAt.getTime() : Number.POSITIVE_INFINITY;
  const bx = b.expiresAt ? b.expiresAt.getTime() : Number.POSITIVE_INFINITY;
  if (ax !== bx) return ax < bx ? -1 : 1;
  const ae = a.earnedAt.getTime();
  const be = b.earnedAt.getTime();
  if (ae !== be) return ae - be;
  return a.entryId < b.entryId ? -1 : 1;
}

function consume(lots: Lot[], amount: number, order: (a: Lot, b: Lot) => number, usable: (lot: Lot) => boolean): number {
  let left = amount;
  for (const lot of lots.filter((l) => l.remainingCents > 0 && usable(l)).sort(order)) {
    if (left <= 0) break;
    const take = Math.min(lot.remainingCents, left);
    lot.remainingCents -= take;
    left -= take;
  }
  return left;
}

/**
 * Replays `entries` and returns every lot that still has value. Entries may
 * arrive in any order; they are replayed by (createdAt, id).
 *
 * A debit consumes, in order: lots not yet expired at the debit's time,
 * soonest expiry first (a cash-out takes non-expiring value first, since
 * that is the only kind a seller can cash out); any shortfall, which can
 * only happen for history that predates the expiry policy, then falls back
 * to lots that had already lapsed.
 */
export function replayLots(entries: LedgerEntryLike[], expiryDays: number | null): Lot[] {
  const sorted = [...entries].sort((a, b) => {
    const t = a.createdAt.getTime() - b.createdAt.getTime();
    return t !== 0 ? t : a.id < b.id ? -1 : 1;
  });
  const lots: Lot[] = [];
  for (const entry of sorted) {
    if (entry.amountCents > 0) {
      lots.push({
        entryId: entry.id,
        source: entry.source,
        earnedAt: entry.createdAt,
        expiresAt: isExpiringCreditSource(entry.source) ? computeExpiresAt(entry.createdAt, expiryDays) : null,
        originalCents: entry.amountCents,
        remainingCents: entry.amountCents,
      });
      continue;
    }
    if (entry.amountCents === 0) continue;
    const amount = -entry.amountCents;

    if (entry.source === "expiry" && entry.referenceId?.startsWith(EXPIRY_REFERENCE_PREFIX)) {
      const target = lots.find((l) => l.entryId === entry.referenceId!.slice(EXPIRY_REFERENCE_PREFIX.length));
      if (target) {
        target.remainingCents = Math.max(0, target.remainingCents - amount);
        continue;
      }
    }

    const order = CASH_OUT_SOURCES.has(entry.source)
      ? (a: Lot, b: Lot) => {
          const an = a.expiresAt ? 1 : 0;
          const bn = b.expiresAt ? 1 : 0;
          return an !== bn ? an - bn : byConsumptionOrder(a, b);
        }
      : byConsumptionOrder;
    const at = entry.createdAt.getTime();
    const left = consume(lots, amount, order, (l) => l.expiresAt == null || l.expiresAt.getTime() > at);
    if (left > 0) consume(lots, left, order, () => true);
  }
  return lots.filter((l) => l.remainingCents > 0);
}

/** Lots whose expiry has passed and still hold value: what the job must post. */
export function dueExpiries(lots: Lot[], now: Date): Lot[] {
  return lots.filter((l) => l.expiresAt != null && l.expiresAt.getTime() <= now.getTime());
}

export type ExpiringSoon = {
  totalCents: number;
  /** Earliest upcoming expiry in the window, or null. */
  nextExpiresAt: Date | null;
  buckets: Array<{ expiresAt: Date; amountCents: number }>;
};

/** Value that lapses within (now, now + withinDays], soonest first. */
export function expiringSoon(lots: Lot[], now: Date, withinDays: number): ExpiringSoon {
  const end = now.getTime() + withinDays * 86_400_000;
  const upcoming = lots
    .filter((l) => l.expiresAt != null && l.expiresAt.getTime() > now.getTime() && l.expiresAt.getTime() <= end)
    .sort((a, b) => a.expiresAt!.getTime() - b.expiresAt!.getTime());
  const buckets: ExpiringSoon["buckets"] = [];
  for (const lot of upcoming) {
    const last = buckets[buckets.length - 1];
    // Same UTC day collapses into one bucket so a daily earner sees one line per day.
    if (last && last.expiresAt.toISOString().slice(0, 10) === lot.expiresAt!.toISOString().slice(0, 10)) {
      last.amountCents += lot.remainingCents;
    } else {
      buckets.push({ expiresAt: lot.expiresAt!, amountCents: lot.remainingCents });
    }
  }
  return {
    totalCents: buckets.reduce((sum, b) => sum + b.amountCents, 0),
    nextExpiresAt: buckets[0]?.expiresAt ?? null,
    buckets,
  };
}

/** Balance that can still be spent at `now`: lots that have not lapsed. */
export function spendableCents(lots: Lot[], now: Date): number {
  return lots
    .filter((l) => l.expiresAt == null || l.expiresAt.getTime() > now.getTime())
    .reduce((sum, l) => sum + l.remainingCents, 0);
}
