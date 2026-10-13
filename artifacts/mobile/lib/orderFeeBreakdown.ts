/**
 * Seller order detail -> Payment -> "Fees" breakdown (item 112).
 *
 * Every number comes from the order's own stored money columns (see
 * lib/db orders: platformFeeCents, processingFeeChargedCents, sellerNetCents,
 * platformFeeRefundedCents, refundedCents, threadCashAppliedCents). They are
 * written when the order is paid (api-server lib/money/escrow.ts
 * recordOrderPaid) and on refunds (lib/money/refunds.ts).
 *
 * Before the paid webhook has recorded them, the fee schedule's quote is
 * shown instead and the breakdown is flagged `estimated` so the UI says so.
 * With neither, there is no breakdown (the row stays hidden, as before).
 */
import { bpsOfCents, bpsToPercentLabel, quoteFromSchedule, type FeeSchedule } from './feeSchedule';

export interface OrderFeeColumns {
  totalCents: number;
  subtotalCents: number;
  /** Every discount on the Stripe charge (promo + Thread Cash). */
  discountCents: number;
  shippingCents: number;
  platformFeeCents: number;
  /** Processing fee the seller was charged (processingFeeChargedCents, else processingFeeCents). */
  processingFeeCents: number;
  sellerNetCents: number;
  platformFeeRefundedCents: number;
  refundedCents: number;
  threadCashAppliedCents: number;
  /** True once the paid webhook has written the money columns. */
  recorded: boolean;
}

export interface OrderFeeLine {
  key: 'total' | 'thread_cash' | 'platform_fee' | 'processing' | 'refunded' | 'refunded_fees' | 'net';
  label: string;
  cents: number;
  strong?: boolean;
}

export interface OrderFeeBreakdown {
  estimated: boolean;
  /** Platform + processing, the value of the collapsed "Fees" row. */
  feesCents: number;
  lines: OrderFeeLine[];
}

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);

/** Reads the fee columns off the raw GET /api/orders/:id payload. */
export function orderFeeColumnsFromApi(raw: any): OrderFeeColumns {
  const platformFeeCents = n(raw?.platformFeeCents);
  const processingFeeCents = n(raw?.processingFeeChargedCents) || n(raw?.processingFeeCents);
  const sellerNetCents = n(raw?.sellerNetCents);
  return {
    totalCents: n(raw?.totalCents),
    subtotalCents: n(raw?.subtotalCents),
    discountCents: n(raw?.discountAmountCents),
    shippingCents: n(raw?.shippingCents),
    platformFeeCents,
    processingFeeCents,
    sellerNetCents,
    platformFeeRefundedCents: n(raw?.platformFeeRefundedCents),
    refundedCents: n(raw?.refundedCents),
    threadCashAppliedCents: n(raw?.threadCashAppliedCents),
    recorded: (typeof raw?.fundsState === 'string' && raw.fundsState.length > 0)
      || platformFeeCents > 0 || processingFeeCents > 0 || sellerNetCents > 0,
  };
}

/**
 * "Platform fee (5%)": the rate this order was actually charged (seller plans
 * can differ from the public schedule), read back from the recorded fee. The
 * percentage is shown only when it reproduces the recorded fee exactly on
 * the commission base (merchandise after the seller's own promo; Thread Cash
 * never lowers it). An estimate uses the schedule's rate.
 */
function platformFeeLabel(c: OrderFeeColumns, schedule: FeeSchedule | null, estimated: boolean): string {
  if (estimated) return schedule ? `Platform fee (${bpsToPercentLabel(schedule.platformFeeBps)})` : 'Platform fee';
  const fee = c.platformFeeCents;
  if (fee <= 0) return 'Platform fee';
  const promo = Math.max(0, c.discountCents - c.threadCashAppliedCents);
  const bases = [Math.max(0, c.subtotalCents - promo), c.subtotalCents].filter((b) => b > 0);
  for (const base of bases) {
    const bps = Math.round((fee * 10_000) / base);
    if (bps > 0 && bps % 5 === 0 && Math.min(bpsOfCents(base, bps), c.totalCents) === fee) {
      return `Platform fee (${bpsToPercentLabel(bps)})`;
    }
  }
  return 'Platform fee';
}

export function buildOrderFeeBreakdown(c: OrderFeeColumns, schedule: FeeSchedule | null): OrderFeeBreakdown | null {
  let estimated = false;
  let platformFee = c.platformFeeCents;
  let processing = c.processingFeeCents;
  if (!c.recorded) {
    if (!schedule || c.totalCents <= 0) return null;
    const promo = Math.max(0, c.discountCents - c.threadCashAppliedCents);
    const q = quoteFromSchedule(schedule, Math.max(0, c.subtotalCents - promo), { shippingCents: c.shippingCents });
    platformFee = Math.min(q.platformFeeCents, c.totalCents);
    processing = Math.min(q.processingFeeCents, c.totalCents - platformFee);
    estimated = true;
  }

  const fullyRefunded = c.refundedCents > 0 && c.refundedCents >= c.totalCents;
  // A full refund also reverses Brandthread's Thread Cash transfer to the seller.
  const threadCash = fullyRefunded ? 0 : c.threadCashAppliedCents;
  const lines: OrderFeeLine[] = [{ key: 'total', label: 'Order total', cents: c.totalCents }];
  if (threadCash > 0) lines.push({ key: 'thread_cash', label: 'Thread Cash applied', cents: threadCash });
  lines.push({ key: 'platform_fee', label: platformFeeLabel({ ...c, platformFeeCents: platformFee }, schedule, estimated), cents: -platformFee });
  lines.push({ key: 'processing', label: 'Payment processing', cents: -processing });
  if (c.refundedCents > 0) lines.push({ key: 'refunded', label: 'Refunded to buyer', cents: -c.refundedCents });
  if (c.platformFeeRefundedCents > 0) lines.push({ key: 'refunded_fees', label: 'Refunded fees', cents: c.platformFeeRefundedCents });

  // Recorded: the stored seller net (gross − platform fee − processing), then
  // what changed since. Estimated: the same sum over the estimate.
  const atSale = estimated ? c.totalCents - platformFee - processing : c.sellerNetCents;
  const net = atSale + threadCash - c.refundedCents + c.platformFeeRefundedCents;
  lines.push({ key: 'net', label: 'You earn', cents: net, strong: true });

  return { estimated, feesCents: platformFee + processing, lines };
}
