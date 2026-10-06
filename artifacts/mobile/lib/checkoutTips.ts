/**
 * Buyer checkout tips — offered for a seller whose Checkout settings turn
 * tipping on (the quote's group says `tippingEnabled`). The server
 * (api-server lib/sellerCheckoutSettings.ts checkTip) re-checks every tip:
 * whole cents, at most the seller's item subtotal and at most $1,000.
 */

export const TIP_PRESET_PERCENTS = [10, 15, 20] as const;
export const MAX_TIP_CENTS_CLIENT = 100_000;

export type TipChoice =
  | { kind: 'none' }
  | { kind: 'percent'; percent: number }
  | { kind: 'custom'; text: string };

/** A percentage of the seller's item subtotal, rounded to the cent. */
export function percentTipCents(subtotalCents: number, percent: number): number {
  if (!Number.isFinite(subtotalCents) || subtotalCents <= 0 || !Number.isFinite(percent) || percent <= 0) return 0;
  return Math.round((subtotalCents * percent) / 100);
}

/** "5", "5.5", "$5.50" → cents; null when it isn't a valid amount. */
export function parseTipInput(text: string): number | null {
  const cleaned = text.trim().replace(/^\$/, '').trim();
  if (!cleaned) return 0;
  if (!/^\d{1,6}(\.\d{0,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/** The highest tip the server accepts for this seller group. */
export function maxTipCents(subtotalCents: number): number {
  return Math.max(0, Math.min(MAX_TIP_CENTS_CLIENT, Math.floor(subtotalCents)));
}

/** The tip a choice adds, or null when a custom amount is invalid or above the maximum. */
export function tipCentsFor(choice: TipChoice, subtotalCents: number): number | null {
  if (choice.kind === 'none') return 0;
  const cents = choice.kind === 'percent'
    ? percentTipCents(subtotalCents, choice.percent)
    : parseTipInput(choice.text);
  if (cents == null) return null;
  return cents > maxTipCents(subtotalCents) ? null : cents;
}

/**
 * The tips sent with the quote and the payment: only valid, non-zero tips for
 * sellers that accept tips. Returns sellerId → cents.
 */
export function tipsForRequest(
  choices: Record<string, TipChoice>,
  groups: Array<{ sellerId: string; subtotalCents: number; tippingEnabled?: boolean }>,
): Record<string, number> {
  const tips: Record<string, number> = {};
  for (const group of groups) {
    if (group.tippingEnabled !== true) continue;
    const choice = choices[group.sellerId];
    if (!choice) continue;
    const cents = tipCentsFor(choice, group.subtotalCents);
    if (cents && cents > 0) tips[group.sellerId] = cents;
  }
  return tips;
}
