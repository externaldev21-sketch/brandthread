/**
 * Dispute amounts in the dispute's own currency.
 *
 * The disputes API sends `amount` as `amountCents / 100` and `currency` as
 * Stripe's lowercase code ("usd", "eur", "jpy"). `amountCents` is Stripe's
 * minor-unit amount, so it goes straight to formatCents with the currency,
 * which handles zero-decimal currencies. A missing currency reads as USD.
 */
import { formatCents } from '@/lib/money';

export function disputeCurrency(currency: string | null | undefined): string {
  const code = (currency ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : 'USD';
}

/** From the list row's major-unit `amount` (amountCents / 100). */
export function formatDisputeAmount(amount: number, currency: string | null | undefined): string {
  const cents = Math.round((Number.isFinite(amount) ? amount : 0) * 100);
  return formatCents(cents, disputeCurrency(currency));
}

/** From integer minor units (the detail's `amountCents`). */
export function formatDisputeCents(cents: number, currency: string | null | undefined): string {
  return formatCents(Number.isSafeInteger(cents) ? cents : 0, disputeCurrency(currency));
}
