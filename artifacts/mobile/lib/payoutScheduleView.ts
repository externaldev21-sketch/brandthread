/**
 * Types and pure view helpers for the payout schedule and payout detail
 * screens (app/payout-schedule.tsx, app/payout-detail.tsx). Mirrors the
 * responses of GET/PATCH /api/finance/payout-schedule and
 * GET /api/finance/payouts/:id.
 */
import { formatCents } from './money';

export type WeeklyAnchor = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
export const WEEKLY_ANCHORS: readonly WeeklyAnchor[] = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
];

export type ScheduleChoice = 'daily' | 'weekly' | 'instant';

export type PayoutScheduleInfo = {
  connected: boolean;
  providerConfigured: boolean;
  payoutsEnabled: boolean;
  schedule: { interval: string | null; weeklyAnchor: string | null; delayDays: number | null } | null;
  instant: {
    eligible: boolean;
    reason: string | null;
    destination: { id: string; brand: string | null; last4: string | null; funding: string | null } | null;
    feeBps: number;
    minFeeCents: number;
    maxAmount: { amount: number; formatted: string } | null;
    quote: { amount: number; fee: number; feeFormatted: string; total: number; withinBalance: boolean } | null;
  };
  nextPayoutEstimate: { kind: string; date: string | null; amount: number; formatted: string } | null;
};

export type PayoutLine = { amount: number; formatted: string };
export type PayoutDetail = {
  connected: boolean;
  payout: null | {
    id: string;
    amount: number;
    formatted: string;
    status: string;
    method: string;
    automatic: boolean;
    arrivalDate: string;
    created: string;
    failureMessage: string | null;
    destination: { last4: string | null; brand: string | null } | null;
    instantFee: PayoutLine | null;
  };
  breakdown: null | {
    lines: Record<'sales' | 'platformFee' | 'stripeFee' | 'refunds' | 'disputes' | 'holds' | 'adjustments', PayoutLine>;
    net: PayoutLine;
    reconciled: boolean;
    remainder: PayoutLine;
    transactionCount: number;
    truncated: boolean;
  };
};

export function cap(word: string): string {
  return word ? word[0].toUpperCase() + word.slice(1) : word;
}

/** Which radio is selected for the account's current Stripe schedule. */
export function choiceFromSchedule(info: Pick<PayoutScheduleInfo, 'schedule'>): ScheduleChoice | null {
  const interval = info.schedule?.interval;
  if (interval === 'daily') return 'daily';
  if (interval === 'weekly') return 'weekly';
  if (interval === 'manual') return 'instant';
  return null;
}

/** Why Instant cannot be chosen, in the seller's words; null when it can. */
export function instantUnavailableReason(instant: PayoutScheduleInfo['instant']): string | null {
  if (instant.eligible) return null;
  switch (instant.reason) {
    case 'not_instant_capable': return 'Add a debit card to use Instant payouts.';
    case 'no_destination': return 'Add a debit card to use Instant payouts.';
    case 'payouts_disabled': return 'Finish verifying your Stripe account first.';
    default: return 'Connect Stripe to use Instant payouts.';
  }
}

export function instantFeeLabel(instant: Pick<PayoutScheduleInfo['instant'], 'feeBps' | 'minFeeCents'>): string {
  const pct = instant.feeBps % 100 === 0 ? String(instant.feeBps / 100) : (instant.feeBps / 100).toFixed(2);
  return `${pct}% fee, minimum ${formatCents(instant.minFeeCents)}`;
}

export type BreakdownRow = { key: string; label: string; value: string; strong?: boolean };

/** Rows of the Sales / fees / refunds / holds breakdown; zero rows are dropped except Sales. */
export function breakdownRows(detail: PayoutDetail): BreakdownRow[] {
  const b = detail.breakdown;
  if (!b) return [];
  const l = b.lines;
  const rows: BreakdownRow[] = [
    { key: 'sales', label: 'Sales', value: l.sales.formatted },
    { key: 'platformFee', label: 'Platform fee', value: l.platformFee.formatted },
    { key: 'stripeFee', label: 'Stripe fee', value: l.stripeFee.formatted },
    { key: 'refunds', label: 'Refunds', value: l.refunds.formatted },
    { key: 'disputes', label: 'Disputes', value: l.disputes.formatted },
    { key: 'holds', label: 'Holds', value: l.holds.formatted },
    { key: 'adjustments', label: 'Adjustments', value: l.adjustments.formatted },
  ];
  const keep = rows.filter((row) => row.key === 'sales' || row.key === 'platformFee' || row.key === 'stripeFee'
    || l[row.key as keyof typeof l].amount !== 0);
  return [...keep, { key: 'net', label: 'Net payout', value: b.net.formatted, strong: true }];
}

export function payoutStatusLabel(status: string): string {
  switch (status) {
    case 'paid': return 'Paid';
    case 'in_transit': return 'In transit';
    case 'pending': return 'Pending';
    case 'failed': return 'Failed';
    case 'canceled': return 'Canceled';
    default: return cap(status.replace(/_/g, ' '));
  }
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "Next payout" sentence from the server estimate. */
export function nextPayoutLabel(est: PayoutScheduleInfo['nextPayoutEstimate']): string | null {
  if (!est) return null;
  if (est.kind === 'manual') return 'Manual. You choose when to cash out.';
  if (est.kind === 'none' || !est.date) return null;
  return `${est.formatted} around ${fmtDate(est.date)}`;
}
