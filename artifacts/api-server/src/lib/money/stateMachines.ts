/**
 * Explicit state machines for money. Every state change in the database goes
 * through a conditional UPDATE ("… WHERE state = <from>"), and the allowed
 * edges live here, so an illegal move (e.g. releasing a refunded order)
 * cannot happen by accident, and replays of the same move are no-ops.
 *
 * See docs/payments/money-flow.md for diagrams and plain-English meaning.
 */

export class IllegalTransitionError extends Error {
  readonly code = "ILLEGAL_TRANSITION";
  constructor(readonly machine: string, readonly from: string, readonly to: string) {
    super(`${machine}: cannot move from "${from}" to "${to}"`);
    this.name = "IllegalTransitionError";
  }
}

type Edges<S extends string> = Readonly<Record<S, readonly S[]>>;

export type StateMachine<S extends string> = {
  readonly name: string;
  readonly states: readonly S[];
  readonly terminal: readonly S[];
  isState(value: unknown): value is S;
  can(from: S, to: S): boolean;
  assert(from: S, to: S): void;
  /** States that may move into `to` — used to build "WHERE state IN (…)". */
  sourcesOf(to: S): S[];
};

function defineMachine<S extends string>(name: string, edges: Edges<S>): StateMachine<S> {
  const states = Object.keys(edges) as S[];
  return {
    name,
    states,
    terminal: states.filter((s) => edges[s].length === 0),
    isState: (value: unknown): value is S => typeof value === "string" && (states as string[]).includes(value),
    can: (from, to) => edges[from]?.includes(to) ?? false,
    assert(from, to) {
      if (!(edges[from]?.includes(to) ?? false)) throw new IllegalTransitionError(name, from, to);
    },
    sourcesOf: (to) => states.filter((s) => edges[s].includes(to)),
  };
}

/**
 * Where a buyer order's money is.
 *
 *  settled_direct  In-stock order paid with a Stripe destination charge:
 *                  the seller's share went straight to their Stripe account.
 *  held            Preorder-drop order: Brandthread holds the money.
 *  release_pending This order's tracking exists; its transfer is in flight.
 *  released        This order's share was transferred to the seller.
 *  refunded        The whole charge went back to the buyer.
 *
 * Partial refunds do not change the state; they are recorded per refund.
 */
export type OrderFundsState = "settled_direct" | "held" | "release_pending" | "released" | "refunded";
export const orderFundsMachine = defineMachine<OrderFundsState>("order_funds", {
  settled_direct: ["refunded"],
  held: ["release_pending", "refunded"],
  release_pending: ["released", "held"],
  released: ["refunded"],
  // Only when Stripe reports that a refund it had accepted later failed:
  // the money is back with the platform, so the order returns to its prior
  // money state and needs a person to follow up with the buyer.
  refunded: ["settled_direct", "held", "released"],
});

/**
 * Lifecycle of a preorder drop's held funds (drops.escrow_state).
 *
 *  collecting  Preorders are being taken; money is held.
 *  production  The bulk order is being paid/made from held funds.
 *  fulfilling  Orders are shipping; each ship releases that order's funds.
 *  completed   Every order was released or refunded (terminal).
 *  failing     Deadline passed / seller cancelled: refunds are running.
 *  failed      All unshipped buyers were refunded (terminal).
 */
export type DropEscrowState = "collecting" | "production" | "fulfilling" | "completed" | "failing" | "failed";
export const dropEscrowMachine = defineMachine<DropEscrowState>("drop_escrow", {
  collecting: ["production", "fulfilling", "completed", "failing"],
  production: ["fulfilling", "completed", "failing"],
  fulfilling: ["completed", "failing"],
  completed: [],
  failing: ["failed"],
  failed: [],
});

/** Drops in these states accept new preorders. */
export const DROP_ACCEPTS_PREORDERS: readonly DropEscrowState[] = ["collecting"];
/** Drops in these states may still release or refund held orders. */
export const DROP_OPEN_STATES: readonly DropEscrowState[] = ["collecting", "production", "fulfilling"];

/**
 * One per-order payout (order_releases.state).
 *
 *  pending      Tracking exists; waiting to transfer (e.g. seller's Stripe
 *               account not ready yet — the sweeper retries).
 *  transferring The Stripe transfer request is in flight. A crash here is
 *               safe: the retry reuses the same idempotency key.
 *  paid         Stripe confirmed the transfer.
 *  failed       Stripe definitively rejected it; retry makes a new attempt.
 *  reversed     A refund pulled the whole transfer back (terminal).
 */
export type ReleaseState = "pending" | "transferring" | "paid" | "failed" | "reversed";
export const releaseMachine = defineMachine<ReleaseState>("order_release", {
  pending: ["transferring"],
  transferring: ["paid", "failed", "pending"],
  failed: ["transferring"],
  paid: ["reversed"],
  reversed: [],
});

/**
 * One refund attempt (order_refunds.state).
 *
 *  processing  Sent to Stripe (or about to be); retry-safe by idempotency key.
 *  succeeded   Stripe accepted it; the ledger was posted exactly once.
 *  failed      Stripe rejected it; nothing was posted. (If Stripe fails a
 *              refund after accepting it, its ledger posting is reversed.)
 */
export type RefundState = "processing" | "succeeded" | "failed";
export const refundMachine = defineMachine<RefundState>("order_refund", {
  processing: ["succeeded", "failed"],
  failed: ["processing"],
  // Stripe can report that a refund it accepted later failed (e.g. the
  // buyer's card account was closed). The ledger posting is then reversed.
  succeeded: ["failed"],
});

/**
 * Buyer-facing fulfillment status (orders.status). Kept separate from the
 * money state so a UI label change can never move money.
 */
export type OrderStatus =
  | "pending" | "processing" | "fulfilled" | "label_purchasing"
  | "shipped" | "delivered" | "cancelled" | "refund_pending";
export const orderStatusMachine = defineMachine<OrderStatus>("order_status", {
  pending: ["processing", "fulfilled", "label_purchasing", "shipped", "cancelled", "refund_pending"],
  processing: ["pending", "fulfilled", "label_purchasing", "shipped", "cancelled", "refund_pending"],
  fulfilled: ["pending", "processing", "label_purchasing", "shipped", "cancelled", "refund_pending"],
  label_purchasing: ["pending", "processing", "fulfilled", "shipped"],
  // Only a completed full refund (returns flow) may cancel after shipping;
  // the seller status endpoint refuses it (see routes/orders.ts).
  shipped: ["delivered", "cancelled"],
  delivered: ["cancelled"],
  cancelled: [],
  // A full refund is in flight. Success cancels the order; a definitive
  // Stripe rejection puts it back where it was.
  refund_pending: ["cancelled", "pending", "processing", "fulfilled"],
});
