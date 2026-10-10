/**
 * Pure helpers for showing Brandthread's fee schedule. The numbers are NEVER
 * defined here: they come from GET /api/public/fee-schedule, which reads them
 * from the server's single source (api-server lib/money/fees.ts). When the
 * schedule is unavailable callers get `null` and hide their fee UI.
 *
 * Arithmetic mirrors the server's integer rules: basis points, half-up
 * rounding, fees capped so the seller's net is never negative.
 */

export interface FeeSchedule {
  platformFeeBps: number;
  processing: { bps: number; fixedCents: number };
}

export interface FeeQuote {
  grossCents: number;
  platformFeeCents: number;
  processingFeeCents: number;
  sellerNetCents: number;
}

const isNonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

/** Validates an API payload; anything malformed is treated as "no schedule". */
export function parseFeeSchedule(raw: unknown): FeeSchedule | null {
  const r = raw as any;
  if (!r || !isNonNegInt(r.platformFeeBps) || !r.processing) return null;
  if (!isNonNegInt(r.processing.bps) || !isNonNegInt(r.processing.fixedCents)) return null;
  return {
    platformFeeBps: r.platformFeeBps,
    processing: { bps: r.processing.bps, fixedCents: r.processing.fixedCents },
  };
}

/** amount x bps / 10 000, rounded half-up, integer-only (no float drift). */
export function bpsOfCents(cents: number, bps: number): number {
  const whole = Math.floor(cents / 10_000) * bps;
  const rest = ((cents % 10_000) * bps + 5_000) / 10_000;
  return whole + Math.floor(rest);
}

/** 500 -> "5%", 290 -> "2.9%", 125 -> "1.25%". */
export function bpsToPercentLabel(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = String(bps % 100).padStart(2, '0').replace(/0+$/, '');
  return `${whole}${frac ? `.${frac}` : ''}%`;
}

/** What a seller receives for one sale of `priceCents` (+ optional shipping the buyer pays). */
export function quoteFromSchedule(
  schedule: FeeSchedule,
  priceCents: number,
  opts: { quantity?: number; shippingCents?: number } = {},
): FeeQuote {
  const quantity = opts.quantity && opts.quantity > 0 ? opts.quantity : 1;
  const merchandise = Math.max(0, Math.round(priceCents)) * quantity;
  const gross = merchandise + Math.max(0, opts.shippingCents ?? 0);
  // Brandthread's fee is on item + shipping, like the server (api-server lib/money/fees.ts).
  const platformFee = Math.min(bpsOfCents(gross, schedule.platformFeeBps), gross);
  const rawProcessing = gross === 0 ? 0 : bpsOfCents(gross, schedule.processing.bps) + schedule.processing.fixedCents;
  const processingFee = Math.min(rawProcessing, gross - platformFee);
  return {
    grossCents: gross,
    platformFeeCents: platformFee,
    processingFeeCents: processingFee,
    sellerNetCents: gross - platformFee - processingFee,
  };
}

/** "2.9% + 30¢" style label for the processing rate. */
export function processingRateLabel(schedule: FeeSchedule): string {
  const { bps, fixedCents } = schedule.processing;
  const fixed = fixedCents % 100 === 0 ? `$${fixedCents / 100}` : `${fixedCents}¢`;
  return fixedCents > 0 ? `${bpsToPercentLabel(bps)} + ${fixed}` : bpsToPercentLabel(bps);
}
