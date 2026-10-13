/**
 * The seller's money block on order detail, as a receipt.
 *
 * Every number is read from the order row GET /api/orders/:id returns (the
 * fee split api-server's recordOrderPaid writes when Stripe confirms the
 * payment). Nothing is estimated:
 *
 *   Item total       subtotal_cents
 *   Discount         discount_amount_cents minus Thread Cash (the seller's promo code)
 *   Shipping         shipping_cents (shown when the buyer paid any)
 *   Tax              tax_cents (shown when Stripe collected any)
 *   Brandthread fee  -platform_fee_cents
 *   Stripe fee       -processing_fee_charged_cents (what the seller was charged)
 *   ───────────
 *   Your payout      seller_net_cents (+ Thread Cash, which Brandthread pays on top)
 *
 * Before the payment settles (or on rows written before fees were recorded)
 * the fee columns are all 0: the receipt then ends at the order total and
 * `feesRecorded` is false, so the screen can say fees aren't in yet instead
 * of showing a made-up payout.
 */

export interface OrderReceiptLine {
  key: 'items' | 'discount' | 'shipping' | 'tax' | 'platform_fee' | 'stripe_fee';
  label: string;
  /** Signed: deductions are negative. */
  cents: number;
}

export interface OrderReceipt {
  lines: OrderReceiptLine[];
  /** What the buyer was charged (card), shown when fees aren't recorded yet. */
  orderTotalCents: number;
  feesRecorded: boolean;
  /** null until the fee split is recorded. */
  payoutCents: number | null;
}

export interface OrderReceiptSource {
  totalCents?: number | null;
  subtotalCents?: number | null;
  shippingCents?: number | null;
  taxCents?: number | null;
  discountAmountCents?: number | null;
  threadCashAppliedCents?: number | null;
  platformFeeCents?: number | null;
  processingFeeChargedCents?: number | null;
  sellerNetCents?: number | null;
}

const cents = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);

export function buildOrderReceipt(raw: OrderReceiptSource): OrderReceipt {
  const subtotal = cents(raw.subtotalCents);
  const threadCash = cents(raw.threadCashAppliedCents);
  const promo = Math.max(0, cents(raw.discountAmountCents) - threadCash);
  const shipping = cents(raw.shippingCents);
  const tax = cents(raw.taxCents);
  const platformFee = cents(raw.platformFeeCents);
  const stripeFee = cents(raw.processingFeeChargedCents);
  const net = cents(raw.sellerNetCents);
  const feesRecorded = platformFee > 0 || stripeFee > 0 || net > 0;

  const lines: OrderReceiptLine[] = [{ key: 'items', label: 'Item total', cents: subtotal }];
  if (promo > 0) lines.push({ key: 'discount', label: 'Discount', cents: -promo });
  if (shipping > 0) lines.push({ key: 'shipping', label: 'Shipping', cents: shipping });
  if (tax > 0) lines.push({ key: 'tax', label: 'Tax', cents: tax });
  if (feesRecorded) {
    lines.push({ key: 'platform_fee', label: 'Brandthread fee', cents: -platformFee });
    lines.push({ key: 'stripe_fee', label: 'Stripe fee', cents: -stripeFee });
  }

  return {
    lines,
    orderTotalCents: cents(raw.totalCents),
    feesRecorded,
    payoutCents: feesRecorded ? net + threadCash : null,
  };
}

/** "$12.00" / "−$1.20": a true minus sign so the column lines up. */
export function receiptAmount(signedCents: number, format: (c: number) => string): string {
  return signedCents < 0 ? `−${format(-signedCents)}` : format(signedCents);
}
