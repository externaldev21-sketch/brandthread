/**
 * Demo seller finance (GET /api/finance/balance + /transactions shapes) for
 * the dev web preview's explicit demo opt-in (`?bt_preview=seller&demo=1`)
 * ONLY. Derived from the same demo seller orders the Orders screen shows
 * (lib/previewDeliveryOrders.ts buildDemoSellerOrders), so Finance and
 * Payouts tell one coherent story: each paid order is a Stripe charge net of
 * the processing fee, the auto-refunded order is a refund, and the balance
 * is exactly what those movements add up to.
 *
 * A fresh preview and real signed-in sellers never call this — screens gate
 * it on isPreviewDemoMode() and keep their honest $0.00 state otherwise.
 */
import { buildDemoSellerOrders } from './previewDeliveryOrders';
import { formatCents as fmt } from './money';

const DAY = 24 * 60 * 60_000;
/** Charges newer than this are still settling (Stripe "pending"). */
const SETTLE_MS = 7 * DAY;
/** Demo processing fee: 2.9% + 30¢ (Stripe's standard US card rate). */
export function demoProcessingFeeCents(amountCents: number): number {
  return Math.round(amountCents * 0.029) + 30;
}

export type DemoFinanceTransaction = {
  id: string;
  type: 'charge' | 'refund';
  amount: number;
  net: number;
  fee: number;
  currency: 'usd';
  description: string;
  status: 'available' | 'pending';
  created: string;
};

export type DemoFinanceBalance = {
  available: { amount: number; currency: 'usd'; formatted: string };
  pending: { amount: number; currency: 'usd'; formatted: string };
  nextPayout: { amount: number; currency: 'usd'; formatted: string; arrivalDate: string; status: 'pending' } | null;
  connected: true;
};

export function buildDemoSellerFinance(now = Date.now()): {
  balance: DemoFinanceBalance;
  transactions: DemoFinanceTransaction[];
} {
  const transactions: DemoFinanceTransaction[] = [];
  for (const order of buildDemoSellerOrders()) {
    const total = Number(order.totalCents) || 0;
    if (!order.paidAt || total <= 0) continue;
    const paidMs = new Date(order.paidAt).getTime();
    const fee = demoProcessingFeeCents(total);
    transactions.push({
      id: `txn_preview_${order.id}_charge`,
      type: 'charge',
      amount: total,
      fee,
      net: total - fee,
      currency: 'usd',
      description: `Order ${order.orderNumber}`,
      status: now - paidMs < SETTLE_MS ? 'pending' : 'available',
      created: new Date(paidMs).toISOString(),
    });
    if (order.autoRefundedAt) {
      transactions.push({
        id: `txn_preview_${order.id}_refund`,
        type: 'refund',
        amount: -total,
        fee: 0,
        net: -total,
        currency: 'usd',
        description: `Refund for order ${order.orderNumber}`,
        status: 'available',
        created: new Date(order.autoRefundedAt).toISOString(),
      });
    }
  }
  transactions.sort((a, b) => b.created.localeCompare(a.created));

  const pending = transactions.filter((t) => t.status === 'pending').reduce((sum, t) => sum + t.net, 0);
  const available = transactions.filter((t) => t.status === 'available').reduce((sum, t) => sum + t.net, 0);
  // Stripe's default daily rolling schedule: the available balance arrives in two days.
  const arrival = new Date(now + 2 * DAY);
  arrival.setHours(12, 0, 0, 0);

  return {
    balance: {
      available: { amount: available, currency: 'usd', formatted: fmt(available) },
      pending: { amount: pending, currency: 'usd', formatted: fmt(pending) },
      nextPayout: available > 0
        ? { amount: available, currency: 'usd', formatted: fmt(available), arrivalDate: arrival.toISOString(), status: 'pending' }
        : null,
      connected: true,
    },
    transactions,
  };
}
