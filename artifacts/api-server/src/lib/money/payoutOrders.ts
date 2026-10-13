/**
 * Orders inside a payout (Shopify payout detail "Transactions"). Maps the
 * balance transactions Stripe attributes to a payout back to Brandthread
 * orders through the ids stored on the order at payment time:
 *
 *   - transfer / destination / released preorder orders: the connected
 *     account sees a `py_` payment whose `source_transfer` is the order's
 *     `stripe_transfer_id`;
 *   - direct charges: the source is the order's `stripe_charge_id` (`ch_`)
 *     or carries its `stripe_payment_intent_id`.
 *
 * Refunds and disputes are attributed to the same order through the charge
 * they reference. Transactions that match no order (payout fees, Thread
 * Cash top-ups, adjustments) are left out; they stay in the breakdown.
 */

type IdRef = string | { id?: string | null } | null | undefined;

export type PayoutTxnSource = {
  id?: string | null;
  object?: string | null;
  source_transfer?: IdRef;
  payment_intent?: IdRef;
  charge?: IdRef;
  transfer?: IdRef;
};

export type PayoutTxnLike = {
  id?: string;
  type: string;
  amount: number;
  fee: number;
  net: number;
  created?: number;
  source?: string | PayoutTxnSource | null;
};

export type PayoutOrderRef = {
  id: string;
  orderNumber: string;
  buyerName: string | null;
  stripeTransferId: string | null;
  stripeChargeId: string | null;
  stripePaymentIntentId: string | null;
  createdAt: Date;
};

export type PayoutOrderRow = {
  orderId: string;
  orderNumber: string;
  buyerName?: string;
  /** Sum of the attributed balance transactions' amounts (sales minus refunds). */
  total: number;
  /** Stripe fees on those transactions. */
  fee: number;
  /** What this order contributed to the payout. */
  net: number;
  createdAt: string;
};

const refId = (ref: IdRef): string | null =>
  typeof ref === "string" ? ref : (ref && typeof ref.id === "string" ? ref.id : null);

/** Every id on a transaction that could identify its order or its charge. */
function txnIds(t: PayoutTxnLike): string[] {
  const src = t.source;
  if (!src) return [];
  if (typeof src === "string") return [src];
  return [src.id ?? null, refId(src.source_transfer), refId(src.payment_intent), refId(src.charge), refId(src.transfer)]
    .filter((v): v is string => typeof v === "string" && v.length > 0);
}

/** Ids to look orders up by (transfer, charge and payment intent ids). */
export function payoutOrderLookupIds(transactions: PayoutTxnLike[]): string[] {
  const ids = new Set<string>();
  for (const t of transactions) for (const id of txnIds(t)) ids.add(id);
  return [...ids];
}

export function mapPayoutOrders(transactions: PayoutTxnLike[], orders: PayoutOrderRef[]): PayoutOrderRow[] {
  const byId = new Map<string, PayoutOrderRef>();
  for (const o of orders) {
    for (const id of [o.stripeTransferId, o.stripeChargeId, o.stripePaymentIntentId]) {
      if (id) byId.set(id, o);
    }
  }
  const resolve = (ids: string[]) => {
    for (const id of ids) {
      const hit = byId.get(id);
      if (hit) return hit;
    }
    return null;
  };

  // First pass: payments teach us which charge (py_/ch_) belongs to which
  // order, so refunds that only reference the charge can follow.
  for (const t of transactions) {
    const ids = txnIds(t);
    const order = resolve(ids);
    if (order) for (const id of ids) if (!byId.has(id)) byId.set(id, order);
  }

  const rows = new Map<string, PayoutOrderRow & { _created: number }>();
  for (const t of transactions) {
    const order = resolve(txnIds(t));
    if (!order) continue;
    let row = rows.get(order.id);
    if (!row) {
      row = {
        orderId: order.id,
        orderNumber: order.orderNumber,
        ...(order.buyerName ? { buyerName: order.buyerName } : {}),
        total: 0,
        fee: 0,
        net: 0,
        createdAt: order.createdAt.toISOString(),
        _created: order.createdAt.valueOf(),
      };
      rows.set(order.id, row);
    }
    row.total += t.amount;
    row.fee += t.fee;
    row.net += t.net;
  }
  return [...rows.values()]
    .sort((a, b) => b._created - a._created)
    .map(({ _created, ...row }) => row);
}
