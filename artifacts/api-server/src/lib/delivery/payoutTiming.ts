/**
 * When a seller's held money for one order is paid out, in words the payout
 * screens can show. Pure: mirrors the release rules in payoutGate.ts
 * (hold-until-delivered) and escrow.ts (pre-order drops released on ship),
 * without touching the database or the clock.
 */
import { payoutHoldApplies } from "./payoutGate";
import {
  PREORDER_DELIVERY_DAYS, REGULAR_DELIVERY_DAYS, payoutBufferDays, payoutMode, type PayoutMode,
} from "./policy";

export type PayoutHoldRule = {
  mode: PayoutMode;
  /** Days after delivery before the seller is paid (hold mode only). */
  bufferDays: number;
  regularDeliveryDays: number;
  preorderDeliveryDays: number;
};

export function payoutHoldRule(env: NodeJS.ProcessEnv = process.env): PayoutHoldRule {
  return {
    mode: payoutMode(env),
    bufferDays: payoutBufferDays(env),
    regularDeliveryDays: REGULAR_DELIVERY_DAYS,
    preorderDeliveryDays: PREORDER_DELIVERY_DAYS,
  };
}

export type HeldOrderTimingState =
  /** Hold-until-delivered: not delivered yet, so no release date exists. */
  | "awaiting_delivery"
  /** Delivered; paid on releaseAt. */
  | "scheduled"
  /** Delivered, but a chargeback or open return keeps it held. */
  | "paused"
  /** Pre-order drop order from before the guarantee: paid when it ships. */
  | "on_ship"
  /** Nothing holds it any more; the next payout sweep pays it. */
  | "processing";

export type HeldOrderTimingInput = {
  chargeModel: string | null;
  deliverBy: Date | null;
  deliveredAt: Date | null;
  payoutReleaseAt: Date | null;
  disputePausedAt: Date | null;
  hasOpenReturn: boolean;
};

export function heldOrderTiming(
  order: HeldOrderTimingInput,
  env: NodeJS.ProcessEnv = process.env,
): { state: HeldOrderTimingState; releaseAt: Date | null } {
  if (!payoutHoldApplies({ deliverBy: order.deliverBy }, env)) {
    return { state: order.chargeModel === "held" ? "on_ship" : "processing", releaseAt: null };
  }
  if (!order.deliveredAt || !order.payoutReleaseAt) return { state: "awaiting_delivery", releaseAt: null };
  if (order.disputePausedAt || order.hasOpenReturn) return { state: "paused", releaseAt: null };
  return { state: "scheduled", releaseAt: order.payoutReleaseAt };
}

/** Maps raw held-order rows to the /summary held.orders shape. */
export function heldOrderTimingRows(rows: any[], env: NodeJS.ProcessEnv = process.env) {
  const toDate = (value: unknown) => (value ? new Date(value as string) : null);
  return rows.map((row) => {
    const timing = heldOrderTiming({
      chargeModel: row.charge_model ?? null,
      deliverBy: toDate(row.deliver_by),
      deliveredAt: toDate(row.delivered_at),
      payoutReleaseAt: toDate(row.payout_release_at),
      disputePausedAt: toDate(row.dispute_paused_at),
      hasOpenReturn: Boolean(row.has_open_return),
    }, env);
    return {
      orderId: String(row.id),
      orderNumber: String(row.order_number ?? ""),
      isPreorder: Boolean(row.is_preorder),
      netCents: Number(row.seller_net_cents ?? 0),
      state: timing.state,
      deliverBy: toDate(row.deliver_by)?.toISOString() ?? null,
      payoutReleaseAt: timing.releaseAt?.toISOString() ?? null,
    };
  });
}
