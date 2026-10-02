import { allPreviewSellerOrders } from './previewSellerOrders';
import { formatCents } from './money';
import type { FinanceSummary } from './financeSummary';

export interface FinanceTransactionRow {
  id: string;
  description?: string;
  type: string;
  amount: number;
  fee?: number;
  net: number;
  created: string | number;
}

export interface PreviewFinanceTransaction extends FinanceTransactionRow {
  description: string;
  type: 'payment';
  fee: number;
  created: string;
}

export interface PreviewFinanceDemo {
  summary: FinanceSummary;
  transactions: PreviewFinanceTransaction[];
}

const money = (amount: number) => ({ amount, formatted: formatCents(amount) });

/** Local-only ledger illustration derived from the seller's typed demo orders. */
export function getPreviewFinanceDemo(): PreviewFinanceDemo {
  const paidOrders = allPreviewSellerOrders().filter(
    (order) => order.paidAt !== null && order.status !== 'pending' && order.status !== 'cancelled',
  );
  const transactions: PreviewFinanceTransaction[] = paidOrders.slice(0, 10).map((order) => ({
    id: `preview-finance-${order.id}`,
    description: `Demo order #${order.orderNumber}`,
    type: 'payment',
    amount: order.totalCents,
    fee: 0,
    net: order.totalCents,
    created: order.paidAt!,
  }));
  const grossSalesCents = paidOrders.reduce((total, order) => total + order.totalCents, 0);
  const zero = money(0);

  return {
    summary: {
      currency: 'usd',
      connected: false,
      stripeError: false,
      held: { ...zero, drops: [] },
      releasing: { ...zero, count: 0 },
      // The Stripe balance is deliberately unavailable in a signed-out demo.
      available: null,
      pending: null,
      paidOut: { ...zero, toBank: null },
      owed: zero,
      credit: zero,
      lifetime: {
        grossSales: money(grossSalesCents),
        refunded: zero,
        platformFees: zero,
        processingFees: zero,
      },
      activity: transactions.map((transaction) => ({
        id: transaction.id,
        kind: 'order_paid_direct',
        description: transaction.description,
        orderId: transaction.id.replace(/^preview-finance-/, ''),
        dropId: null,
        occurredAt: transaction.created,
        sellerEffectCents: transaction.net,
      })),
    },
    transactions,
  };
}