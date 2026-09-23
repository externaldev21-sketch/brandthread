import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

/** The destructive endpoint deliberately accepts no aliases or whitespace. */
export function hasDeletionConfirmation(body: unknown): boolean {
  return !!body && typeof body === "object" && (body as { confirmation?: unknown }).confirmation === "DELETE";
}

/**
 * Something that must be settled before an account can be deleted without
 * hurting another person: a buyer waiting for an order, money still held for
 * a drop, an open dispute. Each blocker tells the user exactly what to do.
 */
export interface DeletionBlocker {
  code:
    | "seller_open_orders"
    | "seller_held_funds"
    | "seller_reserved_label_funds"
    | "seller_open_returns"
    | "seller_open_disputes"
    | "seller_payout_in_flight"
    | "buyer_orders_awaiting_shipment";
  title: string;
  detail: string;
  count: number;
  amountCents: number | null;
  /** In-app route that resolves the blocker. */
  actionRoute: string;
  actionLabel: string;
}

/** Shipped orders stop blocking deletion after this long without delivery. */
export const SHIPPED_ORDER_SETTLEMENT_DAYS = 30;

async function first<T extends Record<string, unknown>>(query: ReturnType<typeof sql>): Promise<T> {
  const result = await db.execute(query);
  return (((result as any).rows?.[0]) ?? {}) as T;
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function money(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Every reason `clerkUserId` cannot delete their account right now. An empty
 * array means deletion may proceed. Checks both seller and buyer obligations
 * because an account's history can include both.
 */
export async function getDeletionBlockers(clerkUserId: string): Promise<DeletionBlocker[]> {
  const blockers: DeletionBlocker[] = [];

  const [sellerOrders, heldFunds, labelFunds, sellerReturns, sellerDisputes, payouts, buyerOrders] = await Promise.all([
    // Paid orders the seller still owes a buyer. Shipped orders count until
    // delivery, or until they have been in transit for 30 days.
    first<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM orders
      WHERE owner_id = ${clerkUserId}
        AND paid_at IS NOT NULL
        AND status NOT IN ('delivered', 'cancelled', 'refunded', 'returned')
        AND NOT (
          status IN ('shipped', 'fulfilled')
          AND COALESCE(shipped_at, updated_at) < NOW() - (${SHIPPED_ORDER_SETTLEMENT_DAYS} * INTERVAL '1 day')
        )`),
    // Preorder / drop money collected but not yet released per order.
    first<{ n: number; cents: number }>(sql`
      SELECT count(*)::int AS n,
             COALESCE(SUM(GREATEST(balance_cents - released_cents, 0)), 0)::int AS cents
      FROM drop_wallets
      WHERE seller_id = ${clerkUserId} AND balance_cents - released_cents > 0`),
    first<{ n: number; cents: number }>(sql`
      SELECT count(*)::int AS n, COALESCE(SUM(amount_cents), 0)::int AS cents
      FROM order_fund_reservations
      WHERE owner_id = ${clerkUserId} AND status = 'reserved'`),
    first<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM returns
      WHERE seller_id = ${clerkUserId} AND status IN ('pending', 'approved')`),
    first<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM disputes
      WHERE seller_id = ${clerkUserId} AND status NOT IN ('won', 'lost', 'closed')`),
    first<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM seller_cashout_attempts
      WHERE owner_id = ${clerkUserId} AND status = 'processing'`),
    // A buyer's paid order that has not shipped yet: the seller still needs
    // the shipping address, which deletion would erase.
    first<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM orders
      WHERE buyer_id = ${clerkUserId}
        AND paid_at IS NOT NULL
        AND status IN ('pending', 'processing', 'label_purchasing')`),
  ]);

  const n = (value: unknown) => Number(value ?? 0);

  if (n(sellerOrders.n) > 0) {
    blockers.push({
      code: "seller_open_orders",
      title: `${plural(n(sellerOrders.n), "open order")} to fulfill`,
      detail: "Ship or cancel and refund these orders. Shipped orders settle once they're delivered.",
      count: n(sellerOrders.n),
      amountCents: null,
      actionRoute: "/(tabs)/orders",
      actionLabel: "Review orders",
    });
  }
  if (n(heldFunds.n) > 0) {
    blockers.push({
      code: "seller_held_funds",
      title: `${money(n(heldFunds.cents))} held for preorders and drops`,
      detail: "Buyer money for your drops is released per order when tracking is added, or refunded if a drop is cancelled. Settle each drop first.",
      count: n(heldFunds.n),
      amountCents: n(heldFunds.cents),
      actionRoute: "/finance",
      actionLabel: "Open finance",
    });
  }
  if (n(labelFunds.n) > 0) {
    blockers.push({
      code: "seller_reserved_label_funds",
      title: `${money(n(labelFunds.cents))} reserved for shipping labels`,
      detail: "Finish or void the shipping labels that are still being purchased.",
      count: n(labelFunds.n),
      amountCents: n(labelFunds.cents),
      actionRoute: "/(tabs)/orders",
      actionLabel: "Review labels",
    });
  }
  if (n(sellerReturns.n) > 0) {
    blockers.push({
      code: "seller_open_returns",
      title: `${plural(n(sellerReturns.n), "return request")} to resolve`,
      detail: "Approve, refund or deny open return requests so buyers aren't left waiting.",
      count: n(sellerReturns.n),
      amountCents: null,
      actionRoute: "/(tabs)/orders",
      actionLabel: "Review returns",
    });
  }
  if (n(sellerDisputes.n) > 0) {
    blockers.push({
      code: "seller_open_disputes",
      title: `${plural(n(sellerDisputes.n), "payment dispute")} open`,
      detail: "Card disputes must be closed before the account can be removed.",
      count: n(sellerDisputes.n),
      amountCents: null,
      actionRoute: "/finance",
      actionLabel: "View disputes",
    });
  }
  if (n(payouts.n) > 0) {
    blockers.push({
      code: "seller_payout_in_flight",
      title: "A payout is on its way to your bank",
      detail: "Wait for the payout in progress to finish. This usually takes 1–2 business days.",
      count: n(payouts.n),
      amountCents: null,
      actionRoute: "/payouts",
      actionLabel: "View payouts",
    });
  }
  if (n(buyerOrders.n) > 0) {
    blockers.push({
      code: "buyer_orders_awaiting_shipment",
      title: `${plural(n(buyerOrders.n), "order")} waiting to ship`,
      detail: "The seller still needs your shipping address. Cancel the order or wait until it ships.",
      count: n(buyerOrders.n),
      amountCents: null,
      actionRoute: "/(buyer)/orders",
      actionLabel: "View orders",
    });
  }

  return blockers;
}
