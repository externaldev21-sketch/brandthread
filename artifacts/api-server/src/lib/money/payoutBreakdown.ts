/**
 * Per-payout breakdown. Turns the balance transactions Stripe attributes to a
 * payout into Sales / Platform fee / Stripe fee / Refunds / Disputes / Holds /
 * Adjustments, all signed integer cents, so that
 *
 *   sales + platformFee + stripeFee + refunds + disputes + holds + adjustments
 *     === payout amount
 *
 * always holds. Anything Stripe attributes that we cannot classify, plus any
 * gap between the attributed transactions and the payout amount (for example
 * a transaction list truncated at our page cap), is shown as "adjustments"
 * instead of being hidden; `remainderCents` says how much of it is a gap.
 */
import { MoneyError } from "./fees";

export type BalanceTxnLike = {
  type: string;
  reporting_category?: string | null;
  amount: number;
  fee: number;
  net: number;
  fee_details?: Array<{ type: string; amount: number }> | null;
};

export type PayoutBreakdownLines = {
  /** Gross sales (charges and payments received), positive. */
  sales: number;
  /** Brandthread commission, negative or zero. */
  platformFee: number;
  /** Stripe processing fees, negative or zero. */
  stripeFee: number;
  /** Refunds, negative or zero. */
  refunds: number;
  /** Disputes and their fees, net of reversals. */
  disputes: number;
  /** Reserves and held funds. */
  holds: number;
  /** Everything else, including any unexplained remainder. */
  adjustments: number;
};

export type PayoutBreakdown = {
  lines: PayoutBreakdownLines;
  payoutCents: number;
  /** Payout amount minus the net of the attributed transactions (0 when exact). */
  remainderCents: number;
  reconciled: boolean;
  transactionCount: number;
};

type Bucket = "sales" | "refunds" | "disputes" | "holds" | "adjustments" | "platformFee" | "stripeFee";

function classify(t: BalanceTxnLike): Bucket {
  const cat = t.reporting_category ?? "";
  const type = t.type;
  if (type === "charge" || type === "payment" || cat === "charge") return "sales";
  if (type === "refund" || type === "payment_refund" || type === "payment_failure_refund" || cat === "refund") return "refunds";
  if (type === "dispute" || type === "dispute_reversal" || cat === "dispute" || cat === "dispute_reversal") return "disputes";
  if (/reserve/.test(type) || /reserve/.test(cat)) return "holds";
  if (type === "application_fee" || type === "application_fee_refund") return "platformFee";
  if (type === "stripe_fee" || type === "fee") return "stripeFee";
  return "adjustments";
}

export function buildPayoutBreakdown(input: {
  payoutAmountCents: number;
  transactions: BalanceTxnLike[];
}): PayoutBreakdown {
  if (!Number.isSafeInteger(input.payoutAmountCents)) throw new MoneyError("payoutAmountCents must be an integer");
  const lines: PayoutBreakdownLines = {
    sales: 0, platformFee: 0, stripeFee: 0, refunds: 0, disputes: 0, holds: 0, adjustments: 0,
  };
  let attributedNet = 0;
  for (const t of input.transactions) {
    for (const v of [t.amount, t.fee, t.net]) {
      if (!Number.isSafeInteger(v)) throw new MoneyError("balance transactions must use integer cents");
    }
    attributedNet += t.net;
    const bucket = classify(t);
    if (bucket === "sales") {
      lines.sales += t.amount;
      // Split the fee Stripe took on this sale by its own fee_details.
      let split = 0;
      for (const d of t.fee_details ?? []) {
        if (d.type === "application_fee") lines.platformFee -= d.amount;
        else if (d.type === "stripe_fee") lines.stripeFee -= d.amount;
        else lines.adjustments -= d.amount;
        split += d.amount;
      }
      // A fee with no detail cannot be attributed; do not hide it.
      lines.adjustments -= t.fee - split;
    } else {
      lines[bucket] += t.net;
    }
  }
  const remainderCents = input.payoutAmountCents - attributedNet;
  lines.adjustments += remainderCents;
  return {
    lines,
    payoutCents: input.payoutAmountCents,
    remainderCents,
    reconciled: remainderCents === 0,
    transactionCount: input.transactions.length,
  };
}

/** Throws unless the lines add up to the payout to the cent. */
export function assertBreakdownReconciles(b: PayoutBreakdown): void {
  const l = b.lines;
  const total = l.sales + l.platformFee + l.stripeFee + l.refunds + l.disputes + l.holds + l.adjustments;
  if (total !== b.payoutCents) {
    throw new MoneyError(`payout breakdown sums to ${total} but the payout is ${b.payoutCents}`);
  }
}
