/**
 * Manufacturer order cards and the shared production tracker.
 * Mounted at /api/manufacturers (before the main manufacturers router).
 *
 * POST /me/threads/:threadId/order-cards   manufacturer prices a sample/bulk order and posts a payable card
 * GET  /orders/:orderId/timeline           six-stage tracker with timestamps and tracking (either participant)
 * POST /orders/:orderId/cancel             manufacturer withdraws / seller declines an unpaid card
 * POST /orders/:orderId/confirm-delivery   seller confirms a shipped order arrived
 *
 * Payment itself stays with the payments service: the seller pays a card via
 * POST /api/sample-orders/:id/checkout-session and Stripe reconciliation
 * (webhook or POST /api/sample-orders/:id/pay) moves it to payment_received.
 */
import express, { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  manufacturerMessages,
  manufacturerRelationships,
  manufacturerThreads,
  manufacturers,
  sampleOrders,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { SendManufacturerOrderCardBody, CancelManufacturerOrderCardBody } from "@workspace/api-zod";
import { orderTypeLabel, validateCardInput, validateTransition } from "@workspace/manufacturer-flow";
import { requireAuth } from "../middlewares/requireAuth";
import { teamContext } from "../middlewares/requireRole";
import { computeApplicationFeeCents, requireStripe } from "../lib/stripe";
import {
  afterStageChange,
  cardMessageType,
  cardSummary,
  loadOrderTimeline,
  recordOrderEvent,
  toCardSnapshot,
} from "../lib/manufacturerOrders";
import { publishNotification } from "./notifications-feed";
import { serializeMessage } from "./manufacturers";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function serializeOrder(order: typeof sampleOrders.$inferSelect) {
  return {
    ...order,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    shippedAt: order.shippedAt?.toISOString() ?? null,
    deliveredAt: order.deliveredAt?.toISOString() ?? null,
  };
}

async function notify(req: express.Request, notification: Parameters<typeof publishNotification>[0]) {
  try {
    await publishNotification(notification);
  } catch (err) {
    req.log.error({ err, userId: notification.userId, type: notification.type }, "Manufacturer order notification failed");
  }
}

/**
 * Resolves the caller's role on an order. Sellers are resolved through team
 * context (store owner identity); manufacturers through their own Clerk id.
 */
async function loadParticipantOrder(req: express.Request, orderId: string) {
  if (!UUID_RE.test(orderId)) return { status: 404 as const };
  const actualUserId = getAuth(req).userId;
  const sellerId = (req as any).clerkUserId as string | undefined;
  const [row] = await db.select({
    order: sampleOrders,
    mfrClerkId: manufacturers.clerkId,
    mfrName: manufacturers.businessName,
    payoutReady: manufacturers.paymentSetup,
  }).from(sampleOrders)
    .innerJoin(manufacturers, eq(sampleOrders.manufacturerId, manufacturers.id))
    .where(eq(sampleOrders.id, orderId))
    .limit(1);
  if (!row) return { status: 404 as const };
  const role = row.mfrClerkId && row.mfrClerkId === actualUserId
    ? "manufacturer" as const
    : sellerId && row.order.sellerId === sellerId ? "seller" as const : null;
  // Non-participants get the same answer as a missing order.
  if (!role) return { status: 404 as const };
  return { status: 200 as const, role, ...row };
}

const participantAuth = [requireAuth, teamContext()] as const;

// ── Manufacturer sends a priced order card ────────────────────────────────────

router.post("/me/threads/:threadId/order-cards", requireAuth, async (req, res) => {
  const userId = getAuth(req).userId;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = SendManufacturerOrderCardBody.safeParse(req.body);
  if (!parsed.success) {
    const check = validateCardInput({
      orderType: String(req.body?.orderType ?? ""),
      title: String(req.body?.title ?? ""),
      description: typeof req.body?.description === "string" ? req.body.description : null,
      quantity: Number(req.body?.quantity),
      priceCents: Number(req.body?.priceCents),
    });
    res.status(422).json({
      error: "Check the highlighted fields and try again.",
      fieldErrors: check.ok ? {} : check.errors,
      details: parsed.error.flatten(),
    });
    return;
  }
  const input = parsed.data;
  const check = validateCardInput(input);
  if (!check.ok) {
    res.status(422).json({ error: "Check the highlighted fields and try again.", fieldErrors: check.errors });
    return;
  }
  const threadId = String(req.params.threadId);
  if (!UUID_RE.test(threadId)) { res.status(404).json({ error: "Conversation not found" }); return; }

  const [mfr] = await db.select().from(manufacturers).where(eq(manufacturers.clerkId, userId)).limit(1);
  if (!mfr) { res.status(404).json({ error: "Manufacturer profile not found" }); return; }
  if (mfr.status !== "active") {
    res.status(403).json({ error: "Your manufacturer profile is not active." }); return;
  }
  const [thread] = await db.select().from(manufacturerThreads).where(and(
    eq(manufacturerThreads.id, threadId),
    eq(manufacturerThreads.manufacturerId, mfr.id),
  )).limit(1);
  if (!thread) { res.status(404).json({ error: "Conversation not found" }); return; }

  const requestKey = `mfr-card:${input.clientRequestId}`;
  const title = input.title.trim();
  const description = input.description?.trim() || null;
  const messageType = cardMessageType(input.orderType);

  const replay = async () => {
    const [existing] = await db.select().from(sampleOrders).where(and(
      eq(sampleOrders.sellerId, thread.buyerClerkId),
      eq(sampleOrders.clientRequestId, requestKey),
    )).limit(1);
    if (!existing) return null;
    if (existing.manufacturerId !== mfr.id || existing.threadId !== thread.id || existing.orderType !== input.orderType
      || existing.title !== title || existing.quantity !== input.quantity || existing.priceCents !== input.priceCents) {
      return { conflict: true as const };
    }
    const [message] = await db.select().from(manufacturerMessages).where(and(
      eq(manufacturerMessages.threadId, thread.id),
      eq(manufacturerMessages.senderClerkId, userId),
      eq(manufacturerMessages.clientRequestId, requestKey),
    )).limit(1);
    return { order: existing, message };
  };

  const prior = await replay();
  if (prior?.conflict) {
    res.status(409).json({ error: "clientRequestId was already used for a different order card" }); return;
  }
  if (prior && "order" in prior && prior.message) {
    res.json({
      order: serializeOrder(prior.order),
      message: { ...(await serializeMessage(prior.message)), order: toCardSnapshot(prior.order, mfr.paymentSetup) },
    });
    return;
  }

  let created: { order: typeof sampleOrders.$inferSelect; message: typeof manufacturerMessages.$inferSelect } | null;
  try {
    created = await db.transaction(async (tx) => {
      const [order] = await tx.insert(sampleOrders).values({
        manufacturerId: mfr.id,
        sellerId: thread.buyerClerkId,
        clientRequestId: requestKey,
        threadId: thread.id,
        orderType: input.orderType,
        issuedBy: "manufacturer",
        title,
        description,
        quantity: input.quantity,
        priceCents: input.priceCents,
        platformFeeCents: computeApplicationFeeCents(input.priceCents),
        status: "pending_payment",
      }).onConflictDoNothing().returning();
      if (!order) return null;
      await recordOrderEvent(tx, {
        order, actorRole: "manufacturer", actorClerkId: userId, fromStatus: null, toStatus: "pending_payment",
      });
      const [message] = await tx.insert(manufacturerMessages).values({
        threadId: thread.id,
        senderRole: "manufacturer",
        senderClerkId: userId,
        clientRequestId: requestKey,
        content: cardSummary(order),
        messageType,
        mediaUrls: [],
        cardData: {
          orderId: order.id,
          orderType: order.orderType,
          title: order.title,
          description: order.description,
          quantity: order.quantity,
          priceCents: order.priceCents,
          currency: "USD",
        },
      }).returning();
      await tx.update(manufacturerThreads).set({
        lastMessage: message.content,
        lastMessageAt: new Date(),
        orderStatus: "pending_payment",
        sellerUnreadCount: sql`${manufacturerThreads.sellerUnreadCount} + 1`,
      }).where(eq(manufacturerThreads.id, thread.id));
      await tx.insert(manufacturerRelationships)
        .values({ sellerId: thread.buyerClerkId, manufacturerId: mfr.id })
        .onConflictDoNothing();
      return { order, message };
    });
  } catch (err) {
    req.log.error({ err, threadId }, "Failed to create manufacturer order card");
    res.status(500).json({ error: "The card couldn't be sent. Try again." });
    return;
  }

  if (!created) {
    // A concurrent request with the same key won the insert; return its result.
    const raced = await replay();
    if (raced && "order" in raced && raced.message) {
      res.json({
        order: serializeOrder(raced.order),
        message: { ...(await serializeMessage(raced.message)), order: toCardSnapshot(raced.order, mfr.paymentSetup) },
      });
      return;
    }
    res.status(409).json({ error: "clientRequestId was already used for a different order card" });
    return;
  }

  await notify(req, {
    userId: thread.buyerClerkId,
    category: "production",
    type: "manufacturer_order_card",
    title: `${mfr.businessName} sent a ${orderTypeLabel(created.order.orderType).toLowerCase()} card`,
    body: created.message.content,
    actorName: mfr.businessName,
    targetId: thread.id,
    targetType: "manufacturer_thread",
    cta: `/manufacturer-messages?threadId=${thread.id}`,
  });

  res.status(201).json({
    order: serializeOrder(created.order),
    message: { ...(await serializeMessage(created.message)), order: toCardSnapshot(created.order, mfr.paymentSetup) },
  });
});

// ── Tracker timeline ──────────────────────────────────────────────────────────

router.get("/orders/:orderId/timeline", ...participantAuth, async (req, res) => {
  try {
    const found = await loadParticipantOrder(req, String(req.params.orderId));
    if (found.status !== 200) { res.status(404).json({ error: "Order not found" }); return; }
    res.json(await loadOrderTimeline(found.order, found.role));
  } catch (err) {
    req.log.error({ err, orderId: req.params.orderId }, "Failed to load order timeline");
    res.status(500).json({ error: "The tracker couldn't be loaded." });
  }
});

// ── Withdraw / decline an unpaid card ─────────────────────────────────────────

router.post("/orders/:orderId/cancel", ...participantAuth, async (req, res) => {
  try {
    const parsed = CancelManufacturerOrderCardBody.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ error: "Reason must be 500 characters or fewer." }); return; }
    const found = await loadParticipantOrder(req, String(req.params.orderId));
    if (found.status !== 200) { res.status(404).json({ error: "Order not found" }); return; }
    const { order, role } = found;
    const transition = validateTransition({ from: order.status, to: "cancelled", actor: role });
    if (!transition.ok) { res.status(409).json({ error: transition.message, code: transition.code }); return; }
    if (order.walletPaymentState !== "pending") {
      res.status(409).json({ error: "A payment for this card is already in progress.", code: "PAYMENT_IN_PROGRESS" }); return;
    }

    // Close any open Stripe Checkout first so a late payment can't land on a
    // cancelled card. A paid or completing session wins over the cancel.
    if (order.stripeCheckoutSessionId) {
      const stripe = requireStripe();
      const session = await stripe.checkout.sessions.retrieve(order.stripeCheckoutSessionId);
      if (session.payment_status === "paid" || session.status === "complete") {
        res.status(409).json({ error: "The seller has already paid this card. Refresh to see the latest status.", code: "ALREADY_PAID" });
        return;
      }
      if (session.status === "open") {
        await stripe.checkout.sessions.expire(session.id).catch((err: any) => {
          // Expire races with completion; re-check below via the conditional update.
          req.log.warn({ err, orderId: order.id }, "Checkout session could not be expired before cancelling");
          throw Object.assign(new Error("CHECKOUT_BUSY"), { status: 409 });
        });
      }
    }

    const reason = parsed.data.reason?.trim() || null;
    const [updated] = await db.update(sampleOrders).set({
      status: "cancelled",
      updatedAt: new Date(),
      revision: sql`${sampleOrders.revision} + 1`,
    }).where(and(
      eq(sampleOrders.id, order.id),
      eq(sampleOrders.status, "pending_payment"),
      eq(sampleOrders.walletPaymentState, "pending"),
    )).returning();
    if (!updated) {
      res.status(409).json({ error: "This card changed while you were cancelling it. Refresh to see the latest status.", code: "STALE_WRITE" });
      return;
    }
    await afterStageChange({
      order: updated, actorRole: role, actorClerkId: getAuth(req).userId ?? null,
      fromStatus: "pending_payment", toStatus: "cancelled", note: reason,
    }).catch((err) => req.log.error({ err, orderId: order.id }, "Failed to record card cancellation event"));

    const recipientId = role === "seller" ? found.mfrClerkId : order.sellerId;
    if (recipientId) {
      await notify(req, {
        userId: recipientId,
        category: "production",
        type: "manufacturer_order_cancelled",
        title: role === "seller" ? `Seller declined "${order.title}"` : `${found.mfrName} withdrew "${order.title}"`,
        body: reason ?? "The order card was closed before payment.",
        targetId: order.threadId ?? order.id,
        targetType: order.threadId ? "manufacturer_thread" : order.orderType === "bulk" ? "bulk_order" : "sample_order",
        cta: role === "seller"
          ? `/manufacturers/messages/${order.threadId ?? ""}`
          : `/manufacturer-messages?threadId=${order.threadId ?? ""}`,
      });
    }
    res.json(serializeOrder(updated));
  } catch (err: any) {
    if (err?.status === 409) {
      res.status(409).json({ error: "Payment is being processed right now. Wait a moment and refresh.", code: "PAYMENT_IN_PROGRESS" });
      return;
    }
    if (err?.status === 503) { res.status(503).json({ error: "Payments are not configured on this server." }); return; }
    req.log.error({ err, orderId: req.params.orderId }, "Failed to cancel order card");
    res.status(500).json({ error: "The card couldn't be cancelled. Try again." });
  }
});

// ── Seller confirms delivery ──────────────────────────────────────────────────

router.post("/orders/:orderId/confirm-delivery", ...participantAuth, async (req, res) => {
  try {
    const found = await loadParticipantOrder(req, String(req.params.orderId));
    if (found.status !== 200) { res.status(404).json({ error: "Order not found" }); return; }
    const { order, role } = found;
    if (role !== "seller") {
      res.status(403).json({ error: "Manufacturers mark delivery from the order tracker." }); return;
    }
    const transition = validateTransition({ from: order.status, to: "delivered", actor: "seller" });
    if (!transition.ok) { res.status(409).json({ error: transition.message, code: transition.code }); return; }
    const now = new Date();
    const [updated] = await db.update(sampleOrders).set({
      status: "delivered",
      deliveredAt: now,
      updatedAt: now,
      revision: sql`${sampleOrders.revision} + 1`,
    }).where(and(eq(sampleOrders.id, order.id), eq(sampleOrders.status, "shipped"))).returning();
    if (!updated) {
      res.status(409).json({ error: "This order changed. Refresh to see the latest status.", code: "STALE_WRITE" }); return;
    }
    await afterStageChange({
      order: updated, actorRole: "seller", actorClerkId: getAuth(req).userId ?? null,
      fromStatus: "shipped", toStatus: "delivered",
    }).catch((err) => req.log.error({ err, orderId: order.id }, "Failed to record delivery confirmation event"));
    if (found.mfrClerkId) {
      await notify(req, {
        userId: found.mfrClerkId,
        category: "production",
        type: "manufacturer_order_status",
        title: `"${order.title}" was received`,
        body: "The seller confirmed delivery.",
        targetId: order.id,
        targetType: order.orderType === "bulk" ? "bulk_order" : "sample_order",
        cta: `/manufacturers/orders/${order.id}`,
      });
    }
    res.json(serializeOrder(updated));
  } catch (err) {
    req.log.error({ err, orderId: req.params.orderId }, "Failed to confirm delivery");
    res.status(500).json({ error: "Delivery couldn't be confirmed. Try again." });
  }
});

export default router;
