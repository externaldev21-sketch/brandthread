/**
 * Pure display helpers for the Payouts setup screen (app/payouts.tsx).
 * Kept free of React Native imports so they're cheap to unit test directly.
 */
import type { ConnectStatus } from '@/components/StripeConnectWarning';
import { SUCCESS, ORANGE } from '@/lib/theme';

export function scheduleLabel(schedule: ConnectStatus['payoutSchedule']): string {
  if (!schedule || !schedule.interval) return 'Not set yet — connect Stripe to choose one';
  switch (schedule.interval) {
    case 'manual':
      return 'Manual — you trigger each payout';
    case 'daily':
      return `Daily${schedule.delayDays ? ` (${schedule.delayDays}-day rolling delay)` : ''}`;
    case 'weekly':
      return schedule.weeklyAnchor
        ? `Weekly, every ${schedule.weeklyAnchor[0].toUpperCase()}${schedule.weeklyAnchor.slice(1)}`
        : 'Weekly';
    case 'monthly':
      return schedule.monthlyAnchor
        ? `Monthly, on day ${schedule.monthlyAnchor}`
        : 'Monthly';
    default:
      return schedule.interval;
  }
}

export function requirementLabel(field: string): string {
  // Stripe's requirement ids are dotted machine names (e.g.
  // "individual.verification.document"); show a short human label for the
  // few that show up most often and fall back to the raw id otherwise.
  if (/tax_id|id_number|ssn_last_4/.test(field)) return 'Tax ID / SSN verification';
  if (/verification\.document/.test(field)) return 'Government ID document';
  if (/bank_account|external_account/.test(field)) return 'Bank account details';
  if (/business_profile/.test(field)) return 'Business details';
  if (/company\./.test(field)) return 'Company information';
  if (/individual\./.test(field)) return 'Personal information';
  return field.replace(/_/g, ' ');
}

export function taxInfoConfig(taxInfoStatus: ConnectStatus['taxInfoStatus'], theme: { secondary: string }) {
  return {
    submitted: { label: 'On file', color: SUCCESS },
    needed:    { label: 'Action needed', color: ORANGE },
    unknown:   { label: 'Not available yet', color: theme.secondary },
  }[taxInfoStatus];
}
