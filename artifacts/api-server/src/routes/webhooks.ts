/**
 * Stripe webhook handler — raw body required for signature verification.
 * Mounted at /api/webhooks (before express.json() middleware).
 */
import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import type Stripe from "stripe";
import {
  db, checkoutSessions, orders, orderItems, productVariants, products, users, notificationsFeed, disputes,
  dropWallets, dropWalletTransactions, freelancers, freelancerJobs,
  revenueCatWebhookEvents, manufacturers, sampleOrders, manufacturerActivityEvents,
  stripeTrialWarningEvents,
} from "@workspace/db";
import { eq, and, ne, sql } from "drizzle-orm";
import { stripe, STRIPE_WEBHOOK_SECRET } from "../lib/stripe";
import { refundJobPayment } from "../lib/freelancerEscrow";
import { logger } from "../lib/logger";
import { reconcileRevenueCatEntitlement } from "../lib/nativeEntitlements";
import {
  awardLoyaltyPointsOnce,
  consumeLoyaltyRedemption,
  releaseLoyaltyRedemption,
} from "./loyalty";
import {
  isOrderConfirmationEligibleStatus,
  sendOrderConfirmationEmail,
} from "../lib/brandthreadEmail";
import { publishNotification } from "./notifications-feed";
import { sendPushToUser, stableNotificationId } from "../lib/push";
import { connectReadiness } from "./manufacturer-connect";
import { recordPaidPhysicalOrder } from "../lib/sellerTaxLedger";
import {
  claimStripeWebhookEvent,
  completeStripeWebhookEvent,
  failStripeWebhookEvent,
  renewStripeWebhookLease,
  STRIPE_WEBHOOK_HEARTBEAT_MS,
  waitForStripeWebhookOutcome,
  type StripeWebhookClaim,
} from "../lib/stripeWebhookLedger";
import { sellerPlanFromStripeLookupKey } from "../lib/stripePlanMapping";

const router = Router();

function stripeReferenceId(reference: string | { id: string } | null | undefined): string | null {
  return typeof reference === "string" ? reference : reference?.id ?? null;
}

function authorizationMatches(actual: string | undefined, expected: string): boolean {
  const candidates = [expected, `Bearer ${expected}`];
  return candidates.some((candidate) => {
    const left = Buffer.from(actual ?? "");
    const right = Buffer.from(candidate);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  });
}

async function sendOrderConfirmationForOrder(orderId: string): Promise<boolean> {
  const [order] = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      guestEmail: orders.guestEmail,
      buyerEmail: users.email,
      subtotalCents: orders.subtotalCents,
      shippingCents: orders.shippingCents,
      totalCents: orders.totalCents,
      status: orders.status,
    })
    .from(orders)
    .leftJoin(users, eq(users.clerkId, orders.buyerId))
    .where(eq(orders.id, orderId))
    .limit(1);

  const recipient = order?.buyerEmail ?? order?.guestEmail;
  if (!order || !recipient) {
    logger.warn({ orderId }, "Order confirmation email skipped because recipient is missing");
    return false;
  }
  if (!isOrderConfirmationEligibleStatus(order.status)) {
    logger.info(
      { orderId, status: order.status },
      "Order confirmation email skipped because order is not fulfillment eligible",
    );
    return false;
  }

  const items = await db
    .select({
      productName: orderItems.productName,
      variantLabel: orderItems.variantLabel,
      quantity: orderItems.quantity,
      priceCents: orderItems.priceCents,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  return sendOrderConfirmationEmail({
    to: recipient,
    orderNumber: order.orderNumber,
    items,
    subtotalCents: order.subtotalCents,
    shippingCents: order.shippingCents,
    totalCents: order.totalCents,
    idempotencyKey: `order-confirmation/${order.id}`,
  });
}

// POST /api/webhooks/stripe — raw body, no Clerk auth
router.post("/stripe", async (req: Request, res: Response) => {
  if (!stripe) {
    res.status(503).json({ error: "Stripe not configured" });
    return;
  }

  const sig = req.headers["stripe-signature"];
  if (!sig || !STRIPE_WEBHOOK_SECRET) {
    res.status(400).json({ error: "Missing stripe-signature or webhook secret" });
    return;
  }

  let event: any;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    req.log.error({ err }, "Stripe webhook signature verification failed");
    res.status(400).json({ error: `Webhook error: ${err.message}` });
    return;
  }

  if (
    !event ||
    typeof event.id !== "string" ||
    event.id.length < 1 ||
    event.id.length > 255 ||
    typeof event.type !== "string" ||
    event.type.length < 1 ||
    event.type.length > 255 ||
    !event.data ||
    typeof event.data !== "object" ||
    !("object" in event.data)
  ) {
    res.status(400).json({
      error: "Invalid Stripe event",
      code: "VALIDATION_ERROR",
    });
    return;
  }

  let claim: StripeWebhookClaim | undefined;
  let leaseHeartbeat: ReturnType<typeof setInterval> | undefined;
  try {
    claim = await claimStripeWebhookEvent(event.id, event.type);
    if (!claim.claimed) {
      if (claim.reason === "processed") {
        res.json({ received: true, duplicate: true });
        return;
      }
      const outcome = await waitForStripeWebhookOutcome(event.id);
      if (outcome === "processed") {
        res.json({ received: true, duplicate: true });
        return;
      }
      res.status(503).json({
        error: "Webhook event is still processing",
        code: "WEBHOOK_IN_FLIGHT",
      });
      return;
    }
    const attemptCount = claim.attemptCount;
    leaseHeartbeat = setInterval(() => {
      void renewStripeWebhookLease(event.id, attemptCount)
        .then((renewed) => {
          if (!renewed) {
            req.log.error(
              { eventId: event.id, attemptCount },
              "Stripe webhook lease ownership was lost",
            );
          }
        })
        .catch((err) => {
          req.log.error(
            { err, eventId: event.id, attemptCount },
            "Stripe webhook lease renewal failed",
          );
        });
    }, STRIPE_WEBHOOK_HEARTBEAT_MS);
    leaseHeartbeat.unref?.();

    switch (event.type) {
      // Synchronous payment (cards, wallets) — already captured at session completion
      case "checkout.session.completed":
        if (event.data.object.payment_status === "paid") {
          await handleCheckoutPaid(event.data.object, event.id, new Date(event.created * 1000));
        }
        // payment_status === 'unpaid' means async method chosen → wait for below
        break;

      // Delayed payment method (ACH bank debit, etc.) captured successfully
      case "checkout.session.async_payment_succeeded":
        await handleCheckoutPaid(event.data.object, event.id, new Date(event.created * 1000));
        break;

      // Delayed payment failed — release any unused rewards reservation.
      case "checkout.session.async_payment_failed":
      case "checkout.session.expired":
        await releaseCheckoutLoyaltyRedemption(event.data.object);
        break;

      case "account.updated":
        await handleAccountUpdated(event.data.object, event.id);
        break;
      case "transfer.created":
      case "transfer.updated":
        await handleManufacturerTransfer(event.data.object, event.id);
        break;
      case "transfer.reversed":
        await handleManufacturerTransferReversed(event.data.object, event.id);
        break;
      case "charge.refunded":
        await handleManufacturerCardReversal({
          paymentIntentId: stripeReferenceId(event.data.object.payment_intent),
          chargeId: event.data.object.id ?? null,
          cumulativeReversedCents: event.data.object.amount_refunded,
          providerEventId: event.id,
          source: "refund",
        });
        break;

      // ── Seller platform subscription (billed to seller's own payment method) ──
      // These events are completely separate from buyer checkout and Connect.
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event.data.object);
        break;

      case "customer.subscription.trial_will_end":
        await handleSubscriptionTrialWillEnd(event.data.object, event.id);
        break;

      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(event.data.object);
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object);
        break;

      // ── Stripe Identity — seller ID verification ───────────────────────────
      case "identity.verification_session.verified":
        await handleIdentityVerified(event.data.object);
        break;

      case "identity.verification_session.requires_input":
        await handleIdentityFailed(event.data.object);
        break;

      case "identity.verification_session.processing":
        // Status already set to 'pending' when the session was created.
        // No DB update needed — the verified/requires_input event follows.
        break;

      // ── Stripe Disputes / Chargebacks ─────────────────────────────────────
      case "charge.dispute.created":
        if (!await handleManufacturerCardReversal({
          paymentIntentId: stripeReferenceId(event.data.object.payment_intent),
          chargeId: stripeReferenceId(event.data.object.charge),
          cumulativeReversedCents: event.data.object.amount,
          providerEventId: event.id,
          source: "dispute",
        })) await handleDisputeCreated(event.data.object);
        break;

      case "charge.dispute.updated":
        if (!await isManufacturerCardPayment(
          stripeReferenceId(event.data.object.payment_intent),
          stripeReferenceId(event.data.object.charge),
        )) {
          await handleDisputeUpdated(event.data.object);
        }
        break;

      case "charge.dispute.closed":
        if (!await isManufacturerCardPayment(
          stripeReferenceId(event.data.object.payment_intent),
          stripeReferenceId(event.data.object.charge),
        )) {
          await handleDisputeClosed(event.data.object);
        }
        break;

      default:
        break;
    }

    clearInterval(leaseHeartbeat);
    leaseHeartbeat = undefined;
    await completeStripeWebhookEvent(event.id, claim.attemptCount);
    res.json({ received: true });
  } catch (err) {
    if (leaseHeartbeat) clearInterval(leaseHeartbeat);
    if (claim?.claimed) {
      await failStripeWebhookEvent(event.id, claim.attemptCount, err).catch((ledgerErr) => {
        req.log.error({ err: ledgerErr, eventId: event.id }, "Could not release failed Stripe webhook event");
      });
    }
    req.log.error({ err, eventType: event.type, eventId: event.id }, "Stripe webhook handler failed");
    res.status(500).json({ error: "Webhook handler failed" });
  }
});

// POST /api/webhooks/revenuecat — provider authorization plus a durable event ledger.
router.post("/revenuecat", async (req: Request, res: Response): Promise<void> => {
  const expectedAuthorization = process.env.REVENUECAT_WEBHOOK_AUTHORIZATION
    ?? (process.env.SESSION_SECRET ? `Bearer ${process.env.SESSION_SECRET}` : undefined);
  const authorization = req.header("authorization");
  if (expectedAuthorization) {
    if (!authorizationMatches(authorization, expectedAuthorization)) {
      req.log.warn("RevenueCat webhook authorization failed");
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  } else if (process.env.NODE_ENV === "production") {
    req.log.error("RevenueCat webhook rejected: authorization secret is not configured");
    res.status(503).json({ error: "RevenueCat webhook authorization is not configured" });
    return;
  } else {
    req.log.warn("RevenueCat webhook accepted without authorization in development");
  }

  const event = req.body?.event ?? req.body;
  const eventId = typeof event?.id === "string" ? event.id : null;
  const appUserId = typeof event?.app_user_id === "string" ? event.app_user_id : null;
  if (!eventId || !appUserId) {
    res.status(400).json({ error: "RevenueCat event id and app_user_id are required" });
    return;
  }
  const occurredAt = typeof event.event_timestamp_ms === "number"
    ? new Date(event.event_timestamp_ms)
    : typeof event.event_timestamp === "number" ? new Date(event.event_timestamp * 1000) : null;

  try {
    const [recorded] = await db.insert(revenueCatWebhookEvents).values({
      eventId, appUserId, eventType: typeof event.type === "string" ? event.type : null, occurredAt,
    }).onConflictDoNothing().returning({ id: revenueCatWebhookEvents.id });
    if (!recorded) {
      res.json({ received: true, duplicate: true });
      return;
    }
    // Reconciliation reads the current provider state, so stale/out-of-order
    // webhook payloads cannot overwrite a newer entitlement.
    await reconcileRevenueCatEntitlement(appUserId);
    res.json({ received: true });
  } catch (err) {
    // Do not permanently suppress a provider retry when the live lookup was
    // unavailable. Successfully reconciled events remain in the ledger.
    await db.delete(revenueCatWebhookEvents).where(eq(revenueCatWebhookEvents.eventId, eventId)).catch((deleteErr) => {
      req.log.error({ err: deleteErr, eventId }, "Could not release failed RevenueCat webhook event");
    });
    req.log.error({ err, eventId, appUserId }, "RevenueCat webhook reconciliation failed");
    res.status(500).json({ error: "RevenueCat webhook handler failed" });
  }
});

/** Allow an unused rewards token to be attached to a replacement checkout. */
async function releaseCheckoutLoyaltyRedemption(session: any) {
  const csRef = session.metadata?.["csRef"];
  const [checkout] = await db
    .select({
      id: checkoutSessions.id,
      buyerId: checkoutSessions.buyerId,
      loyaltyToken: checkoutSessions.loyaltyToken,
    })
    .from(checkoutSessions)
    .where(csRef
      ? eq(checkoutSessions.id, csRef)
      : eq(checkoutSessions.stripeSessionId, session.id))
    .limit(1);

  if (!checkout?.loyaltyToken || !checkout.buyerId) return;
  await db.transaction((tx) => releaseLoyaltyRedemption(
    tx,
    checkout.buyerId!,
    checkout.loyaltyToken!,
    checkout.id,
  ));
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

/**
 * Creates an order for a confirmed, paid Checkout Session.
 *
 * Cart is read from the checkout_sessions DB record (keyed by csRef in
 * metadata) — no per-field Stripe metadata keys, no 50-key limit.
 *
 * Stock is handled all-or-nothing:
 *   1. Aggregate quantities by variantId (guards against duplicate lines
 *      that could each pass individual stock checks).
 *   2. Lock all variant rows with SELECT FOR UPDATE in deterministic
 *      (sorted) order to prevent deadlocks on concurrent checkouts.
 *   3. Verify every aggregated line has sufficient stock.
 *   3a. ALL pass → decrement all and create order with status "pending".
 *   3b. ANY fail → create order with status "refund_pending", decrement
 *       NOTHING (no inventory lost for a refunded order).
 *   4. Stripe refund is issued outside the transaction so the order record
 *      is always committed (visible for audit/manual review).
 *
 * The unique index on stripe_checkout_session_id plus the early-exit guard
 * ensure at-most-once order creation even on webhook retries.
 */
export async function handleCheckoutPaid(
  session: any,
  providerEventId?: string,
  successfulPaymentAt: Date = new Date(),
) {
  const sessionId: string   = session.id;
  const piId:      string | null = session.payment_intent ?? null;
  const metadata:  Record<string, string> = session.metadata ?? {};
  const csRef:     string | undefined = metadata["csRef"];

  if (await handleManufacturerCheckoutPaid(session, providerEventId)) return;

  // Freelancer job escrow payments are a separate flow from cart orders.
  // Fast path: session metadata (set at session creation). Fallback: match by
  // the session id persisted on the job row at creation — dispatch works even
  // for a session whose metadata is missing or stripped.
  if (metadata["freelancerJobId"]) {
    await handleFreelancerJobPaid(session, metadata["freelancerJobId"]);
    return;
  }
  const [freelancerJobBySession] = await db
    .select({ id: freelancerJobs.id })
    .from(freelancerJobs)
    .where(eq(freelancerJobs.stripeCheckoutSessionId, sessionId))
    .limit(1);
  if (freelancerJobBySession) {
    await handleFreelancerJobPaid(session, freelancerJobBySession.id);
    return;
  }

  // ── Fast-path idempotency check (unique DB index is the hard guarantee) ──
  const [existing] = await db
    .select({
      id: orders.id,
      buyerId: orders.buyerId,
      ownerId: orders.ownerId,
      totalCents: orders.totalCents,
      grossChargedCents: orders.grossChargedCents,
      taxCents: orders.taxCents,
      shippingCents: orders.shippingCents,
      stripePaymentIntentId: orders.stripePaymentIntentId,
      stripeCheckoutSessionId: orders.stripeCheckoutSessionId,
      paidAt: orders.paidAt,
      createdAt: orders.createdAt,
      status: orders.status,
    })
    .from(orders)
    .where(eq(orders.stripeCheckoutSessionId, sessionId))
    .limit(1);
  if (existing) {
    await recordPaidPhysicalOrder(existing);
    await awardPurchasePoints(existing);
    try {
      await sendOrderConfirmationForOrder(existing.id);
    } catch (err) {
      logger.error({ err, orderId: existing.id }, "Order confirmation email delivery failed");
    }
    logger.info({ stripeSessionId: sessionId, orderId: existing.id }, "Order already exists for checkout session; skipping");
    return;
  }

  // ── Load cart from server-side record ────────────────────────────────────
  let csRecord: (typeof checkoutSessions.$inferSelect) | undefined;
  if (csRef) {
    [csRecord] = await db
      .select()
      .from(checkoutSessions)
      .where(eq(checkoutSessions.id, csRef))
      .limit(1);
  }
  // Fallback: also try lookup by stripe session id (back-filled by buyer route)
  if (!csRecord) {
    [csRecord] = await db
      .select()
      .from(checkoutSessions)
      .where(eq(checkoutSessions.stripeSessionId, sessionId))
      .limit(1);
  }
  if (!csRecord) {
    logger.error({ stripeSessionId: sessionId }, "Checkout paid without a server-side cart record");
    return;
  }
  // Do not use client_reference_id as an identity assertion: it is absent for
  // guests and is Stripe-side mutable data. The durable cart row is authoritative.
  if (csRecord.stripeSessionId && csRecord.stripeSessionId !== sessionId) {
    logger.error({ stripeSessionId: sessionId, checkoutSessionId: csRecord.id }, "Stripe session does not match checkout record");
    return;
  }
  const buyerId = csRecord.buyerId;
  const guestEmail = buyerId ? null : csRecord.guestEmail;
  if (!buyerId && !guestEmail) {
    logger.error({ checkoutSessionId: csRecord.id }, "Checkout record has no buyer or guest identity");
    return;
  }

  type CartItem = {
    variantId:    string;
    productName:  string;
    variantLabel: string;
    quantity:     number;
    priceCents:   number;
  };

  const rawItems = csRecord.items as CartItem[];
  const ownerId  = csRecord.sellerId;

  // ── Aggregate quantities by variantId (all-or-nothing requires per-variant totals)
  // Even if buyer.ts rejected duplicates, aggregate here as a safety net.
  const aggregated = new Map<string, CartItem>();
  for (const item of rawItems) {
    const existing = aggregated.get(item.variantId);
    if (existing) {
      aggregated.set(item.variantId, { ...existing, quantity: existing.quantity + item.quantity });
    } else {
      aggregated.set(item.variantId, { ...item });
    }
  }
  const cartItems = [...aggregated.values()];

  const subtotalCents = cartItems.reduce((s, i) => s + i.priceCents * i.quantity, 0);
  // Use Stripe's authoritative charged total; fall back to computed subtotal if absent.
  // This ensures the stored order total always matches the amount Stripe captured.
  const totalCents    = typeof session.amount_total === "number" ? session.amount_total : subtotalCents;
  const totalDetails = session.total_details ?? {};
  const loyaltyDiscountCents = Math.max(0, csRecord.loyaltyDiscountCents ?? 0);
  const taxCents = Number.isInteger(totalDetails.amount_tax)
    ? Math.max(0, totalDetails.amount_tax)
    : 0;
  const stripeDiscountCents = Number.isInteger(totalDetails.amount_discount)
    ? Math.max(0, totalDetails.amount_discount)
    : loyaltyDiscountCents;
  // Derive shipping from the pre-discount total. A loyalty discount otherwise
  // makes shipping look like zero (or negative) in the persisted order.
  const shippingCents = Number.isInteger(totalDetails.amount_shipping)
    ? Math.max(0, totalDetails.amount_shipping)
    : Math.max(0, totalCents + stripeDiscountCents - subtotalCents - taxCents);

  // Stripe's final Checkout destination is authoritative because it is the
  // address used for automatic tax. Fall back to the pre-Checkout snapshot
  // only for legacy sessions where Stripe did not return shipping details.
  let shippingAddress: { name?: string; street: string; line2?: string | null; city: string; state: string; zip: string; country: string } | undefined;
  const shipDetails = session.shipping_details;
  if (shipDetails?.address) {
    shippingAddress = {
      name:    shipDetails.name ?? undefined,
      street:  shipDetails.address.line1 ?? "",
      line2:   shipDetails.address.line2 ?? null,
      city:    shipDetails.address.city ?? "",
      state:   shipDetails.address.state ?? "",
      zip:     shipDetails.address.postal_code ?? "",
      country: shipDetails.address.country ?? "US",
    };
  } else if (csRecord.shippingAddress && (csRecord.shippingAddress as any).street) {
    const sa = csRecord.shippingAddress as any;
    shippingAddress = {
      name:    sa.name    ?? undefined,
      street:  sa.street,
      line2:   sa.line2 ?? null,
      city:    sa.city,
      state:   sa.state,
      zip:     sa.zip,
      country: sa.country ?? "US",
    };
  }

  // ── All-or-nothing stock reservation inside transaction ───────────────────
  let oversoldItems: string[] = [];
  let createdOrderId: string | null = null;

  await db.transaction(async (tx) => {
    // Step 1: Lock all variant rows in deterministic order (prevents deadlocks)
    const sortedItems = [...cartItems].sort((a, b) =>
      a.variantId.localeCompare(b.variantId),
    );
    const stockMap = new Map<string, number>();
    for (const item of sortedItems) {
      const result = await tx.execute(
        sql`SELECT stock FROM product_variants WHERE id = ${item.variantId}::uuid FOR UPDATE`,
      );
      const rows = (result as any).rows ?? [];
      stockMap.set(item.variantId, rows[0]?.stock ?? 0);
    }

    // Step 2: Check ALL aggregated quantities against locked stock
    for (const item of cartItems) {
      const available = stockMap.get(item.variantId) ?? 0;
      if (available < item.quantity) {
        oversoldItems.push(item.productName);
      }
    }

    // Step 3: Generate order number
    const countRes = await tx.execute(
      sql`SELECT count(*)::int AS c FROM orders WHERE owner_id = ${ownerId}`,
    );
    const count: number = (countRes as any).rows?.[0]?.c ?? 0;
    const orderNumber   = `BT-${String(count + 1).padStart(5, "0")}`;

    // Step 4: Insert order — pending if stock OK, refund_pending if oversold
    const dropId: string | undefined = metadata["dropId"];
    const [order] = await tx
      .insert(orders)
      .values({
        ownerId,
        buyerId: buyerId ?? null,
        ...(guestEmail ? { guestEmail } : {}),
        orderNumber,
        status:                  oversoldItems.length > 0 ? "refund_pending" : "pending",
        totalCents,
        subtotalCents,
        shippingCents,
        taxCents,
        grossChargedCents: totalCents,
        paidAt: successfulPaymentAt,
        discountAmountCents: stripeDiscountCents,
        stripePaymentIntentId:   piId,
        stripeCheckoutSessionId: sessionId,
        ...(shippingAddress && { shippingAddress }),
        ...(dropId ? { dropId } : {}),
      })
      .returning();
    createdOrderId = order.id;

    await recordPaidPhysicalOrder({
      ...order,
      ownerId,
      totalCents,
      grossChargedCents: totalCents,
      taxCents,
      shippingCents,
      stripePaymentIntentId: piId,
      stripeCheckoutSessionId: sessionId,
      paidAt: successfulPaymentAt,
      paidAtSource: "stripe_event",
    }, tx);

    // A redemption is consumed only once a paid session has produced a valid
    // order. This transaction boundary means a webhook retry cannot spend the
    // same token twice.
    if (csRecord.loyaltyToken && buyerId) {
      if (oversoldItems.length === 0) {
        await consumeLoyaltyRedemption(
          tx,
          buyerId,
          csRecord.loyaltyToken,
          csRecord.id,
          order.id,
        );
      } else {
        // The payment is refunded below; keep the buyer's existing redemption
        // token available for a replacement order.
        await releaseLoyaltyRedemption(
          tx,
          buyerId,
          csRecord.loyaltyToken,
          csRecord.id,
        );
      }
    }

    // Record the purchase reward in the same transaction as the confirmed
    // order. A cancellation cannot land between the order commit and award.
    if (oversoldItems.length === 0) {
      await awardPurchasePoints(order, tx);
    }

    // Step 5: Insert order items (from original cart, not aggregated map, to preserve line detail)
    await tx.insert(orderItems).values(
      rawItems.map((item) => ({
        orderId:      order.id,
        variantId:    item.variantId,
        productName:  item.productName,
        variantLabel: item.variantLabel || null,
        quantity:     item.quantity,
        priceCents:   item.priceCents,
      })),
    );

    // Step 6: Decrement stock ONLY if every aggregated line passed (all-or-nothing)
    if (oversoldItems.length === 0) {
      for (const item of cartItems) {
        await tx.execute(
          sql`UPDATE product_variants SET stock = stock - ${item.quantity} WHERE id = ${item.variantId}::uuid`,
        );
      }
    }
    // If oversold: zero decrements committed — inventory stays intact.
    // Stripe refund is issued outside this transaction.

    // ── Low-stock notifications ───────────────────────────────────────────────────
    // For each decremented variant, check if stock fell below threshold
    if (oversoldItems.length === 0) {
      for (const item of cartItems) {
        if (!item.variantId) continue;
        try {
          const [variant] = await tx
            .select({
              stock: productVariants.stock,
              lowStockThreshold: productVariants.lowStockThreshold,
              productName: products.name,
              ownerId: products.ownerId,
            })
            .from(productVariants)
            .innerJoin(products, eq(products.id, productVariants.productId))
            .where(eq(productVariants.id, item.variantId as any))
            .limit(1);

          if (
            variant &&
            variant.lowStockThreshold !== null &&
            variant.lowStockThreshold > 0 &&
            variant.stock >= 0 &&
            variant.stock <= variant.lowStockThreshold
          ) {
            const isZero = variant.stock === 0;
            await tx.insert(notificationsFeed).values({
              id: crypto.randomUUID(),
              userId: variant.ownerId,
              type: isZero ? 'out_of_stock' : 'low_stock',
              title: isZero ? 'Out of stock' : 'Low stock alert',
              body: isZero
                ? `${variant.productName} is now out of stock.`
                : `${variant.productName} has only ${variant.stock} units left.`,
              targetId: item.variantId,
              targetType: 'variant',
              isRead: false,
              createdAt: new Date(),
            });
          }
        } catch {
          // Non-critical — don't fail the order over a notification error
        }
      }
    }
  });

  // ── Issue Stripe refund for oversold orders ───────────────────────────────
  if (oversoldItems.length > 0) {
    logger.error(
      { stripeSessionId: sessionId, itemCount: oversoldItems.length },
      "Oversold order after payment; issuing refund",
    );
    if (piId && stripe) {
      try {
        await stripe.refunds.create({
          payment_intent: piId,
          metadata: {
            reason:         "oversold",
            oversold_items: oversoldItems.join(", "),
            session_id:     sessionId,
          },
        });
        logger.info({ paymentIntentId: piId, stripeSessionId: sessionId }, "Automatic refund issued for oversold order");
      } catch (refundErr) {
        // Refund failed — order remains "refund_pending" for manual review
        logger.error({ err: refundErr, paymentIntentId: piId, stripeSessionId: sessionId }, "Automatic refund for oversold order failed");
      }
    }
  } else {
    logger.info({ orderId: createdOrderId, buyerId: buyerId ?? undefined, isGuest: !buyerId, stripeSessionId: sessionId }, "Order created from paid checkout");

    if (createdOrderId) {
      const [createdOrder] = await db
        .select({
          ownerId: orders.ownerId,
          orderNumber: orders.orderNumber,
          totalCents: orders.totalCents,
        })
        .from(orders)
        .where(eq(orders.id, createdOrderId))
        .limit(1);

      if (createdOrder) {
        try {
          await publishNotification({
            userId: createdOrder.ownerId,
            category: "orders",
            type: "new_order_received",
            title: "New order! 🛍️",
            body: `Order #${createdOrder.orderNumber} for $${(createdOrder.totalCents / 100).toFixed(2)} is ready to review.`,
            targetId: createdOrderId,
            targetType: "order",
            pushSound: "order-received.wav",
            pushChannelId: "orders",
          });
        } catch (err) {
          // The order is committed even if notification delivery is unavailable.
          logger.error({ err, orderId: createdOrderId }, "New order notification delivery failed");
        }
      }

      try {
        await sendOrderConfirmationForOrder(createdOrderId);
      } catch (err) {
        logger.error({ err, orderId: createdOrderId }, "Order confirmation email delivery failed");
      }
    }

    // ── Auto-credit drop wallet (Fix #1) ───────────────────────────────────
    // If this order is part of a drop, credit the drop's escrow wallet so
    // the per-order release-order endpoint has funds to transfer at ship time.
    const dropId: string | undefined = metadata["dropId"];
    if (dropId && createdOrderId) {
      try {
        await creditDropWallet(dropId, createdOrderId, subtotalCents, piId);
      } catch (walletErr) {
        // Non-fatal — log for manual recovery; order record is committed
        logger.error({ err: walletErr, orderId: createdOrderId, dropId }, "Auto-crediting drop wallet failed");
      }
    }
  }
}

/**
 * Paid Checkout Sessions are the confirmation point for buyer purchases.
 * A retry can arrive after the order transaction committed, so this helper is
 * also called for an existing order before the webhook exits.
 */
async function awardPurchasePoints(order: {
  id: string;
  buyerId: string | null;
  totalCents: number;
  status: string;
}, transaction?: any): Promise<void> {
  if (
    !order.buyerId ||
    order.status === "refund_pending" ||
    order.status === "cancelled"
  ) {
    return;
  }

  const points = Math.floor(order.totalCents / 100);
  if (points < 1) {
    return;
  }

  await awardLoyaltyPointsOnce({
    buyerId: order.buyerId,
    points,
    source: "order_earn",
    referenceId: order.id,
    note: `Purchase reward for order ${order.id}`,
  }, transaction);
}

// ── Drop wallet auto-credit helper ──────────────────────────────────────────
// Uses SELECT FOR UPDATE to prevent concurrent duplicate deposits.
async function creditDropWallet(
  dropId: string,
  orderId: string,
  amountCents: number,
  stripePaymentIntentId: string | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    // Lock wallet row — prevents concurrent deposits from double-crediting
    const lockResult = await tx.execute(
      sql`SELECT id, balance_cents FROM drop_wallets WHERE drop_id = ${dropId}::uuid FOR UPDATE LIMIT 1`,
    );
    const walletRow = (lockResult as any).rows?.[0];
    if (!walletRow) {
      logger.warn({ dropId, orderId }, "Drop wallet not found for auto-credit");
      return;
    }

    // Idempotency guard — skip if this order was already deposited
    const already = await tx.execute(
      sql`SELECT id FROM drop_wallet_transactions WHERE wallet_id = ${walletRow.id}::uuid AND order_id = ${orderId}::uuid AND type = 'deposit' LIMIT 1`,
    );
    if ((already as any).rows?.length > 0) {
      logger.info({ orderId, dropId }, "Drop wallet was already credited for order; skipping");
      return;
    }

    // Atomic balance increment (avoids read-modify-write race)
    await tx.execute(
      sql`UPDATE drop_wallets SET balance_cents = balance_cents + ${amountCents}, updated_at = NOW() WHERE id = ${walletRow.id}::uuid`,
    );

    await tx.insert(dropWalletTransactions).values({
      walletId:         walletRow.id as string,
      type:             "deposit",
      amountCents,
      orderId,
      description:      "Buyer order payment (auto-credited on checkout.session.completed)",
      stripeTransferId: stripePaymentIntentId ?? undefined,
    });
  });
}

// ── Seller subscription handlers ────────────────────────────────────────────

/**
 * Handles customer.subscription.created and customer.subscription.updated.
 * Looks up the seller by stripeCustomerId and syncs their subscription status.
 */
async function handleSubscriptionUpdated(sub: any) {
  const customerId: string =
    typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (!customerId) {
    logger.warn({ subscriptionId: sub.id }, "Subscription update missing customer ID");
    return;
  }

  // Determine plan from the price lookup_key on the first subscription item
  const lookupKey: string | undefined = sub.items?.data?.[0]?.price?.lookup_key;
  // Unknown or absent keys intentionally do not overwrite the persisted plan.
  const planId = sellerPlanFromStripeLookupKey(lookupKey);

  const periodEnd: Date | null = sub.current_period_end
    ? new Date(sub.current_period_end * 1000)
    : null;

  await db.update(users).set({
    subscriptionId:     sub.id,
    subscriptionStatus: sub.status,
    ...(planId    ? { subscriptionPlanId:     planId    } : {}),
    ...(periodEnd ? { subscriptionPeriodEnd:  periodEnd } : {}),
    updatedAt: new Date(),
  }).where(eq(users.stripeCustomerId, customerId));

  logger.info(
    { subscriptionId: sub.id, customerId, subscriptionStatus: sub.status, planId },
    "Subscription updated",
  );
}

/**
 * Warns a seller before Stripe converts their free trial into a paid
 * subscription. Push delivery is optional: sendPushToUser silently returns
 * when the seller has no registered device token.
 */
export async function handleSubscriptionTrialWillEnd(sub: any, eventId: string): Promise<void> {
  const customerId: string =
    typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (!customerId) {
    logger.warn({ subscriptionId: sub.id }, "Trial-ending event missing customer ID");
    return;
  }

  const [seller] = await db
    .select({ clerkId: users.clerkId })
    .from(users)
    .where(eq(users.stripeCustomerId, customerId))
    .limit(1);
  if (!seller) {
    logger.warn(
      { subscriptionId: sub.id, customerId },
      "Trial-ending event received for an unknown seller",
    );
    return;
  }

  const trialEndUnix = typeof sub.trial_end === "number" ? sub.trial_end : null;
  if (!trialEndUnix) {
    logger.warn(
      { subscriptionId: sub.id, customerId },
      "Trial-ending event missing trial end date",
    );
    return;
  }

  const amountCents = (sub.items?.data ?? []).reduce((total: number, item: any) => {
    const unitAmount = item.price?.unit_amount;
    if (typeof unitAmount !== "number") return total;
    const quantity = typeof item.quantity === "number" ? item.quantity : 1;
    return total + unitAmount * quantity;
  }, 0);
  const amount = `$${(amountCents / 100).toFixed(2).replace(/\.00$/, "")}`;
  const trialEnd = new Date(trialEndUnix * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const [recorded] = await db
    .insert(stripeTrialWarningEvents)
    .values({ eventId })
    .onConflictDoNothing()
    .returning({ eventId: stripeTrialWarningEvents.eventId });
  if (!recorded) {
    logger.info(
      { eventId, subscriptionId: sub.id, customerId },
      "Skipping replayed seller trial-ending push notification",
    );
    return;
  }

  try {
    await sendPushToUser(seller.clerkId, {
      title: "Your free trial ends soon",
      body: `Your 5-day trial ends in 3 days — you'll be charged ${amount} on ${trialEnd} unless you cancel.`,
      data: {
        notificationId: stableNotificationId("subscription-trial-ending", sub.id, seller.clerkId),
        type: "subscription_trial_will_end",
        route: "/subscription",
      },
    });
  } catch (err) {
    // The marker must not turn a failed attempt into a permanently suppressed
    // warning. The outer Stripe ledger will also mark this delivery failed so
    // Stripe can retry it.
    await db
      .delete(stripeTrialWarningEvents)
      .where(eq(stripeTrialWarningEvents.eventId, eventId))
      .catch((cleanupErr) => {
        logger.error(
          { err: cleanupErr, eventId },
          "Could not release failed trial-warning event marker",
        );
      });
    throw err;
  }

  logger.info(
    { eventId, subscriptionId: sub.id, customerId, clerkId: seller.clerkId, trialEnd, amountCents },
    "Seller trial-ending push notification sent",
  );
}

/**
 * Handles a failed invoice for a seller's Stripe-billed platform subscription.
 * Stripe will emit subscription.updated with the authoritative subscription
 * status; this event is responsible for making the recovery path visible.
 */
export async function handleInvoicePaymentFailed(invoice: any): Promise<void> {
  const customerId: string | undefined =
    typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  const invoiceSubscriptionId: string | undefined =
    typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
  if (!customerId) {
    logger.warn({ invoiceId: invoice.id }, "Failed subscription invoice missing customer ID");
    return;
  }
  if (!invoiceSubscriptionId) {
    logger.info(
      { invoiceId: invoice.id, customerId },
      "Ignoring failed invoice because it is not subscription-backed",
    );
    return;
  }

  const [seller] = await db
    .select({ clerkId: users.clerkId, subscriptionId: users.subscriptionId })
    .from(users)
    .where(eq(users.stripeCustomerId, customerId))
    .limit(1);
  if (!seller) {
    logger.warn(
      { invoiceId: invoice.id, customerId },
      "Failed subscription invoice received for an unknown seller",
    );
    return;
  }
  if (!seller.subscriptionId || seller.subscriptionId !== invoiceSubscriptionId) {
    logger.info(
      {
        invoiceId: invoice.id,
        customerId,
        invoiceSubscriptionId,
        storedSubscriptionId: seller.subscriptionId,
      },
      "Ignoring failed invoice because it does not match the seller platform subscription",
    );
    return;
  }

  const notificationType = "subscription_payment_failed";
  const [notification] = await db
    .insert(notificationsFeed)
    .values({
      userId: seller.clerkId,
      category: "system",
      type: notificationType,
      title: "Payment failed",
      body: "Payment failed — update your card to keep your features.",
      targetId: invoice.id ?? null,
      targetType: "subscription_invoice",
      cta: "Update card",
    })
    // The database's partial unique index is the idempotency boundary. Do not
    // specify a conflict target: PostgreSQL can then match that partial
    // index, while unrelated notification uniqueness constraints remain
    // unaffected.
    .onConflictDoNothing()
    .returning({ id: notificationsFeed.id });

  if (notification) {
    await sendPushToUser(seller.clerkId, {
      title: "Payment failed",
      body: "Update your card to keep your Brandthread features.",
      data: {
        notificationId: notification.id,
        type: notificationType,
        route: "/subscription",
        invoiceId: invoice.id ?? null,
      },
    });
  }

  logger.info(
    {
      event: "invoice.payment_failed",
      invoiceId: invoice.id,
      customerId,
      clerkId: seller.clerkId,
      subscriptionId: invoiceSubscriptionId,
      attemptCount: invoice.attempt_count,
      nextPaymentAttempt: invoice.next_payment_attempt,
      notificationSent: Boolean(notification),
    },
    "Seller subscription payment failed",
  );
}

/**
 * Handles customer.subscription.deleted.
 * Marks the seller as canceled and resets them to the free Starter plan.
 */
async function handleSubscriptionDeleted(sub: any) {
  const customerId: string =
    typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (!customerId) return;

  await db.update(users).set({
    subscriptionStatus: "canceled",
    subscriptionPlanId: "starter",
    updatedAt: new Date(),
  }).where(eq(users.stripeCustomerId, customerId));

  logger.info({ subscriptionId: sub.id, customerId }, "Subscription deleted");
}

// ─── Stripe Identity handlers ─────────────────────────────────────────────────

async function handleIdentityVerified(session: any) {
  const clerkId: string | undefined = session.metadata?.seller_clerk_id;
  if (!clerkId) {
    logger.warn({ verificationSessionId: session.id }, "Verified identity session missing seller ID");
    return;
  }

  await db
    .update(users)
    .set({
      verified: true,
      verificationStatus: "verified",
      updatedAt: new Date(),
    })
    .where(eq(users.clerkId, clerkId));

  // Push notification to seller
  try {
    await db.insert(notificationsFeed).values({
      userId: clerkId,
      category: "system",
      type: "verification_verified",
      title: "You're a verified seller! ✓",
      body: "Your identity has been confirmed. Your verified badge is now live on your storefront.",
    });
  } catch {
    // Non-critical
  }

  logger.info({ sellerId: clerkId, verificationSessionId: session.id }, "Seller verified via Stripe Identity");
}

async function handleIdentityFailed(session: any) {
  const clerkId: string | undefined = session.metadata?.seller_clerk_id;
  if (!clerkId) {
    logger.warn({ verificationSessionId: session.id }, "Failed identity session missing seller ID");
    return;
  }

  const lastError = session.last_error;
  const reason = lastError?.reason ?? "unknown";

  await db
    .update(users)
    .set({
      verificationStatus: "failed",
      updatedAt: new Date(),
    })
    .where(eq(users.clerkId, clerkId));

  // Notify seller so they know to retry
  try {
    await db.insert(notificationsFeed).values({
      userId: clerkId,
      category: "system",
      type: "verification_failed",
      title: "Verification needs attention",
      body: "We couldn't verify your identity. Open the app to try again.",
    });
  } catch {
    // Non-critical
  }

  logger.info({ sellerId: clerkId, verificationSessionId: session.id, reason }, "Seller identity verification requires input");
}

// ─── Dispute handlers ─────────────────────────────────────────────────────────

function mapDisputeStatus(s: string): string {
  switch (s) {
    case "needs_response":           return "needs_response";
    case "under_review":             return "under_review";
    case "warning_needs_response":   return "needs_response";
    case "warning_under_review":     return "under_review";
    case "warning_closed":           return "closed";
    case "charge_refunded":          return "closed";
    case "won":                      return "won";
    case "lost":                     return "lost";
    default:                         return s;
  }
}

/** Resolve the seller's clerkId from a Stripe paymentIntentId or chargeId. */
async function resolveSellerAndOrder(
  paymentIntentId: string | null,
  chargeId: string | null,
): Promise<{ sellerId: string; orderId: string | null }> {
  // Try to find matching order by payment intent ID
  if (paymentIntentId) {
    const [ord] = await db
      .select({ id: orders.id, ownerId: orders.ownerId })
      .from(orders)
      .where(eq(orders.stripePaymentIntentId, paymentIntentId))
      .limit(1);
    if (ord) return { sellerId: ord.ownerId, orderId: ord.id };
  }
  return { sellerId: "unknown", orderId: null };
}

async function handleDisputeCreated(dispute: any) {
  const dueBy = dispute.evidence_details?.due_by
    ? new Date(dispute.evidence_details.due_by * 1000)
    : null;

  const { sellerId, orderId } = await resolveSellerAndOrder(
    dispute.payment_intent ?? null,
    dispute.charge ?? null,
  );

  // Build human-readable claim from reason
  const reasonLabels: Record<string, string> = {
    credit_not_processed:    "Customer claims they did not receive a refund.",
    duplicate:               "Customer claims this is a duplicate charge.",
    fraudulent:              "Customer reports this as an unauthorized charge.",
    general:                 "Customer filed a general dispute.",
    product_not_received:    "Customer claims the product was not received.",
    product_unacceptable:    "Customer claims the product was defective or not as described.",
    subscription_canceled:   "Customer claims they canceled their subscription.",
    unrecognized:            "Customer does not recognize this charge.",
  };
  const customerClaim = reasonLabels[dispute.reason] ?? `Dispute filed: ${dispute.reason}`;

  await db
    .insert(disputes)
    .values({
      stripeDisputeId:       dispute.id,
      stripeChargeId:        dispute.charge ?? null,
      stripePaymentIntentId: dispute.payment_intent ?? null,
      orderId,
      sellerId,
      amountCents:           dispute.amount,
      currency:              dispute.currency,
      reason:                dispute.reason,
      status:                mapDisputeStatus(dispute.status),
      evidenceDueBy:         dueBy,
      stripeEvidenceDetails: dispute.evidence_details ?? {},
      isChargeRefundable:    dispute.is_charge_refundable ?? true,
      networkReasonCode:     dispute.network_reason_code ?? null,
      customerClaim,
    })
    .onConflictDoNothing();

  logger.info({ disputeId: dispute.id, sellerId, orderId, reason: dispute.reason }, "Dispute created");
}

async function handleDisputeUpdated(stripeDispute: any) {
  const dueBy = stripeDispute.evidence_details?.due_by
    ? new Date(stripeDispute.evidence_details.due_by * 1000)
    : null;

  await db
    .update(disputes)
    .set({
      status:                mapDisputeStatus(stripeDispute.status),
      evidenceDueBy:         dueBy,
      stripeEvidenceDetails: stripeDispute.evidence_details ?? {},
      updatedAt:             new Date(),
    })
    .where(eq(disputes.stripeDisputeId, stripeDispute.id));

  logger.info({ disputeId: stripeDispute.id, disputeStatus: stripeDispute.status }, "Dispute updated");
}

async function handleDisputeClosed(stripeDispute: any) {
  await db
    .update(disputes)
    .set({
      status:    mapDisputeStatus(stripeDispute.status),
      updatedAt: new Date(),
    })
    .where(eq(disputes.stripeDisputeId, stripeDispute.id));

  logger.info({ disputeId: stripeDispute.id, disputeStatus: stripeDispute.status }, "Dispute closed");
}

/**
 * checkout.session.completed for a freelancer job escrow payment.
 * Marks the job paid; the payout transfer happens later, when the freelancer
 * completes the job (see routes/freelancer-jobs.ts).
 */
async function handleFreelancerJobPaid(session: any, jobIdOverride?: string) {
  const jobId: string = jobIdOverride ?? session.metadata?.["freelancerJobId"] ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) {
    logger.error({ stripeSessionId: session.id }, "Freelancer job payment has invalid job ID");
    return;
  }
  const piId: string | null =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;

  const [updated] = await db
    .update(freelancerJobs)
    .set({
      paymentStatus: "paid",
      ...(piId ? { stripePaymentIntentId: piId } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(freelancerJobs.id, jobId),
        eq(freelancerJobs.paymentStatus, "unpaid"),
        ne(freelancerJobs.status, "cancelled"),
      ),
    )
    .returning({ id: freelancerJobs.id });

  if (updated) {
    logger.info({ jobId, stripeSessionId: session.id }, "Freelancer job marked paid");
    return;
  }

  // Late payment for a cancelled job → refund it instead of recording it.
  const [job] = await db
    .select()
    .from(freelancerJobs)
    .where(eq(freelancerJobs.id, jobId))
    .limit(1);
  if (job && job.status === "cancelled" && job.paymentStatus !== "refunded" && piId && stripe) {
    try {
      await refundJobPayment(stripe, {
        jobId,
        paymentIntentId: piId,
        context: "webhook_after_cancel",
      });
      await db
        .update(freelancerJobs)
        .set({ paymentStatus: "refunded", stripePaymentIntentId: piId, updatedAt: new Date() })
        .where(eq(freelancerJobs.id, jobId));
      logger.info({ jobId, stripeSessionId: session.id }, "Late freelancer job payment refunded after cancellation");
    } catch (refundErr) {
      logger.error({ err: refundErr, jobId, stripeSessionId: session.id }, "Late freelancer job payment refund failed");
    }
    return;
  }

  logger.info({ jobId, stripeSessionId: session.id }, "Freelancer job already paid or not found; skipping");
}

async function handleAccountUpdated(account: any, providerEventId?: string) {
  const stripeAccountId: string  = account.id;
  const chargesEnabled:  boolean = account.charges_enabled ?? false;
  const payoutsEnabled:  boolean = account.payouts_enabled ?? false;
  const detailsSubmitted: boolean = account.details_submitted ?? false;
  const manufacturerReadiness = connectReadiness(account);

  const status =
    chargesEnabled && payoutsEnabled
      ? "active"
      : detailsSubmitted
      ? "restricted"
      : "pending";

  await db
    .update(users)
    .set({ stripeAccountStatus: status, updatedAt: new Date() })
    .where(eq(users.stripeAccountId, stripeAccountId));

  // Freelancer rows track the same Connect account status (the account may be
  // shared with a seller profile, or freelancer-only).
  await db
    .update(freelancers)
    .set({ stripeAccountStatus: status, updatedAt: new Date() })
    .where(eq(freelancers.stripeAccountId, stripeAccountId));

  const [manufacturer] = await db.update(manufacturers)
    .set({
      stripeAccountStatus: manufacturerReadiness.status,
      paymentSetup: manufacturerReadiness.ready,
      updatedAt: new Date(),
    })
    .where(eq(manufacturers.stripeAccountId, stripeAccountId))
    .returning({ id: manufacturers.id, clerkId: manufacturers.clerkId });
  if (manufacturer) {
    const [activity] = await db.insert(manufacturerActivityEvents).values({
      manufacturerId: manufacturer.id,
      category: "payout",
      type: manufacturerReadiness.ready ? "payouts_ready" : "payouts_restricted",
      providerEventId,
      metadata: manufacturerReadiness,
    }).onConflictDoNothing({ target: manufacturerActivityEvents.providerEventId })
      .returning({ id: manufacturerActivityEvents.id });
    if (activity && manufacturer.clerkId) {
      await publishNotification({
        userId: manufacturer.clerkId,
        category: "production",
        type: manufacturerReadiness.ready ? "manufacturer_payouts_ready" : "manufacturer_payouts_restricted",
        title: manufacturerReadiness.ready ? "Payouts are ready" : "Payout setup needs attention",
        body: manufacturerReadiness.ready
          ? "You can now receive seller payments."
          : "Return to payout settings to complete Stripe requirements.",
        targetId: manufacturer.id,
        targetType: "manufacturer_payout",
        cta: "/manufacturers/payment",
      });
    }
  }

  logger.info({ stripeAccountId, accountStatus: status }, "Connect account updated");
}

async function handleManufacturerCheckoutPaid(session: any, providerEventId?: string): Promise<boolean> {
  const orderId = session.metadata?.sampleOrderId;
  const [row] = await db.select({
    order: sampleOrders,
    mfrClerkId: manufacturers.clerkId,
  }).from(sampleOrders)
    .leftJoin(manufacturers, eq(sampleOrders.manufacturerId, manufacturers.id))
    .where(orderId
      ? eq(sampleOrders.id, orderId)
      : eq(sampleOrders.stripeCheckoutSessionId, session.id))
    .limit(1);
  if (!row) return false;
  const paymentIntentId = typeof session.payment_intent === "string"
    ? session.payment_intent
    : session.payment_intent?.id ?? null;
  const [updated] = await db.update(sampleOrders).set({
    status: "payment_received",
    stripePaymentIntentId: paymentIntentId,
    updatedAt: new Date(),
  }).where(and(eq(sampleOrders.id, row.order.id), eq(sampleOrders.status, "pending_payment")))
    .returning({ id: sampleOrders.id });
  if (updated) {
    await db.insert(manufacturerActivityEvents).values({
      manufacturerId: row.order.manufacturerId,
      sampleOrderId: row.order.id,
      actorClerkId: row.order.sellerId,
      category: "payment",
      type: "payment_received",
      amountCents: row.order.priceCents,
      providerEventId: providerEventId ?? `checkout:${session.id}`,
      metadata: { source: "stripe_checkout", sessionId: session.id, orderType: row.order.orderType },
    }).onConflictDoNothing({ target: manufacturerActivityEvents.providerEventId });
  }
  if (updated && row.mfrClerkId) {
    await publishNotification({
      userId: row.mfrClerkId,
      category: "production",
      type: "manufacturer_payment_received",
      title: "Payment received",
      body: `${row.order.title} is ready for production.`,
      targetId: row.order.id,
      targetType: row.order.orderType === "bulk" ? "bulk_order" : "sample_order",
      cta: `/manufacturers/orders/${row.order.id}`,
    });
  }
  return true;
}

async function handleManufacturerTransfer(transfer: any, providerEventId: string): Promise<void> {
  const orderId = transfer.metadata?.sampleOrderId;
  if (!orderId) return;
  const [order] = await db.select().from(sampleOrders).where(eq(sampleOrders.id, orderId)).limit(1);
  if (!order || !order.walletId) return;
  const walletId = order.walletId;
  const ownsNotification = await db.transaction(async (tx) => {
    const [updated] = await tx.update(sampleOrders).set({
      stripeTransferId: transfer.id,
      walletPaymentState: "paid",
      status: "payment_received",
      updatedAt: new Date(),
    }).where(and(eq(sampleOrders.id, order.id), eq(sampleOrders.walletPaymentState, "processing")))
      .returning({ id: sampleOrders.id });
    if (updated) {
      await tx.update(dropWallets).set({
        releasedCents: sql`${dropWallets.releasedCents} + ${order.priceCents}`,
        reservedCents: sql`GREATEST(${dropWallets.reservedCents} - ${order.priceCents}, 0)`,
        updatedAt: new Date(),
      }).where(eq(dropWallets.id, walletId));
      await tx.insert(dropWalletTransactions).values({
        walletId,
        type: "bulk_payment",
        amountCents: order.priceCents,
        sampleOrderId: order.id,
        description: `Bulk order payment: ${order.title}`,
        stripeTransferId: transfer.id,
      });
    }
    if (updated) {
      const [claimed] = await tx.insert(manufacturerActivityEvents).values({
        manufacturerId: order.manufacturerId,
        sampleOrderId: order.id,
        actorClerkId: order.sellerId,
        category: "payment",
        type: "payment_received",
        amountCents: order.priceCents,
        providerEventId: `transfer:${transfer.id}`,
        metadata: { source: "drop_wallet", transferId: transfer.id, stripeEventId: providerEventId, notificationOwner: "webhook" },
      }).onConflictDoNothing({ target: manufacturerActivityEvents.providerEventId })
        .returning({ id: manufacturerActivityEvents.id });
      return !!claimed;
    }
    return false;
  });
  if (ownsNotification) {
    const [manufacturer] = await db.select({ clerkId: manufacturers.clerkId })
      .from(manufacturers).where(eq(manufacturers.id, order.manufacturerId)).limit(1);
    if (manufacturer?.clerkId) {
      await publishNotification({
        userId: manufacturer.clerkId,
        category: "production",
        type: "manufacturer_payment_received",
        title: "Payment received",
        body: `${order.title} is ready for production.`,
        targetId: order.id,
        targetType: order.orderType === "bulk" ? "bulk_order" : "sample_order",
        cta: `/manufacturers/orders/${order.id}`,
      });
    }
  }
}

export function reversalDeltaCents(
  cumulativeReversedCents: unknown,
  alreadyReversedCents: number,
  originalAmountCents: number,
): number {
  const cumulative = typeof cumulativeReversedCents === "number" ? cumulativeReversedCents : originalAmountCents;
  return Math.max(0, Math.min(cumulative - alreadyReversedCents, originalAmountCents - alreadyReversedCents));
}

async function findManufacturerCardOrder(
  paymentIntentId: string | null,
  chargeId: string | null,
) {
  let resolvedPaymentIntentId = paymentIntentId;
  // Refund/dispute payloads normally contain payment_intent. Resolve a charge
  // defensively for older/provider-variant payloads, then persist the linkage.
  if (!resolvedPaymentIntentId && chargeId && stripe) {
    const charge = await stripe.charges.retrieve(chargeId);
    resolvedPaymentIntentId = typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id ?? null;
  }
  const conditions = resolvedPaymentIntentId
    ? eq(sampleOrders.stripePaymentIntentId, resolvedPaymentIntentId)
    : chargeId ? eq(sampleOrders.stripeChargeId, chargeId) : undefined;
  if (!conditions) return null;
  const [order] = await db.select({
    order: sampleOrders,
    clerkId: manufacturers.clerkId,
  }).from(sampleOrders)
    .leftJoin(manufacturers, eq(sampleOrders.manufacturerId, manufacturers.id))
    .where(conditions)
    .limit(1);
  return order ? { ...order, paymentIntentId: resolvedPaymentIntentId } : null;
}

async function isManufacturerCardPayment(paymentIntentId: string | null, chargeId: string | null): Promise<boolean> {
  return !!await findManufacturerCardOrder(paymentIntentId, chargeId);
}

async function handleManufacturerCardReversal(input: {
  paymentIntentId: string | null;
  chargeId: string | null;
  cumulativeReversedCents: unknown;
  providerEventId: string;
  source: "refund" | "dispute";
}): Promise<boolean> {
  const found = await findManufacturerCardOrder(input.paymentIntentId, input.chargeId);
  if (!found) return false;
  const notification = await db.transaction(async (tx): Promise<{
    clerkId: string; title: string; orderType: string; reviewState: string;
  } | null> => {
    await tx.execute(sql`SELECT id FROM sample_orders WHERE id = ${found.order.id}::uuid FOR UPDATE`);
    const [order] = await tx.select().from(sampleOrders).where(eq(sampleOrders.id, found.order.id)).limit(1);
    if (!order) return null;
    const priorEvents = await tx.select({ amountCents: manufacturerActivityEvents.amountCents })
      .from(manufacturerActivityEvents)
      .where(and(
        eq(manufacturerActivityEvents.sampleOrderId, order.id),
        eq(manufacturerActivityEvents.type, "payment_reversed"),
      ));
    const alreadyReversedCents = priorEvents.reduce((sum, event) => sum + (event.amountCents ?? 0), 0);
    const reversedCents = reversalDeltaCents(input.cumulativeReversedCents, alreadyReversedCents, order.priceCents);
    if (!reversedCents) return null;
    const [recorded] = await tx.insert(manufacturerActivityEvents).values({
      manufacturerId: order.manufacturerId,
      sampleOrderId: order.id,
      category: "payment",
      type: "payment_reversed",
      amountCents: reversedCents,
      providerEventId: input.providerEventId,
      metadata: { source: input.source, chargeId: input.chargeId, paymentIntentId: found.paymentIntentId },
    }).onConflictDoNothing({ target: manufacturerActivityEvents.providerEventId })
      .returning({ id: manufacturerActivityEvents.id });
    if (!recorded) return null;
    const totalReversedCents = alreadyReversedCents + reversedCents;
    const reviewState = totalReversedCents >= order.priceCents ? "reversed" : "partial_reversal";
    await tx.update(sampleOrders).set({
      status: "payment_review",
      paymentReviewState: reviewState,
      stripeChargeId: input.chargeId ?? order.stripeChargeId,
      updatedAt: new Date(),
    }).where(eq(sampleOrders.id, order.id));
    if (found.clerkId) {
      return { clerkId: found.clerkId, title: order.title, orderType: order.orderType, reviewState };
    }
    return null;
  });
  if (notification) {
    await publishNotification({
      userId: notification.clerkId,
      category: "production",
      type: "manufacturer_payment_reversed",
      title: notification.reviewState === "reversed" ? "Payment reversed" : "Payment partially reversed",
      body: `${notification.title} requires payment review.`,
      targetId: found.order.id,
      targetType: notification.orderType === "bulk" ? "bulk_order" : "sample_order",
      cta: `/manufacturers/orders/${found.order.id}`,
    });
  }
  return true;
}

async function handleManufacturerTransferReversed(transfer: any, providerEventId: string): Promise<void> {
  const orderId = transfer.metadata?.sampleOrderId;
  if (!orderId) return;
  const notification = await db.transaction(async (tx): Promise<{
    clerkId: string; title: string; orderType: string; reviewState: string;
  } | null> => {
    // Serialize distinct partial-reversal events for one order before deriving
    // the delta from Stripe's cumulative amount_reversed.
    const locked = await tx.execute(
      sql`SELECT id FROM sample_orders WHERE id = ${orderId}::uuid FOR UPDATE`,
    );
    if (!((locked as any).rows?.length)) return null;
    const [order] = await tx.select().from(sampleOrders).where(eq(sampleOrders.id, orderId)).limit(1);
    if (!order?.walletId || order.stripeTransferId !== transfer.id) return null;
    const priorEvents = await tx.select({ amountCents: manufacturerActivityEvents.amountCents })
      .from(manufacturerActivityEvents)
      .where(and(
        eq(manufacturerActivityEvents.sampleOrderId, order.id),
        eq(manufacturerActivityEvents.type, "payment_reversed"),
      ));
    const alreadyReversedCents = priorEvents.reduce((sum, event) => sum + (event.amountCents ?? 0), 0);
    const reversedCents = reversalDeltaCents(transfer.amount_reversed, alreadyReversedCents, order.priceCents);
    if (reversedCents === 0) return null;
    // Claim provider delivery first. A Stripe retry must not adjust the wallet
    // twice, even after a process crash between event receipt and notification.
    const [recorded] = await tx.insert(manufacturerActivityEvents).values({
      manufacturerId: order.manufacturerId,
      sampleOrderId: order.id,
      category: "payment",
      type: "payment_reversed",
      amountCents: reversedCents,
      providerEventId,
      metadata: {
        transferId: transfer.id,
        cumulativeReversedCents: transfer.amount_reversed ?? order.priceCents,
      },
    }).onConflictDoNothing({ target: manufacturerActivityEvents.providerEventId })
      .returning({ id: manufacturerActivityEvents.id });
    if (!recorded) return null;
    const totalReversedCents = alreadyReversedCents + reversedCents;
    const reviewState = totalReversedCents >= order.priceCents ? "reversed" : "partial_reversal";
    await tx.update(sampleOrders).set({
      status: "payment_review",
      walletPaymentState: "reversed",
      paymentReviewState: reviewState,
      updatedAt: new Date(),
    }).where(eq(sampleOrders.id, order.id));
    // A reversal returns funds from the manufacturer's transfer to the
    // seller's wallet. releasedCents is reduced so availableCents becomes
    // truthful immediately; the immutable negative ledger line records it.
    await tx.update(dropWallets).set({
      releasedCents: sql`GREATEST(${dropWallets.releasedCents} - ${reversedCents}, 0)`,
      updatedAt: new Date(),
    }).where(eq(dropWallets.id, order.walletId));
    await tx.insert(dropWalletTransactions).values({
      walletId: order.walletId,
      type: "bulk_payment_reversal",
      amountCents: -reversedCents,
      sampleOrderId: order.id,
      description: `${reviewState === "reversed" ? "Full" : "Partial"} bulk payment reversal: ${order.title}`,
      stripeTransferId: transfer.id,
    });
    const [manufacturer] = await tx.select({ clerkId: manufacturers.clerkId })
      .from(manufacturers).where(eq(manufacturers.id, order.manufacturerId)).limit(1);
    if (manufacturer?.clerkId) {
      return { clerkId: manufacturer.clerkId, title: order.title, orderType: order.orderType, reviewState };
    }
    return null;
  });
  if (notification) {
    await publishNotification({
      userId: notification.clerkId,
      category: "production",
      type: "manufacturer_payment_reversed",
      title: notification.reviewState === "reversed" ? "Payment reversed" : "Payment partially reversed",
      body: `${notification.title} requires payment review.`,
      targetId: orderId,
      targetType: notification.orderType === "bulk" ? "bulk_order" : "sample_order",
      cta: `/manufacturers/orders/${orderId}`,
    });
  }
}

export default router;
