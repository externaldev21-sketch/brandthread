/**
 * Buy now, pay later messaging on the product page ("or 4 interest-free
 * payments of $23.75 with Klarna or Afterpay"). The server decides who may
 * see it (GET /api/public/sellers/:sellerId/pay-later: platform switch on AND
 * the seller opted in, plus the minimum order); checkout separately decides
 * what is actually offered, from the server-priced total.
 *
 * Mirrors bnplInstallment in api-server lib/payments/bnpl.ts: 4 payments,
 * the first absorbs the rounding remainder so they sum exactly.
 */
import { formatCents } from '@/lib/money';

export const PAY_LATER_DEFAULT_MIN_CENTS = 7_500;

export type PayLaterStatus = { eligible: boolean; minCents: number };

export function payLaterInstallments(totalCents: number): [number, number, number, number] {
  const total = Number.isFinite(totalCents) ? Math.max(0, Math.round(totalCents)) : 0;
  const each = Math.floor(total / 4);
  return [total - each * 3, each, each, each];
}

/** The line shows only for an eligible seller and a price at or over the minimum. */
export function showPayLater(status: PayLaterStatus | null | undefined, priceCents: number): boolean {
  if (!status?.eligible) return false;
  if (!Number.isInteger(priceCents) || priceCents <= 0) return false;
  return priceCents >= status.minCents;
}

/** "or 4 interest-free payments of $23.75 with Klarna or Afterpay". Uses the
 * first (largest) payment, so the quoted amount is never lower than what is due today. */
export function payLaterLine(priceCents: number): string {
  return `or 4 interest-free payments of ${formatCents(payLaterInstallments(priceCents)[0])} with Klarna or Afterpay`;
}

/** Info sheet copy, after the Klarna / Afterpay on-site messaging. */
export const PAY_LATER_SHEET = {
  title: 'Pay in 4 interest-free payments',
  steps: [
    'Pay 25% today at checkout.',
    'Then pay the rest every 2 weeks, in 3 more payments.',
    'No interest when you pay on time.',
  ],
  note: 'Choose Klarna or Afterpay at checkout. Available on orders of {min} or more. Subject to eligibility and approval by Klarna or Afterpay.',
} as const;

export function payLaterSheetNote(minCents: number): string {
  return PAY_LATER_SHEET.note.replace('{min}', formatCents(minCents).replace(/\.00$/, ''));
}
