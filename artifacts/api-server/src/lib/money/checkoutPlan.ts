/**
 * Decides, on the server, how a checkout is charged:
 *  - "destination": in-stock items. Paid straight to the seller's Stripe
 *    account; Brandthread keeps 5% + the processing estimate as the
 *    application fee.
 *  - "held": items from a preorder drop. Charged to Brandthread and held
 *    until each order ships.
 *
 * The decision comes from the products' own drop — never from the client —
 * so a buyer cannot route a preorder around the hold (or an in-stock order
 * into it) by editing a request.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, drops, follows, products } from "@workspace/db";
import { destinationApplicationFeeCents } from "./fees";
import { isDropLive } from "./dropLaunch";
import type { DbExecutor } from "./ledger";

export class CheckoutPlanError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = "CheckoutPlanError";
  }
}

export type ChargePlan =
  | { chargeModel: "destination"; dropId: null }
  | { chargeModel: "held"; dropId: string };

export async function resolveChargePlan(input: {
  productIds: string[];
  sellerId: string;
  buyerId?: string | null;
  clientDropId?: string | null;
  now?: Date;
  executor?: DbExecutor;
}): Promise<ChargePlan> {
  const executor = input.executor ?? db;
  const now = input.now ?? new Date();
  const ids = [...new Set(input.productIds)];
  if (ids.length === 0) throw new CheckoutPlanError("Cart is empty", 400, "EMPTY_CART");

  const rows = await executor.select({
    productId: products.id,
    dropId: products.dropId,
    dropType: drops.type,
    dropStatus: drops.status,
    dropOwnerId: drops.ownerId,
    escrowState: drops.escrowState,
    deadline: drops.fulfillmentDeadlineAt,
    releaseAt: drops.releaseAt,
    earlyAccessMinutes: drops.earlyAccessMinutes,
  }).from(products)
    .leftJoin(drops, eq(drops.id, products.dropId))
    .where(inArray(products.id, ids));

  // ── Launch-time enforcement (server clock, never the client) ─────────────
  // Applies to every drop-linked product, pre-order or pre-made: buyers
  // cannot check out before the drop is 'active' and its releaseAt has
  // passed, unless they get the seller's configured early-access window.
  const dropsById = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (row.dropId) dropsById.set(row.dropId, row);
  }
  for (const drop of dropsById.values()) {
    if (drop.dropStatus && drop.dropStatus !== "active") {
      throw new CheckoutPlanError("This drop is not currently available.", 409, "DROP_NOT_ACTIVE");
    }
    if (!drop.releaseAt) continue;
    const earlyAccessMinutes = drop.earlyAccessMinutes ?? 0;
    let hasEarlyAccess = false;
    if (earlyAccessMinutes > 0 && input.buyerId) {
      const [isFollower] = await executor.select({ followerId: follows.followerId }).from(follows)
        .where(and(eq(follows.followerId, input.buyerId), eq(follows.followingId, drop.dropOwnerId!)))
        .limit(1);
      hasEarlyAccess = !!isFollower;
    }
    if (!isDropLive(drop.releaseAt, earlyAccessMinutes, hasEarlyAccess, now)) {
      throw new CheckoutPlanError("This drop hasn't launched yet.", 409, "DROP_NOT_LIVE");
    }
  }

  const preorderDrops = new Set<string>();
  let inStock = 0;
  for (const row of rows) {
    if (row.dropId && row.dropType === "pre-order") preorderDrops.add(row.dropId);
    else inStock++;
  }
  if (preorderDrops.size > 0 && inStock > 0) {
    throw new CheckoutPlanError(
      "Preorder items are paid separately from in-stock items. Check out the preorder on its own.",
      409, "MIXED_PREORDER_CART",
    );
  }
  if (preorderDrops.size > 1) {
    throw new CheckoutPlanError(
      "Items from different preorder drops must be checked out separately.",
      409, "MULTIPLE_PREORDER_DROPS",
    );
  }

  if (preorderDrops.size === 0) {
    if (input.clientDropId) {
      throw new CheckoutPlanError("These items are not part of a preorder drop", 400, "DROP_MISMATCH");
    }
    return { chargeModel: "destination", dropId: null };
  }

  const dropId = [...preorderDrops][0];
  if (input.clientDropId && input.clientDropId !== dropId) {
    throw new CheckoutPlanError("These items belong to a different drop", 400, "DROP_MISMATCH");
  }
  const drop = rows.find((row) => row.dropId === dropId)!;
  if (drop.dropOwnerId !== input.sellerId) {
    throw new CheckoutPlanError("This preorder is not available", 409, "DROP_NOT_ACCEPTING_PREORDERS");
  }
  if (drop.escrowState !== "collecting" || !drop.deadline || drop.deadline.valueOf() <= now.valueOf()) {
    throw new CheckoutPlanError(
      "This preorder drop is no longer taking orders.",
      409, "DROP_NOT_ACCEPTING_PREORDERS",
    );
  }
  return { chargeModel: "held", dropId };
}

/**
 * The Stripe payment_intent_data fragment and the fee decision to persist
 * alongside the checkout. Destination charges carry the application fee;
 * held charges stay on Brandthread's balance, grouped by drop.
 */
export function paymentIntentMoney(input: {
  plan: ChargePlan;
  sellerStripeAccountId: string;
  merchandiseCents: number;
  preTaxTotalCents: number;
}): {
  paymentIntentData: Record<string, unknown>;
  platformFeeCents: number;
  processingFeeEstimateCents: number;
} {
  const fee = destinationApplicationFeeCents({
    merchandiseCents: input.merchandiseCents,
    preTaxTotalCents: input.preTaxTotalCents,
  });
  if (input.plan.chargeModel === "held") {
    return {
      paymentIntentData: {
        transfer_group: `drop_${input.plan.dropId}`,
        metadata: { chargeModel: "held", dropId: input.plan.dropId },
      },
      platformFeeCents: fee.platformFeeCents,
      processingFeeEstimateCents: fee.processingFeeEstimateCents,
    };
  }
  return {
    paymentIntentData: {
      transfer_data: { destination: input.sellerStripeAccountId },
      application_fee_amount: fee.applicationFeeCents,
      metadata: { chargeModel: "destination" },
    },
    platformFeeCents: fee.platformFeeCents,
    processingFeeEstimateCents: fee.processingFeeEstimateCents,
  };
}
