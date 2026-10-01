/** Pure helpers for the Thread Cash ledger screen (app/thread-cash-ledger.tsx). */
import type { ThreadCashLedger, ThreadCashLedgerKind, ThreadCashLedgerRow } from './threadCashTypes';

export const LEDGER_FILTERS: Array<{ label: string; kind: ThreadCashLedgerKind | null }> = [
  { label: 'All', kind: null },
  { label: 'Earned', kind: 'earned' },
  { label: 'Spent', kind: 'spent' },
  { label: 'Expired', kind: 'expired' },
];

const LABELS: Record<string, string> = {
  daily_checkin: 'Daily check-in',
  streak_bonus: 'Streak bonus',
  redemption: 'Used at checkout',
  checkout_spend: 'Spent on an order',
  refund_credit: 'Returned from a refund',
  expiry: 'Expired',
  send_sent: 'Sent to a friend',
  send_received: 'Received from a friend',
  send_cancelled: 'Cancelled send, returned',
  send_expired: 'Unclaimed send, returned',
  redemption_cancelled: 'Returned from checkout',
  admin_adjustment: 'Adjustment',
};

export function ledgerLabel(source: string): string {
  return LABELS[source] ?? 'Adjustment';
}

export function formatExpiryDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** Rows arrive newest first; keeps that order and starts a new group per calendar month. */
export function groupLedgerByMonth(rows: ThreadCashLedgerRow[]): Array<{ title: string; rows: ThreadCashLedgerRow[] }> {
  const groups: Array<{ title: string; rows: ThreadCashLedgerRow[] }> = [];
  for (const row of rows) {
    const d = new Date(row.createdAt);
    const title = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const last = groups[groups.length - 1];
    if (last && last.title === title) last.rows.push(row);
    else groups.push({ title, rows: [row] });
  }
  return groups;
}

/** Populated sample for the `&demo=1` dev preview only. */
export function demoLedger(kind: ThreadCashLedgerKind | null): ThreadCashLedger {
  const day = 864e5;
  const now = Date.now();
  const mk = (i: number, amountCents: number, source: ThreadCashLedgerRow['source'], daysAgo: number, balanceAfterCents: number, expiresInDays: number | null = null): ThreadCashLedgerRow => ({
    id: `demo-${i}`, amountCents, source, note: null, createdAt: new Date(now - daysAgo * day).toISOString(),
    kind: amountCents >= 0 ? 'earned' : source === 'expiry' ? 'expired' : 'spent',
    balanceAfterCents,
    expiresAt: expiresInDays == null ? null : new Date(now + expiresInDays * day).toISOString(),
    remainingCents: amountCents > 0 ? amountCents : null,
  });
  const all = [
    mk(1, 10, 'daily_checkin', 0, 1845, 176),
    mk(2, 100, 'streak_bonus', 1, 1835, 5),
    mk(3, -800, 'redemption', 3, 1735),
    mk(4, 500, 'send_received', 6, 2535, 3),
    mk(5, 10, 'daily_checkin', 7, 2035, 2),
    mk(6, -250, 'expiry', 40, 2025),
    mk(7, 2275, 'refund_credit', 75, 2275, 105),
  ];
  return {
    balanceCents: 1845,
    expiryDays: 180,
    expiringSoon: {
      totalCents: 610,
      nextExpiresAt: new Date(now + 2 * day).toISOString(),
      buckets: [
        { expiresAt: new Date(now + 2 * day).toISOString(), amountCents: 10 },
        { expiresAt: new Date(now + 3 * day).toISOString(), amountCents: 500 },
        { expiresAt: new Date(now + 5 * day).toISOString(), amountCents: 100 },
      ],
    },
    rows: kind ? all.filter((r) => r.kind === kind) : all,
    hasMore: false,
  };
}
