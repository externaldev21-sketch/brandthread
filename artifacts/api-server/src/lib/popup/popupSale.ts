/**
 * Pop-up mode: in-person sales taken with Tap to Pay on iPhone (Stripe
 * Terminal, card_present PaymentIntents).
 *
 * Money mirrors the in-app online checkout (routes/checkout-intent.ts)
 * exactly: separate charges and transfers. The card-present charge lands on
 * Brandthread's balance; the order books the seller's net as seller_held and
 * settleTransferOrder pays it out by a Stripe Transfer (transfer_group = the
 * order id, source_transaction = the charge). The platform fee is the seller's
 * plan commission (5% standard) and the seller bears Stripe's real processing
 * fee, read from the charge's balance transaction.
 *
 * The goods change hands at the table, so the order is created already
 * delivered (deliveredAt = paidAt). Under PAYOUT_MODE=hold the seller's
 * transfer still waits for the usual post-delivery buffer (chargeback window),
 * exactly like an online order once it is delivered.
 *
 * Flow:
 *  1. POST /api/seller/terminal/payment-intents prices the cart from the DB
 *     (pricePopupCart), reserves stock, persists a checkout_sessions row with
 *     source 'popup' (the pending pop-up sale) and creates the PaymentIntent.
 *  2. The app collects the card with Tap to Pay and confirms the intent.
 *  3. Stripe's payment_intent.succeeded webhook calls finalizePopupSale:
 *     one order (source 'popup'), stock committed once, idempotent on the
 *     orders.stripe_checkout_session_id unique key.
 */
import crypto from "crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  db, checkoutSessions, notificationsFeed, orderItems, orders, products, productVariants, users,
} from "@workspace/db";
import { stripe as defaultStripe } from "../stripe";
import { logger } from "../logger";
import { effectiveUnitPrice } from "../pricing/salesRuntime";
import { resolveSellerPlatformFeeBps } from "../planPerks";
import { CheckoutPlanError, resolveChargePlan } from "../money/checkoutPlan";
import { destinationApplicationFeeCents, splitOrder } from "../money/fees";
import { recordOrderPaid } from "../money/escrow";
import { fetchChargeDetails, type ChargeDetails } from "../money/stripeMoney";
import { settleTransferOrder } from "../money/cartTransfers";
import { commitStockReservation, releaseStockReservation } from "../money/stockReservation";
import { reserveStockForOrder } from "../stockReservation";
import { recordPaidPhysicalOrder } from "../sellerTaxLedger";
import { refundOrder } from "../money/refunds";
import { computePayoutReleaseAt } from "../delivery/policy";

export const POPUP_SOURCE = "popup";
export const POPUP_SALE_KIND = "popup_sale";
/** Stripe's minimum card charge in USD. */
export const POPUP_MIN_CHARGE_CENTS = 50;
export const POPUP_MAX_LINES = 50;

export class PopupSaleError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = "PopupSaleError";
  }
}

/** Pop-up mode is on only with the env flag AND a Stripe key. */
export function terminalEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STRIPE_TERMINAL_ENABLED?.trim() === "1" && Boolean(env.STRIPE_SECRET_KEY?.trim());
}

export type PopupLine = {
  variantId: string;
  productId: string;
  productName: string;
  variantLabel: string;
  quantity: number;
  /** Server price per unit (automatic sale applied), integer cents. */
  priceCents: number;
};

export type PricedPopupCart = {
  sellerId: string;
  lines: PopupLine[];
  subtotalCents: number;
  totalCents: number;
  platformFeeCents: number;
  platformFeeBps: number;
  processingFeeEstimateCents: number;
};

/**
 * Prices a pop-up cart from the database. Never trusts a client price: every
 * line must be the seller's own, active, launched, in-stock product.
 */
export async function pricePopupCart(input: {
  sellerId: string;
  items: Array<{ productId: string; variantId: string; quantity: number }>;
}): Promise<PricedPopupCart> {
  if (input.items.length === 0) throw new PopupSaleError(400, "EMPTY_CART", "Add an item first.");
  if (input.items.length > POPUP_MAX_LINES) throw new PopupSaleError(400, "TOO_MANY_LINES", "Too many items in one sale.");

  // Merge repeated variants so stock is checked against the real total.
  const merged = new Map<string, { productId: string; variantId: string; quantity: number }>();
  for (const item of input.items) {
    const existing = merged.get(item.variantId);
    if (existing && existing.productId !== item.productId) {
      throw new PopupSaleError(400, "ITEM_NOT_FOUND", "An item in this sale is no longer available.");
    }
    merged.set(item.variantId, existing ? { ...existing, quantity: existing.quantity + item.quantity } : { ...item });
  }

  const lines: PopupLine[] = [];
  for (const item of merged.values()) {
    const [row] = await db.select({
      variantId: productVariants.id,
      priceCents: productVariants.priceCents,
      compareAtPriceCents: productVariants.compareAtPriceCents,
      stock: productVariants.stock,
      size: productVariants.size,
      color: productVariants.color,
      productName: products.name,
      ownerId: products.ownerId,
      status: products.status,
    }).from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(and(eq(productVariants.id, item.variantId), eq(products.id, item.productId), isNull(products.deletedAt)))
      .limit(1);
    // Another seller's product looks exactly like a missing one.
    if (!row || row.ownerId !== input.sellerId) {
      throw new PopupSaleError(404, "ITEM_NOT_FOUND", "An item in this sale is no longer available.");
    }
    if (row.status !== "active") {
      throw new PopupSaleError(400, "ITEM_UNAVAILABLE", `${row.productName} isn't active.`);
    }
    if (row.stock < item.quantity) {
      throw new PopupSaleError(409, "OUT_OF_STOCK", `${row.productName} doesn't have enough stock.`, { variantId: row.variantId, available: Math.max(0, row.stock) });
    }
    const unit = await effectiveUnitPrice({
      productId: item.productId, sellerId: input.sellerId, priceCents: row.priceCents, compareAtPriceCents: row.compareAtPriceCents,
    });
    lines.push({
      variantId: row.variantId,
      productId: item.productId,
      productName: row.productName,
      variantLabel: [row.size, row.color].filter(Boolean).join(" / "),
      quantity: item.quantity,
      priceCents: unit.priceCents,
    });
  }

  // Launch timing, live drops and preorders are enforced exactly as online.
  try {
    const plan = await resolveChargePlan({ productIds: lines.map((line) => line.productId), sellerId: input.sellerId });
    if (plan.chargeModel !== "destination") {
      throw new PopupSaleError(409, "PREORDER_NOT_SUPPORTED", "Preorder items can't be sold in Pop-up mode.");
    }
  } catch (error) {
    if (error instanceof CheckoutPlanError) throw new PopupSaleError(error.status, error.code, error.message);
    throw error;
  }

  const subtotalCents = lines.reduce((sum, line) => sum + line.priceCents * line.quantity, 0);
  if (subtotalCents < POPUP_MIN_CHARGE_CENTS) {
    throw new PopupSaleError(400, "BELOW_MINIMUM", "The total must be at least $0.50.");
  }
  const platformFeeBps = await resolveSellerPlatformFeeBps(input.sellerId);
  const fee = destinationApplicationFeeCents({ shippingCents: 0, merchandiseCents: subtotalCents, preTaxTotalCents: subtotalCents, platformFeeBps });
  return {
    sellerId: input.sellerId,
    lines,
    subtotalCents,
    totalCents: subtotalCents,
    platformFeeCents: fee.platformFeeCents,
    platformFeeBps,
    processingFeeEstimateCents: fee.processingFeeEstimateCents,
  };
}

/** The seller can be paid only through an active connected account. */
export async function assertSellerCanTakePayments(sellerId: string): Promise<void> {
  const [seller] = await db.select({
    stripeAccountId: users.stripeAccountId,
    stripeAccountStatus: users.stripeAccountStatus,
  }).from(users).where(eq(users.clerkId, sellerId)).limit(1);
  if (!seller?.stripeAccountId || seller.stripeAccountStatus !== "active") {
    throw new PopupSaleError(409, "SELLER_PAYMENTS_UNAVAILABLE", "Finish setting up payouts before taking payments.");
  }
}

type PopupIntent = {
  id: string;
  amount?: number;
  amount_received?: number;
  currency?: string;
  status?: string;
  metadata?: Record<string, string> | null;
};

/** Is this PaymentIntent a Pop-up mode sale? */
export function isPopupIntent(pi: PopupIntent | null | undefined): boolean {
  return pi?.metadata?.source === POPUP_SOURCE && pi.metadata?.kind === POPUP_SALE_KIND;
}

type FinalizeOptions = {
  stripe?: Pick<NonNullable<typeof defaultStripe>, "paymentIntents"> | null;
};

export type FinalizeResult =
  | { outcome: "created"; orderId: string }
  | { outcome: "exists"; orderId: string }
  | { outcome: "oversold"; orderId: string }
  | { outcome: "ignored"; reason: string };

/**
 * payment_intent.succeeded for a Pop-up mode sale: creates the order.
 * Idempotent: a redelivered event (or a concurrent one) finds the existing
 * order through the unique stripe_checkout_session_id and does nothing more
 * than retry the seller's transfer.
 */
export async function finalizePopupSale(pi: PopupIntent, paidAt: Date, options: FinalizeOptions = {}): Promise<FinalizeResult> {
  const stripeClient = options.stripe === undefined ? defaultStripe : options.stripe;
  const [csRecord] = await db.select().from(checkoutSessions)
    .where(and(eq(checkoutSessions.stripePaymentIntentId, pi.id), eq(checkoutSessions.source, POPUP_SOURCE)))
    .limit(1);
  if (!csRecord || !csRecord.stripeSessionId) {
    logger.error({ paymentIntentId: pi.id }, "Pop-up payment succeeded without a pending sale record");
    return { outcome: "ignored", reason: "no_record" };
  }
  // The metadata is Stripe-side data; the durable row decides whose sale it is.
  if (pi.metadata?.sellerId && pi.metadata.sellerId !== csRecord.sellerId) {
    logger.error({ paymentIntentId: pi.id, checkoutSessionId: csRecord.id }, "Pop-up payment seller does not match its sale record");
    return { outcome: "ignored", reason: "seller_mismatch" };
  }
  const sessionKey = csRecord.stripeSessionId;

  const [existing] = await db.select({ id: orders.id }).from(orders)
    .where(eq(orders.stripeCheckoutSessionId, sessionKey)).limit(1);
  if (existing) {
    await settleTransferOrder(existing.id).catch((err) => {
      logger.error({ err, orderId: existing.id }, "Pop-up order transfer failed");
    });
    return { outcome: "exists", orderId: existing.id };
  }

  const items = csRecord.items ?? [];
  const subtotalCents = items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
  const totalCents = Number.isInteger(pi.amount_received) && (pi.amount_received as number) > 0
    ? (pi.amount_received as number)
    : csRecord.amountTotalCents ?? subtotalCents;
  if (totalCents !== (csRecord.amountTotalCents ?? subtotalCents)) {
    logger.error({ paymentIntentId: pi.id, received: totalCents, expected: csRecord.amountTotalCents }, "Pop-up payment amount does not match its sale record");
  }
  const sellerId = csRecord.sellerId;
  // Exact Stripe fee and charge id. If Stripe can't be reached the webhook
  // fails and Stripe retries, rather than recording a guess.
  const chargeDetails: ChargeDetails = stripeClient
    ? await fetchChargeDetails(stripeClient, pi.id)
    : { chargeId: null, processingFeeCents: null, transferId: null, applicationFeeId: null };

  let oversold = false;
  let orderId: string | null = null;
  try {
    await db.transaction(async (tx) => {
      // The units were held when the sale was rung up. A still-held
      // reservation becomes this order's stock: no second decrement. An
      // expired (released) one goes through the normal atomic reserve.
      const alreadyReserved = (await commitStockReservation(tx, csRecord.id)) > 0;
      if (!alreadyReserved) {
        const reservation = await reserveStockForOrder(tx, items.map((item) => ({ variantId: item.variantId, quantity: item.quantity })));
        oversold = !reservation.ok;
      }

      const countRes = await tx.execute(sql`SELECT count(*)::int AS c FROM orders WHERE owner_id = ${sellerId}`);
      const count: number = (countRes as any).rows?.[0]?.c ?? 0;
      const orderNumber = `BT-${String(count + 1).padStart(5, "0")}`;

      const [order] = await tx.insert(orders).values({
        ownerId: sellerId,
        buyerId: null,
        orderNumber,
        source: POPUP_SOURCE,
        // Handed over at the table: delivered the moment it is paid.
        status: oversold ? "refund_pending" : "delivered",
        totalCents,
        subtotalCents,
        shippingCents: 0,
        taxCents: 0,
        grossChargedCents: totalCents,
        paidAt,
        discountAmountCents: 0,
        stripePaymentIntentId: pi.id,
        stripeCheckoutSessionId: sessionKey,
        ...(oversold ? {} : {
          deliverBy: paidAt,
          deliveredAt: paidAt,
          // The buyer took it in hand (orders_delivery_confirmed_by_valid
          // allows carrier | buyer; source = 'popup' records it was in person).
          deliveryConfirmedBy: "buyer",
          trackingStatus: "delivered",
          payoutReleaseAt: computePayoutReleaseAt(paidAt),
          fulfillmentPicked: true,
          fulfillmentPacked: true,
        }),
      }).returning();
      orderId = order.id;

      const split = splitOrder({
        subtotalCents,
        discountCents: 0,
        shippingCents: 0,
        taxCents: 0,
        grossCents: totalCents,
        platformFeeBps: csRecord.platformFeeBps,
        processingFeeCents: chargeDetails.processingFeeCents ?? undefined,
      });
      await recordOrderPaid(tx, {
        orderId: order.id,
        sellerId,
        dropId: null,
        chargeModel: "transfer",
        split: {
          ...split,
          platformFeeCents: csRecord.platformFeeCents != null ? Math.min(csRecord.platformFeeCents, totalCents) : split.platformFeeCents,
        },
        charge: chargeDetails,
        paymentIntentId: pi.id,
        occurredAt: paidAt,
      });
      await recordPaidPhysicalOrder({
        ...order,
        ownerId: sellerId,
        totalCents,
        grossChargedCents: totalCents,
        taxCents: 0,
        shippingCents: 0,
        stripePaymentIntentId: pi.id,
        stripeCheckoutSessionId: sessionKey,
        paidAt,
        paidAtSource: "stripe_event",
      }, tx);

      await tx.insert(orderItems).values(items.map((item) => ({
        orderId: order.id,
        variantId: item.variantId,
        productName: item.productName,
        variantLabel: item.variantLabel || null,
        quantity: item.quantity,
        priceCents: item.priceCents,
        ...(oversold ? {} : { deliveredAt: paidAt, trackingStatus: "delivered" }),
      })));

      if (!oversold) await lowStockAlerts(tx, items.map((item) => item.variantId));
    });
  } catch (error: any) {
    // A concurrent delivery of the same event won the unique key.
    if (error?.code === "23505" || error?.cause?.code === "23505") {
      const [winner] = await db.select({ id: orders.id }).from(orders)
        .where(eq(orders.stripeCheckoutSessionId, sessionKey)).limit(1);
      if (winner) return { outcome: "exists", orderId: winner.id };
    }
    throw error;
  }

  if (!orderId) return { outcome: "ignored", reason: "not_created" };
  const createdId: string = orderId;
  if (oversold) {
    logger.error({ paymentIntentId: pi.id, orderId: createdId }, "Pop-up sale oversold after payment; refunding");
    try {
      await refundOrder({
        orderId: createdId,
        reason: "oversold",
        initiatedBy: "system:popup-webhook",
        idempotencyKey: `oversold/${createdId}`,
        cancelOrder: { reason: "out_of_stock", notes: "An item sold out before this pop-up payment finished, so it was refunded.", restock: false },
      });
    } catch (err) {
      logger.error({ err, orderId: createdId }, "Automatic refund for an oversold pop-up sale failed; order stays refund_pending");
    }
    return { outcome: "oversold", orderId: createdId };
  }

  await settleTransferOrder(createdId).catch((err) => {
    logger.error({ err, orderId: createdId }, "Pop-up order transfer failed; the money sweep retries it");
  });
  logger.info({ orderId: createdId, sellerId }, "Pop-up sale recorded");
  return { outcome: "created", orderId: createdId };
}

/** The intent was cancelled (seller backed out or it expired): give the stock back. */
export async function releasePopupSale(pi: PopupIntent): Promise<number> {
  const rows = await db.select({ id: checkoutSessions.id }).from(checkoutSessions)
    .where(and(eq(checkoutSessions.stripePaymentIntentId, pi.id), eq(checkoutSessions.source, POPUP_SOURCE)));
  let released = 0;
  for (const row of rows) released += await db.transaction((tx) => releaseStockReservation(tx, row.id));
  return released;
}

/** Same low-stock alert as online orders, each in its own savepoint. */
async function lowStockAlerts(tx: any, variantIds: string[]): Promise<void> {
  for (const variantId of new Set(variantIds)) {
    try {
      await tx.transaction(async (sp: any) => {
        const [variant] = await sp.select({
          stock: productVariants.stock,
          lowStockThreshold: productVariants.lowStockThreshold,
          productName: products.name,
          ownerId: products.ownerId,
        }).from(productVariants)
          .innerJoin(products, eq(products.id, productVariants.productId))
          .where(eq(productVariants.id, variantId))
          .limit(1);
        if (!variant || variant.lowStockThreshold === null || variant.lowStockThreshold <= 0) return;
        if (variant.stock < 0 || variant.stock > variant.lowStockThreshold) return;
        const isZero = variant.stock === 0;
        await sp.insert(notificationsFeed).values({
          id: crypto.randomUUID(),
          userId: variant.ownerId,
          type: isZero ? "out_of_stock" : "low_stock",
          title: isZero ? "Out of stock" : "Low stock alert",
          body: isZero ? `${variant.productName} is now out of stock.` : `${variant.productName} has only ${variant.stock} units left.`,
          targetId: variantId,
          targetType: "variant",
          isRead: false,
          createdAt: new Date(),
        }).onConflictDoNothing();
      });
    } catch {
      // Non-critical: never fail the sale over an alert.
    }
  }
}
