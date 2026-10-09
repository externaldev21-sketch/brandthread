/**
 * Payouts in the signed-out seller web preview. Fresh (default): an honest
 * zero balance with no history and no bank. `&demo=1`: the same balance the
 * dashboard's preview shows, a next payout two days out, and a short history
 * — local illustration only, never sent anywhere.
 */
import { formatCents } from './money';

export interface PreviewPayoutRow {
  id: string;
  arrivalDate: string;
  amountCents: number;
  status: 'paid' | 'in_transit' | 'pending' | 'failed';
  bankLast4: string;
}

export interface PreviewPayouts {
  available: { amount: number; currency: 'usd'; formatted: string };
  pending: { amount: number; currency: 'usd'; formatted: string };
  connected: boolean;
  nextPayout: { arrivalDate: string } | null;
  bankLast4: string | null;
  payouts: PreviewPayoutRow[];
}

const money = (amount: number) => ({ amount, currency: 'usd' as const, formatted: formatCents(amount) });
const DAY = 86_400_000;

export function buildPreviewPayouts(demo: boolean, now: Date = new Date()): PreviewPayouts {
  if (!demo) {
    return { available: money(0), pending: money(0), connected: false, nextPayout: null, bankLast4: null, payouts: [] };
  }
  const at = (days: number) => new Date(now.getTime() + days * DAY).toISOString();
  const amounts = [61240, 48810, 72305, 39950, 55120, 44780];
  return {
    available: money(428122),
    pending: money(184250),
    connected: true,
    nextPayout: { arrivalDate: at(2) },
    bankLast4: '4242',
    payouts: amounts.map((amountCents, i) => ({
      id: `preview-payout-${i}`,
      arrivalDate: at(-(i * 7 + (i === 0 ? 0 : 1))),
      amountCents,
      status: i === 0 ? 'in_transit' : 'paid',
      bankLast4: '4242',
    })),
  };
}
