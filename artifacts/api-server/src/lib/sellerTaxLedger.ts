import { db, sellerTaxLedger } from "@workspace/db";
import { sql } from "drizzle-orm";

export type PaidPhysicalOrderTaxRecord = {
  id: string;
  ownerId: string;
  totalCents: number;
  grossChargedCents?: number | null;
  taxCents?: number | null;
  shippingCents?: number | null;
  stripePaymentIntentId?: string | null;
  stripeCheckoutSessionId?: string | null;
  createdAt?: Date | null;
  paidAt?: Date | null;
  paidAtSource?: "stripe_event" | "historical_order_created_at";
};

/**
 * Record a paid physical-goods order once. The unique order_id constraint is
 * the hard idempotency boundary, including concurrent webhook deliveries.
 */
export async function recordPaidPhysicalOrder(
  order: PaidPhysicalOrderTaxRecord,
  transaction?: any,
): Promise<void> {
  const executor = transaction ?? db;
  const paidAt = order.paidAt ?? order.createdAt ?? new Date();
  const paidAtSource = order.paidAt
    ? (order.paidAtSource ?? "stripe_event")
    : "historical_order_created_at";
  const grossPaymentCents = Number.isInteger(order.grossChargedCents)
    ? order.grossChargedCents!
    : order.totalCents;

  await executor.insert(sellerTaxLedger).values({
    sellerId: order.ownerId,
    orderId: order.id,
    calendarYear: paidAt.getUTCFullYear(),
    grossPaymentCents: Math.max(0, grossPaymentCents),
    taxCents: Math.max(0, order.taxCents ?? 0),
    shippingCents: Math.max(0, order.shippingCents ?? 0),
    currency: "usd",
    stripePaymentIntentId: order.stripePaymentIntentId ?? null,
    stripeCheckoutSessionId: order.stripeCheckoutSessionId ?? null,
    paidAt,
    paidAtSource,
  }).onConflictDoNothing({ target: sellerTaxLedger.orderId });
}

export const FEDERAL_1099K_GROSS_THRESHOLD_CENTS = 60_000;
export const FEDERAL_1099K_TRANSACTION_THRESHOLD = null;

export function federal1099KRuleForYear(year: number) {
  // Federal transition thresholds are gross-only. State thresholds may be
  // lower, and this progress indicator is informational rather than tax advice.
  if (year < 2024) {
    return {
      grossPaymentThresholdCents: 2_000_000,
      transactionThreshold: 200,
      rule: "PRE_2024_20000_AND_200" as const,
      summary: "More than $20,000 and more than 200 transactions",
    };
  }
  if (year === 2024) {
    return {
      grossPaymentThresholdCents: 500_000,
      transactionThreshold: null,
      rule: "2024_TRANSITION_5000_GROSS" as const,
      summary: "More than $5,000 in gross payments",
    };
  }
  if (year === 2025) {
    return {
      grossPaymentThresholdCents: 250_000,
      transactionThreshold: null,
      rule: "2025_TRANSITION_2500_GROSS" as const,
      summary: "More than $2,500 in gross payments",
    };
  }
  return {
    grossPaymentThresholdCents: FEDERAL_1099K_GROSS_THRESHOLD_CENTS,
    transactionThreshold: FEDERAL_1099K_TRANSACTION_THRESHOLD,
    rule: "2026_600_GROSS" as const,
    summary: "More than $600 in gross payments",
  };
}

export function federal1099KProgress(year: number, grossPaymentCents: number, transactionCount: number) {
  const rule = federal1099KRuleForYear(year);
  const transactionProgress = rule.transactionThreshold === null
    ? null
    : Math.min(1, transactionCount / rule.transactionThreshold);
  const exceedsTransactionThreshold = rule.transactionThreshold === null
    ? true
    : transactionCount > rule.transactionThreshold;
  return {
    ...rule,
    grossPaymentProgress: Math.min(1, grossPaymentCents / rule.grossPaymentThresholdCents),
    transactionProgress,
    exceedsGrossPaymentThreshold: grossPaymentCents > rule.grossPaymentThresholdCents,
    exceedsTransactionThreshold,
    meetsFederalThreshold:
      grossPaymentCents > rule.grossPaymentThresholdCents &&
      exceedsTransactionThreshold,
  };
}

export async function getSellerTaxYearTotals(sellerId: string) {
  const result = await db.execute(sql`
    SELECT
      calendar_year AS year,
      COALESCE(SUM(gross_payment_cents), 0)::bigint AS gross_payment_cents,
      COUNT(*)::bigint AS transaction_count
    FROM seller_tax_ledger
    WHERE seller_id = ${sellerId}
    GROUP BY calendar_year
    ORDER BY calendar_year DESC
  `);
  return result.rows.map((row: any) => ({
    year: Number(row.year),
    grossPaymentCents: Number(row.gross_payment_cents),
    transactionCount: Number(row.transaction_count),
  }));
}