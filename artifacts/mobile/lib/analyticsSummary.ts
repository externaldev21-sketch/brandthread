/**
 * One-sentence analytics summary (S5 #125), Shopify-style: what you made in
 * the selected range and how that compares with the period before. Built
 * only from the numbers already on screen; null when there is nothing to say.
 */
import { formatCents } from '@/lib/money';

export type SummaryRange = 'today' | 'week' | 'month' | 'year' | 'all';

const PERIOD: Record<SummaryRange, string> = {
  today: 'Today', week: 'This week', month: 'This month', year: 'This year', all: 'So far',
};
const PERIOD_LOWER: Record<SummaryRange, string> = {
  today: 'today', week: 'this week', month: 'this month', year: 'this year', all: 'so far',
};
const PREVIOUS: Record<SummaryRange, string | null> = {
  today: 'yesterday', week: 'last week', month: 'last month', year: 'last year', all: null,
};

export interface SummaryInput {
  range: SummaryRange;
  revenueCents: number;
  revenueChangePct?: number | null;
  visits: number;
}

export function analyticsSummary({ range, revenueCents, revenueChangePct, visits }: SummaryInput): string | null {
  const previous = PREVIOUS[range];
  if (revenueCents > 0) {
    const made = `${PERIOD[range]} you made ${formatCents(revenueCents)}`;
    if (previous == null || revenueChangePct == null || !Number.isFinite(revenueChangePct)) return `${made}.`;
    const pct = Math.round(Math.abs(revenueChangePct));
    if (pct === 0) return `${made}, about the same as ${previous}.`;
    return `${made}, ${revenueChangePct > 0 ? 'up' : 'down'} ${pct}% on ${previous}.`;
  }
  if (visits > 0) {
    return `${visits.toLocaleString()} ${visits === 1 ? 'visit' : 'visits'} ${PERIOD_LOWER[range]}, no sales yet.`;
  }
  return null;
}
