/**
 * Sample & Bulk Order management — 6-stage production tracker with Stripe payments.
 * Mounted at /api/sample-orders
 *
 * POST /              seller creates a sample order (initiates Stripe PaymentIntent)
 * GET  /              list seller's orders
 * GET  /:id           get order detail
 * POST /:id/pay       confirm Stripe payment and activate order
 * PATCH/:id/advance   manufacturer advances production stage
 * PATCH/:id/tracking  add tracking number (triggers payout release to manufacturer)
 * POST /:id/pay-from-wallet  seller pays bulk order from drop wallet
 *
 * Sample image flow (no Stripe):
 * POST /:id/images/request-upload  → { uploadURL, objectPath } presigned GCS PUT
 * POST /:id/images                 → record objectPath + set ACL owner; returns display URLs
 * GET  /:id/images                 → list images as short-lived signed GET URLs
 */
import express, { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { sampleOrders, manufacturers, manufacturerThreads, manufacturerActivityEvents, manufacturerRelationships, dropWallets, dropWalletTransactions, drops } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requireStripe, PLATFORM_COMMISSION_RATE, computeApplicationFeeCents } from "../lib/stripe";
import { lockDrop, recordBulkPaidFromHeld } from "../lib/money/escrow";
import { DROP_OPEN_STATES } from "../lib/money/stateMachines";
import { ObjectStorageService } from "../lib/objectStorage";
import { ObjectPermission } from "../lib/objectAcl";
import { publishNotification } from "./notifications-feed";
import { isAllowedBrandthreadCallbackUrl } from "../lib/brandthreadCallbackUrls";
import { CreateProductionOrderBody } from "@workspace/api-zod";
import { connectReadiness } from "./manufacturer-connect";
import { afterStageChange } from "../lib/manufacturerOrders";

const router = Router();
router.use(requireAuth);

const objectStorage = new ObjectStorageService();

// Accepted image MIME types + max size for sample progress photos.
const ACCEPTED_IMAGE_MIMES = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/webp",
  "image/heic", "image/heif",
]);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20 MB

function isValidImageBytes(bytes: Buffer, contentType: string): boolean {
  if (contentType === "image/jpeg" || contentType === "image/jpg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === "image/png") {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (contentType === "image/webp") {
    return bytes.length >= 12 && bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
  }
  if (contentType === "image/heic" || contentType === "image/heif") {
    return bytes.length >= 12 && bytes.subarray(4, 8).toString() === "ftyp";
  }
  return false;
}

/**
 * Loads a sample order and authorizes the caller against the existing
 * seller/manufacturer model (mirrors the /advance route). Returns the order
 * row (with mfrClerkId) or null if not found / unauthorized.
 */
async function loadAuthorizedOrder(orderId: string, clerkUserId: string) {
  const [row] = await db
    .select({ order: sampleOrders, mfrClerkId: manufacturers.clerkId })
    .from(sampleOrders)
    .leftJoin(manufacturers, eq(sampleOrders.manufacturerId, manufacturers.id))
    .where(eq(sampleOrders.id, orderId))
    .limit(1);

  if (!row) return { status: 404 as const, order: null };

  const isSeller       = row.order.sellerId === clerkUserId;
  const isManufacturer = row.mfrClerkId === clerkUserId;
  if (!isSeller && !isManufacturer) return { status: 403 as const, order: null };

  return { status: 200 as const, order: row.order };
}

const ORDER_STAGES = [
  "payment_received",
  "processing",
  "cut_and_sew",
  "packing",
  "shipped",
  "delivered",
] as const;

function orderNotificationContext(order: Pick<typeof sampleOrders.$inferSelect, "id" | "orderType">) {
  const isBulk = order.orderType === "bulk";
  return {
    targetType: isBulk ? "bulk_order" : "sample_order",
    sellerCta: isBulk ? `/bulk-orders/${order.id}` : `/sample-orders/${order.id}`,
    manufacturerCta: `/manufacturers/orders/${order.id}`,
  };
}

export function isDefinitiveTransferRejection(error: unknown) {
  const statusCode = (error as { statusCode?: number } | null)?.statusCode;
  return statusCode != null && statusCode >= 400 && statusCode < 500
    && statusCode !== 409 && statusCode !== 429;
}

export function isAllowedCheckoutReturnUrl(value: unknown): value is string {
  return isAllowedBrandthreadCallbackUrl(value, "sample_checkout");
}

// ── GET /api/sample-orders ────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const rows = await db
      .select({
        order:        sampleOrders,
        mfrName:      manufacturers.businessName,
        mfrCountry:   manufacturers.country,
      })
      .from(sampleOrders)
      .leftJoin(manufacturers, eq(sampleOrders.manufacturerId, manufacturers.id))
      .where(eq(sampleOrders.sellerId, sellerId))
      .orderBy(desc(sampleOrders.createdAt));

    res.json(rows.map(r => ({
      ...r.order,
      manufacturerName:    r.mfrName,
      manufacturerCountry: r.mfrCountry,
      createdAt: r.order.createdAt.toISOString(),
      updatedAt: r.order.updatedAt.toISOString(),
      shippedAt: r.order.shippedAt?.toISOString() ?? null,
      deliveredAt: r.order.deliveredAt?.toISOString() ?? null,
    })));
  } catch (err) {
    req.log.error({ err }, "Failed to list sample orders");
    res.status(500).json({ error: "Failed to list orders" });
  }
});

// ── POST /api/sample-orders ────────────────────────────────────────────────────
// Creates order + Stripe PaymentIntent (manufacturer must have Connect account).

router.post("/", async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const parsed = CreateProductionOrderBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
    const { clientRequestId, manufacturerId, threadId, orderType, title, description, quantity, priceCents, notes } = parsed.data;
    const [duplicate] = await db.select().from(sampleOrders).where(and(
      eq(sampleOrders.sellerId, sellerId),
      eq(sampleOrders.clientRequestId, clientRequestId),
    )).limit(1);
    if (duplicate) {
      if (duplicate.manufacturerId !== manufacturerId || duplicate.threadId !== (threadId ?? null)
        || duplicate.orderType !== orderType || duplicate.title !== title
        || duplicate.quantity !== quantity || duplicate.priceCents !== priceCents) {
        res.status(409).json({ error: "clientRequestId was already used for a different order" });
        return;
      }
      res.json({ ...duplicate, createdAt: duplicate.createdAt.toISOString(), updatedAt: duplicate.updatedAt.toISOString() });
      return;
    }

    const [mfr] = await db
      .select({
        stripeAccountId: manufacturers.stripeAccountId,
        paymentSetup: manufacturers.paymentSetup,
        clerkId: manufacturers.clerkId,
        businessName: manufacturers.businessName,
      })
      .from(manufacturers)
      .where(eq(manufacturers.id, manufacturerId))
      .limit(1);

    if (!mfr) { res.status(404).json({ error: "Manufacturer not found" }); return; }
    await db.insert(manufacturerRelationships).values({ sellerId, manufacturerId })
      .onConflictDoNothing();
    if (threadId != null) {
      const [thread] = await db.select({ id: manufacturerThreads.id }).from(manufacturerThreads)
        .where(and(
          eq(manufacturerThreads.id, threadId),
          eq(manufacturerThreads.manufacturerId, manufacturerId),
          eq(manufacturerThreads.buyerClerkId, sellerId),
        )).limit(1);
      if (!thread) { res.status(403).json({ error: "threadId is not an authorized thread for this manufacturer" }); return; }
    }

    const platformFeeCents = computeApplicationFeeCents(priceCents);
    const [order] = await db
      .insert(sampleOrders)
      .values({
        manufacturerId,
        sellerId,
        clientRequestId,
        threadId:  threadId ?? null,
        orderType,
        title,
        description: description ?? null,
        quantity,
        priceCents,
        platformFeeCents,
        stripePaymentIntentId: null,
        notes: notes ?? null,
        status: "pending_payment",
      }).onConflictDoNothing()
      .returning();
    if (!order) {
      const [existing] = await db.select().from(sampleOrders).where(and(
        eq(sampleOrders.sellerId, sellerId),
        eq(sampleOrders.clientRequestId, clientRequestId),
      )).limit(1);
      if (!existing) { res.status(409).json({ error: "Order request conflicted; refresh and retry" }); return; }
      res.json({ ...existing, createdAt: existing.createdAt.toISOString(), updatedAt: existing.updatedAt.toISOString() });
      return;
    }

    if (mfr.clerkId) {
      const notificationContext = orderNotificationContext(order);
      await publishNotification({
        userId: mfr.clerkId,
        category: "production",
        type: "manufacturer_sample_request",
        title: `New ${orderType} request`,
        body: title,
        actorName: (req as any).clerkUserName ?? "Seller",
        targetId: order.id,
        targetType: notificationContext.targetType,
        cta: notificationContext.manufacturerCta,
      }).catch((error) => req.log.error({ err: error, orderId: order.id }, "Sample request notification failed"));
    }

    res.status(201).json({
      ...order,
      hasConnect:  !!mfr.stripeAccountId,
      manufacturerPayoutReady: mfr.paymentSetup,
      createdAt:   order.createdAt.toISOString(),
      updatedAt:   order.updatedAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create sample order");
    res.status(500).json({ error: "Failed to create order" });
  }
});

// Creates the single card-charge path for sample and bulk order cards
// (card, Apple Pay and Google Pay via Stripe Checkout). The Checkout Session is
// deterministic per order so retries/concurrent presses reuse Stripe's session.
router.post("/:id/checkout-session", async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const { returnUrl } = req.body ?? {};
    if (!isAllowedCheckoutReturnUrl(returnUrl)) {
      res.status(400).json({ error: "returnUrl must be an allowed Brandthread app or web URL" }); return;
    }
    const [row] = await db.select({
      order: sampleOrders,
      stripeAccountId: manufacturers.stripeAccountId,
      manufacturerName: manufacturers.businessName,
    })
      .from(sampleOrders).leftJoin(manufacturers, eq(sampleOrders.manufacturerId, manufacturers.id))
      .where(and(eq(sampleOrders.id, req.params.id), eq(sampleOrders.sellerId, sellerId))).limit(1);
    if (!row) { res.status(404).json({ error: "Order not found" }); return; }
    if (row.order.status !== "pending_payment" || row.order.walletPaymentState !== "pending") {
      res.status(409).json({ error: "Order is not awaiting payment" }); return;
    }
    if (!row.stripeAccountId) { res.status(409).json({ error: "Manufacturer cannot receive card payment" }); return; }
    const stripe = requireStripe();
    const connectedAccount = await stripe.accounts.retrieve(row.stripeAccountId);
    // Cross-border "recipient" accounts never have charges enabled; destination
    // charges only need transfers + payouts, which connectReadiness accounts for.
    if (connectedAccount.deleted || !connectReadiness(connectedAccount).ready) {
      res.status(409).json({
        error: "Manufacturer payouts are not ready",
        code: "MANUFACTURER_PAYOUTS_INCOMPLETE",
        recovery: "Ask the manufacturer to complete Stripe verification and add an eligible bank account.",
      });
      return;
    }
    let checkoutSessionVersion = row.order.checkoutSessionVersion;
    if (row.order.stripeCheckoutSessionId) {
      const session = await stripe.checkout.sessions.retrieve(row.order.stripeCheckoutSessionId);
      // A paid/complete session must never be replaced; confirmation owns the
      // order transition. An open session is safely reusable.
      if (session.payment_status === "paid" || session.status === "complete" || session.status === "open") {
        res.json({ sessionId: session.id, url: session.url, paymentStatus: session.payment_status }); return;
      }
      // Expired/unpaid sessions are atomically detached. The incremented
      // version makes replacement idempotency distinct from the expired call.
      const [rotated] = await db.update(sampleOrders).set({
        stripeCheckoutSessionId: null,
        checkoutSessionVersion: sql`${sampleOrders.checkoutSessionVersion} + 1`,
        updatedAt: new Date(),
      }).where(and(
        eq(sampleOrders.id, row.order.id),
        eq(sampleOrders.status, "pending_payment"),
        eq(sampleOrders.stripeCheckoutSessionId, row.order.stripeCheckoutSessionId),
      )).returning({ checkoutSessionVersion: sampleOrders.checkoutSessionVersion });
      if (rotated) {
        checkoutSessionVersion = rotated.checkoutSessionVersion;
      } else {
        // Another request rotated/persisted a replacement. Re-read it rather
        // than returning the old expired session.
        const [current] = await db.select({
          stripeCheckoutSessionId: sampleOrders.stripeCheckoutSessionId,
          checkoutSessionVersion: sampleOrders.checkoutSessionVersion,
        }).from(sampleOrders).where(eq(sampleOrders.id, row.order.id)).limit(1);
        if (current?.stripeCheckoutSessionId) {
          const replacement = await stripe.checkout.sessions.retrieve(current.stripeCheckoutSessionId);
          res.json({ sessionId: replacement.id, url: replacement.url, paymentStatus: replacement.payment_status }); return;
        }
        checkoutSessionVersion = current?.checkoutSessionVersion ?? checkoutSessionVersion;
      }
    }
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "usd", unit_amount: row.order.priceCents,
          product_data: {
            name: `${row.order.orderType === "bulk" ? "Bulk order" : "Sample"}: ${row.order.title}`,
            description: [
              `${row.order.quantity.toLocaleString("en-US")} ${row.order.quantity === 1 ? "piece" : "pieces"}`,
              row.manufacturerName ? `made by ${row.manufacturerName}` : null,
              row.order.description,
            ].filter(Boolean).join(" · ").slice(0, 500),
          },
        },
      }],
      success_url: returnUrl.includes("?") ? `${returnUrl}&checkout_session_id={CHECKOUT_SESSION_ID}` : `${returnUrl}?checkout_session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: returnUrl,
      payment_intent_data: {
        application_fee_amount: row.order.platformFeeCents,
        transfer_data: { destination: row.stripeAccountId },
        metadata: { sampleOrderId: row.order.id, sellerId, manufacturerId: row.order.manufacturerId },
      },
      metadata: { sampleOrderId: row.order.id, sellerId },
    }, { idempotencyKey: `sample-order-checkout/${row.order.id}/v${checkoutSessionVersion}` });
    const [persisted] = await db.update(sampleOrders).set({
      stripeCheckoutSessionId: session.id, updatedAt: new Date(),
    }).where(and(
      eq(sampleOrders.id, row.order.id),
      eq(sampleOrders.status, "pending_payment"),
      sql`${sampleOrders.stripeCheckoutSessionId} IS NULL`,
      eq(sampleOrders.checkoutSessionVersion, checkoutSessionVersion),
    ))
      .returning({ stripeCheckoutSessionId: sampleOrders.stripeCheckoutSessionId });
    if (persisted) {
      res.status(201).json({ sessionId: persisted.stripeCheckoutSessionId, url: session.url, paymentStatus: session.payment_status }); return;
    }
    const [current] = await db.select({ stripeCheckoutSessionId: sampleOrders.stripeCheckoutSessionId })
      .from(sampleOrders).where(eq(sampleOrders.id, row.order.id)).limit(1);
    if (current?.stripeCheckoutSessionId) {
      const replacement = await stripe.checkout.sessions.retrieve(current.stripeCheckoutSessionId);
      res.json({ sessionId: replacement.id, url: replacement.url, paymentStatus: replacement.payment_status }); return;
    }
    res.status(409).json({ error: "Checkout session changed; retry" });
  } catch (err) {
    req.log.error({ err, orderId: req.params.id }, "Failed to create sample Checkout Session");
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// Confirms that Stripe actually collected the seller payment. This endpoint is
// idempotent: a notification is emitted only when transitioning into paid state.
router.post("/:id/pay", async (req, res) => {
  try {
    const stripe = requireStripe();
    const sellerId = (req as any).clerkUserId as string;
    const [row] = await db.select({
      order: sampleOrders,
      mfrClerkId: manufacturers.clerkId,
      mfrName: manufacturers.businessName,
    }).from(sampleOrders)
      .leftJoin(manufacturers, eq(sampleOrders.manufacturerId, manufacturers.id))
      .where(and(eq(sampleOrders.id, req.params.id), eq(sampleOrders.sellerId, sellerId)))
      .limit(1);
    if (!row) { res.status(404).json({ error: "Order not found" }); return; }
    let paymentStatus: string;
    if (row.order.stripeCheckoutSessionId) {
      const session = await stripe.checkout.sessions.retrieve(row.order.stripeCheckoutSessionId);
      paymentStatus = session.payment_status;
      if (paymentStatus !== "paid") {
        res.status(409).json({ error: "Payment has not succeeded", paymentStatus }); return;
      }
    } else if (row.order.stripePaymentIntentId) {
      const intent = await stripe.paymentIntents.retrieve(row.order.stripePaymentIntentId);
      paymentStatus = intent.status;
      if (paymentStatus !== "succeeded") {
        res.status(409).json({ error: "Payment has not succeeded", paymentStatus }); return;
      }
    } else {
      res.status(409).json({ error: "Order has no payment session to confirm" }); return;
    }
    const [updated] = await db.update(sampleOrders)
      .set({ status: "payment_received", updatedAt: new Date() })
      .where(and(
        eq(sampleOrders.id, row.order.id),
        eq(sampleOrders.status, "pending_payment"),
      )).returning();
    if (!updated) {
      const [reconciled] = await db.select().from(sampleOrders)
        .where(eq(sampleOrders.id, row.order.id)).limit(1);
      if (reconciled?.status === "payment_received") {
        res.json({
          ...reconciled,
          paymentStatus,
          createdAt: reconciled.createdAt.toISOString(),
          updatedAt: reconciled.updatedAt.toISOString(),
        });
        return;
      }
      res.status(409).json({ error: "Order is no longer awaiting payment" }); return;
    }
    await db.insert(manufacturerActivityEvents).values({
      manufacturerId: row.order.manufacturerId,
      sampleOrderId: row.order.id,
      actorClerkId: sellerId,
      category: "payment",
      type: "payment_received",
      amountCents: row.order.priceCents,
      providerEventId: `checkout:${row.order.stripeCheckoutSessionId ?? row.order.stripePaymentIntentId}`,
      metadata: { source: "seller_confirmation", orderType: row.order.orderType },
    }).onConflictDoNothing({ target: manufacturerActivityEvents.providerEventId });
    if (row.mfrClerkId) {
      const notificationContext = orderNotificationContext(row.order);
      await publishNotification({
        userId: row.mfrClerkId, category: "production", type: "manufacturer_payment_received",
        title: "Payment received", body: `${row.order.title} is ready for production.`,
        targetId: row.order.id, targetType: notificationContext.targetType,
        cta: notificationContext.manufacturerCta,
      }).catch((error) => req.log.error({ err: error, orderId: row.order.id }, "Payment notification failed"));
    }
    res.json({ ...updated, paymentStatus, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() });
  } catch (err) {
    req.log.error({ err, orderId: req.params.id }, "Failed to confirm sample order payment");
    res.status(500).json({ error: "Failed to confirm payment" });
  }
});

// ── GET /api/sample-orders/:id ────────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  try {
    const clerkUserId = (req as any).clerkUserId as string;
    const auth = await loadAuthorizedOrder(req.params.id, clerkUserId);
    if (auth.status === 404) { res.status(404).json({ error: "Not found" }); return; }
    if (auth.status === 403) { res.status(403).json({ error: "Forbidden" }); return; }

    const [row] = await db
      .select({
        order:      sampleOrders,
        mfrName:    manufacturers.businessName,
        mfrCountry: manufacturers.country,
        mfrStripe:  manufacturers.stripeAccountId,
        mfrPaymentReady: manufacturers.paymentSetup,
        mfrTimeZone: manufacturers.timeZone,
      })
      .from(sampleOrders)
      .leftJoin(manufacturers, eq(sampleOrders.manufacturerId, manufacturers.id))
      .where(eq(sampleOrders.id, req.params.id))
      .limit(1);

    if (!row) { res.status(404).json({ error: "Not found" }); return; }

    const stageIndex = ORDER_STAGES.indexOf(row.order.status as any);

    res.json({
      ...row.order,
      manufacturerName:     row.mfrName,
      manufacturerCountry:  row.mfrCountry,
      manufacturerHasStripe: !!row.mfrStripe,
      manufacturerPayoutReady: row.mfrPaymentReady,
      manufacturerTimeZone: row.mfrTimeZone,
      stageIndex,
      stages: ORDER_STAGES,
      createdAt:  row.order.createdAt.toISOString(),
      updatedAt:  row.order.updatedAt.toISOString(),
      shippedAt:  row.order.shippedAt?.toISOString() ?? null,
      deliveredAt: row.order.deliveredAt?.toISOString() ?? null,
    });
  } catch (err) {
    req.log.error({ err, orderId: req.params.id }, "Failed to get sample order");
    res.status(500).json({ error: "Failed to get order" });
  }
});

// ── PATCH /api/sample-orders/:id/sample-detail ────────────────────────────────
// Persist seller sample-detail decisions and revision requests with the order.
// The tracker predates dedicated review/revision tables, so structured detail is
// kept in the order notes until those entities are introduced.
router.patch("/:id/sample-detail", async (req, res) => {
  try {
    const clerkUserId = (req as any).clerkUserId as string;
    const auth = await loadAuthorizedOrder(req.params.id, clerkUserId);
    if (auth.status === 404) { res.status(404).json({ error: "Not found" }); return; }
    if (auth.status === 403) { res.status(403).json({ error: "Forbidden" }); return; }
    if (auth.order!.sellerId !== clerkUserId) {
      res.status(403).json({ error: "Only the seller can submit sample decisions." }); return;
    }

    const { status, review, revision, expectedRevision } = req.body as {
      status?: string; review?: unknown; revision?: unknown; expectedRevision?: unknown;
    };
    if (typeof expectedRevision !== "number" || !Number.isInteger(expectedRevision) || expectedRevision < 1) {
      res.status(400).json({ error: "expectedRevision is required." }); return;
    }
    if (auth.order!.revision !== expectedRevision) {
      res.status(409).json({
        error: "Sample changed since it was loaded; refresh and review the latest values.",
        code: "STALE_WRITE",
      });
      return;
    }
    if (!review && !revision) {
      res.status(400).json({ error: "A review or revision request is required." }); return;
    }
    if (!["delivered", "review_needed"].includes(auth.order!.status)) {
      res.status(409).json({ error: "Sample must be delivered before a seller decision." }); return;
    }
    const reviewDecision = (review as { decision?: unknown } | undefined)?.decision;
    const expectedStatus = review
      ? reviewDecision === "approved" ? "approved" : reviewDecision === "rejected" ? "rejected" : "revision_requested"
      : "revision_requested";
    if (status !== expectedStatus) {
      res.status(400).json({ error: "Invalid seller decision transition." }); return;
    }
    let details: { review?: unknown; revisions?: unknown[] } = {};
    try { details = JSON.parse(auth.order!.notes ?? "{}"); } catch { /* retain legacy notes separately */ }
    if (review) details.review = review;
    if (revision) details.revisions = [...(details.revisions ?? []), revision];
    const [updated] = await db.update(sampleOrders)
      .set({
        status: expectedStatus,
        notes: JSON.stringify(details),
        updatedAt: new Date(),
        revision: sql`${sampleOrders.revision} + 1`,
      })
      .where(and(
        eq(sampleOrders.id, req.params.id),
        eq(sampleOrders.sellerId, clerkUserId),
        eq(sampleOrders.revision, expectedRevision),
        eq(sampleOrders.status, auth.order!.status),
      ))
      .returning();
    if (!updated) {
      res.status(409).json({
        error: "Sample changed since it was loaded; refresh and review the latest values.",
        code: "STALE_WRITE",
      });
      return;
    }
    const [recipient] = await db.select({
      clerkId: manufacturers.clerkId,
    }).from(manufacturers)
      .where(eq(manufacturers.id, auth.order!.manufacturerId))
      .limit(1);
    if (recipient?.clerkId) {
      const notificationContext = orderNotificationContext(auth.order!);
      await publishNotification({
        userId: recipient.clerkId,
        category: "production",
        type: "manufacturer_order_status",
        title: `${auth.order!.title}: ${expectedStatus.replaceAll("_", " ")}`,
        body: "The seller submitted a sample decision.",
        targetId: auth.order!.id,
        targetType: notificationContext.targetType,
        cta: notificationContext.manufacturerCta,
      }).catch((error) => req.log.error({ err: error, orderId: auth.order!.id }, "Sample decision notification failed"));
    }
    res.json({ ...updated, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() });
  } catch (err) {
    req.log.error({ err, orderId: req.params.id }, "Failed to update sample order detail");
    res.status(500).json({ error: "Failed to update sample detail" });
  }
});

// ── PATCH /api/sample-orders/:id/advance ──────────────────────────────────────
// Manufacturer advances production stage.

router.patch("/:id/advance", async (req, res) => {
  try {
    const clerkUserId = (req as any).clerkUserId as string;

    const [row] = await db
      .select({ order: sampleOrders, mfrClerkId: manufacturers.clerkId })
      .from(sampleOrders)
      .leftJoin(manufacturers, eq(sampleOrders.manufacturerId, manufacturers.id))
      .where(eq(sampleOrders.id, req.params.id))
      .limit(1);

    if (!row) { res.status(404).json({ error: "Not found" }); return; }

    const isManufacturer  = row.mfrClerkId === clerkUserId;
    if (!isManufacturer) {
      res.status(403).json({ error: "Forbidden" }); return;
    }

    const current = row.order.status;
    const idx     = ORDER_STAGES.indexOf(current as any);
    if (idx < 0 || idx >= ORDER_STAGES.length - 1) {
      res.status(400).json({ error: "Already at final stage" }); return;
    }

    const nextStage = ORDER_STAGES[idx + 1];
    if (nextStage === "shipped" && (
      typeof req.body?.trackingNumber !== "string" || !req.body.trackingNumber.trim()
      || typeof req.body?.carrier !== "string" || !req.body.carrier.trim()
    )) {
      res.status(400).json({ error: "carrier and trackingNumber are required when shipping an order" }); return;
    }
    const now       = new Date();
    const extra: Partial<typeof sampleOrders.$inferInsert> = {};
    if (nextStage === "shipped") {
      extra.shippedAt = now;
      extra.trackingNumber = req.body.trackingNumber.trim();
      extra.carrier = req.body.carrier.trim();
    }
    if (nextStage === "delivered") extra.deliveredAt = now;

    const [updated] = await db
      .update(sampleOrders)
      .set({ status: nextStage, ...extra, updatedAt: now, revision: sql`${sampleOrders.revision} + 1` })
      .where(and(eq(sampleOrders.id, req.params.id), eq(sampleOrders.status, current)))
      .returning();
    if (!updated) { res.status(409).json({ error: "Order status changed; refresh and retry" }); return; }
    await afterStageChange({
      order: updated, actorRole: "manufacturer", actorClerkId: clerkUserId,
      fromStatus: current, toStatus: nextStage, carrier: updated.carrier, trackingNumber: updated.trackingNumber,
    }).catch((error) => req.log.error({ err: error, orderId: updated.id }, "Failed to record order stage event"));

    const notificationContext = orderNotificationContext(row.order);
    await publishNotification({
      userId: row.order.sellerId, category: "production", type: "manufacturer_order_status",
      title: `${row.order.title} is now ${nextStage.replaceAll("_", " ")}`,
      body: "Your manufacturer updated the order status.",
      targetId: row.order.id,
      targetType: notificationContext.targetType,
      cta: notificationContext.sellerCta,
    }).catch((error) => req.log.error({ err: error, orderId: row.order.id }, "Order status notification failed"));

    res.json({
      ...updated,
      createdAt:  updated.createdAt.toISOString(),
      updatedAt:  updated.updatedAt.toISOString(),
      shippedAt:  updated.shippedAt?.toISOString() ?? null,
      deliveredAt: updated.deliveredAt?.toISOString() ?? null,
    });
  } catch (err) {
    req.log.error({ err, orderId: req.params.id }, "Failed to advance sample order stage");
    res.status(500).json({ error: "Failed to advance stage" });
  }
});

// ── PATCH /api/sample-orders/:id/tracking ─────────────────────────────────────
// Manufacturer records tracking only once production has reached packing. Stripe
// destination charges already route payment to Connect; creating a Transfer here
// would duplicate the settlement and is intentionally not performed.

router.patch("/:id/tracking", async (req, res) => {
  try {
    const clerkUserId = (req as any).clerkUserId as string;
    const { trackingNumber, carrier } = req.body;

    if (!trackingNumber) {
      res.status(400).json({ error: "trackingNumber required" }); return;
    }

    const [row] = await db
      .select({
        order: sampleOrders,
        mfrClerkId: manufacturers.clerkId,
      })
      .from(sampleOrders)
      .leftJoin(manufacturers, eq(sampleOrders.manufacturerId, manufacturers.id))
      .where(eq(sampleOrders.id, req.params.id))
      .limit(1);

    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    if (row.mfrClerkId !== clerkUserId) { res.status(403).json({ error: "Forbidden" }); return; }

    const order = row.order;
    if (order.status !== "packing") {
      res.status(409).json({ error: "Tracking can only be added when the order is packing" }); return;
    }
    const now   = new Date();

    const [updated] = await db
      .update(sampleOrders)
      .set({
        trackingNumber,
        carrier:         carrier ?? null,
        status:          "shipped",
        shippedAt:       now,
        updatedAt:       now,
        revision:        sql`${sampleOrders.revision} + 1`,
      })
      .where(and(eq(sampleOrders.id, req.params.id), eq(sampleOrders.status, "packing")))
      .returning();
    if (!updated) { res.status(409).json({ error: "Order status changed; refresh and retry" }); return; }
    await afterStageChange({
      order: updated, actorRole: "manufacturer", actorClerkId: clerkUserId,
      fromStatus: "packing", toStatus: "shipped", carrier: updated.carrier, trackingNumber: updated.trackingNumber,
    }).catch((error) => req.log.error({ err: error, orderId: updated.id }, "Failed to record order stage event"));

    res.json({
      ...updated,
      createdAt:   updated.createdAt.toISOString(),
      updatedAt:   updated.updatedAt.toISOString(),
      shippedAt:   updated.shippedAt?.toISOString() ?? null,
      deliveredAt: updated.deliveredAt?.toISOString() ?? null,
    });
  } catch (err) {
    req.log.error({ err, orderId: req.params.id }, "Failed to add sample order tracking");
    res.status(500).json({ error: "Failed to add tracking" });
  }
});

// ── GET /api/sample-orders/:id/payment-options ────────────────────────────────
router.get("/:id/payment-options", async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const [order] = await db.select().from(sampleOrders).where(and(
      eq(sampleOrders.id, req.params.id), eq(sampleOrders.sellerId, sellerId),
    )).limit(1);
    if (!order) { res.status(404).json({ error: "Order not found" }); return; }
    if (order.orderType !== "bulk" || order.status !== "pending_payment" || order.walletPaymentState !== "pending") {
      res.status(409).json({ error: "Order is not eligible for wallet payment" }); return;
    }
    const wallets = await db.select().from(dropWallets).where(eq(dropWallets.sellerId, sellerId));
    res.json({
      orderId: order.id,
      requiredCents: order.priceCents,
      wallets: wallets.map((wallet) => {
        const availableCents = wallet.balanceCents - wallet.releasedCents - wallet.reservedCents;
        return {
          id: wallet.id, dropId: wallet.dropId, availableCents,
          eligible: availableCents >= order.priceCents,
        };
      }),
    });
  } catch (err) {
    req.log.error({ err, orderId: req.params.id }, "Failed to list wallet payment options");
    res.status(500).json({ error: "Failed to list payment options" });
  }
});

// ── POST /api/sample-orders/:id/pay-from-wallet ───────────────────────────────
// Seller pays a bulk order from their drop wallet (no new card charge).

router.post("/:id/pay-from-wallet", async (req, res) => {
  try {
    const stripe   = requireStripe();
    const sellerId = (req as any).clerkUserId as string;
    const { walletId } = req.body;

    if (!walletId) { res.status(400).json({ error: "walletId required" }); return; }

    const [row] = await db
      .select({
        order:       sampleOrders,
        mfrStripeId: manufacturers.stripeAccountId,
        mfrClerkId: manufacturers.clerkId,
        wallet:      dropWallets,
      })
      .from(sampleOrders)
      .leftJoin(manufacturers, eq(sampleOrders.manufacturerId, manufacturers.id))
      .leftJoin(dropWallets, eq(dropWallets.id, walletId))
      .where(and(eq(sampleOrders.id, req.params.id), eq(sampleOrders.sellerId, sellerId)))
      .limit(1);

    if (!row?.order) { res.status(404).json({ error: "Order not found" }); return; }
    if (!row.wallet) { res.status(404).json({ error: "Wallet not found" }); return; }

    const order  = row.order;
    const wallet = row.wallet;
    if (order.orderType !== "bulk" || order.status !== "pending_payment" || order.stripeTransferId
      || !["pending", "processing"].includes(order.walletPaymentState)) {
      res.status(409).json({ error: "This bulk order is not eligible for wallet payment" }); return;
    }
    if (wallet.sellerId !== sellerId) { res.status(403).json({ error: "Wallet does not belong to you" }); return; }
    // Held preorder money can only fund production while its drop is live;
    // a failing or finished drop's money belongs to refunds / releases.
    const [walletDrop] = await db.select({ escrowState: drops.escrowState })
      .from(drops).where(eq(drops.id, wallet.dropId)).limit(1);
    if (!walletDrop?.escrowState || !(DROP_OPEN_STATES as readonly string[]).includes(walletDrop.escrowState)) {
      res.status(409).json({
        error: "This drop's held funds can no longer pay for production",
        code: "DROP_FUNDS_UNAVAILABLE",
      });
      return;
    }
    if (!row.mfrStripeId) { res.status(409).json({ error: "Manufacturer cannot receive wallet payment" }); return; }
    const connectedAccount = await stripe.accounts.retrieve(row.mfrStripeId);
    if (connectedAccount.deleted || !connectedAccount.charges_enabled
      || !connectedAccount.payouts_enabled || !connectedAccount.details_submitted) {
      res.status(409).json({
        error: "Manufacturer payouts are not ready",
        code: "MANUFACTURER_PAYOUTS_INCOMPLETE",
        recovery: "Ask the manufacturer to complete Stripe verification and add an eligible bank account.",
      });
      return;
    }
    const attemptKey = order.walletPaymentAttemptKey ?? `sample-order-wallet/${order.id}`;
    if (order.walletPaymentState === "processing" && order.walletId !== walletId) {
      res.status(409).json({ error: "Payment is already processing from a different wallet" }); return;
    }

    // Claim the order and reserve funds together before calling Stripe. Both
    // predicates are conditional, so replayed/concurrent requests cannot pay it.
    const claimed = order.walletPaymentState === "processing" ? true : await db.transaction(async (tx) => {
      const [claim] = await tx.update(sampleOrders).set({
        walletPaymentState: "processing", walletPaymentAttemptKey: attemptKey,
        walletId, updatedAt: new Date(),
      }).where(and(
        eq(sampleOrders.id, order.id), eq(sampleOrders.sellerId, sellerId),
        eq(sampleOrders.orderType, "bulk"), eq(sampleOrders.status, "pending_payment"),
        eq(sampleOrders.walletPaymentState, "pending"),
        sql`${sampleOrders.walletId} IS NULL`, sql`${sampleOrders.stripeTransferId} IS NULL`,
      )).returning({ id: sampleOrders.id });
      if (!claim) return false;
      await lockDrop(tx, wallet.dropId);
      const [reserved] = await tx.update(dropWallets).set({
        reservedCents: sql`${dropWallets.reservedCents} + ${order.priceCents}`,
        updatedAt: new Date(),
      }).where(and(eq(dropWallets.id, walletId), eq(dropWallets.sellerId, sellerId),
        sql`${dropWallets.balanceCents} - ${dropWallets.releasedCents} - ${dropWallets.reservedCents} >= ${order.priceCents}`,
      )).returning({ id: dropWallets.id });
      if (!reserved) throw new Error("INSUFFICIENT_WALLET");
      return true;
    }).catch((error) => {
      if ((error as Error).message === "INSUFFICIENT_WALLET") return false;
      throw error;
    });
    if (!claimed) { res.status(409).json({ error: "Wallet funds unavailable or payment already in progress" }); return; }

    let stripeTransferId: string;
    try {
      const transfer = await stripe.transfers.create({
        amount: order.priceCents, currency: "usd", destination: row.mfrStripeId,
        transfer_group: wallet.stripeTransferGroup ?? `drop_${wallet.dropId}`,
        metadata: { sampleOrderId: order.id, sellerId, paymentSource: "drop_wallet" },
      }, { idempotencyKey: attemptKey });
      stripeTransferId = transfer.id;
    } catch (error) {
      // A 4xx request error (other than conflict/rate limiting) is definitive:
      // Stripe rejected the transfer before creation. Network/5xx/ambiguous
      // errors retain processing+reservation so retry reconciles via the same key.
      const definitivelyRejected = isDefinitiveTransferRejection(error);
      if (definitivelyRejected) {
        await db.transaction(async (tx) => {
          const [released] = await tx.update(sampleOrders).set({
            walletPaymentState: "pending", walletId: null, updatedAt: new Date(),
          }).where(and(
            eq(sampleOrders.id, order.id), eq(sampleOrders.walletPaymentState, "processing"),
            eq(sampleOrders.walletPaymentAttemptKey, attemptKey),
          )).returning({ id: sampleOrders.id });
          if (released) {
            await tx.update(dropWallets).set({
              reservedCents: sql`GREATEST(${dropWallets.reservedCents} - ${order.priceCents}, 0)`,
              updatedAt: new Date(),
            }).where(and(eq(dropWallets.id, walletId), eq(dropWallets.sellerId, sellerId)));
          }
        });
      }
      throw error;
    }

    const reconciliation = await db.transaction(async (tx) => {
      const finalized = await tx.update(sampleOrders).set({
        walletId, stripeTransferId, walletPaymentState: "paid", status: "payment_received", updatedAt: new Date(),
      }).where(and(eq(sampleOrders.id, order.id), eq(sampleOrders.walletPaymentState, "processing")))
        .returning();
      let reconciled = finalized[0];
      if (reconciled) {
        await lockDrop(tx, wallet.dropId);
        await tx.update(dropWallets).set({
          releasedCents: sql`${dropWallets.releasedCents} + ${order.priceCents}`,
          reservedCents: sql`GREATEST(${dropWallets.reservedCents} - ${order.priceCents}, 0)`,
          updatedAt: new Date(),
        }).where(and(eq(dropWallets.id, walletId), eq(dropWallets.sellerId, sellerId)));
        await tx.insert(dropWalletTransactions).values({
          walletId, type: "bulk_payment", amountCents: order.priceCents,
          sampleOrderId: order.id, description: `Bulk order payment: ${order.title}`, stripeTransferId,
        }).onConflictDoNothing();
        await recordBulkPaidFromHeld(tx, {
          sampleOrderId: order.id,
          dropId: wallet.dropId,
          sellerId,
          manufacturerId: order.manufacturerId,
          amountCents: order.priceCents,
          transferId: stripeTransferId,
        });
      } else {
        [reconciled] = await tx.select().from(sampleOrders).where(and(
          eq(sampleOrders.id, order.id),
          eq(sampleOrders.status, "payment_received"),
          eq(sampleOrders.walletPaymentState, "paid"),
          eq(sampleOrders.stripeTransferId, stripeTransferId),
        )).limit(1);
        if (!reconciled) throw new Error("WALLET_FINALIZE_CONFLICT");
      }
      const existingPayment = await tx.select({ id: manufacturerActivityEvents.id })
        .from(manufacturerActivityEvents).where(and(
          eq(manufacturerActivityEvents.sampleOrderId, order.id),
          eq(manufacturerActivityEvents.type, "payment_received"),
        )).limit(1);
      const [notificationOwner] = existingPayment.length ? [] : await tx.insert(manufacturerActivityEvents).values({
        manufacturerId: order.manufacturerId,
        sampleOrderId: order.id,
        actorClerkId: sellerId,
        category: "payment",
        type: "payment_received",
        amountCents: order.priceCents,
        providerEventId: `transfer:${stripeTransferId}`,
        metadata: { source: "drop_wallet", orderType: order.orderType, notificationOwner: "request" },
      }).onConflictDoNothing({ target: manufacturerActivityEvents.providerEventId })
        .returning({ id: manufacturerActivityEvents.id });
      return { order: reconciled, ownsNotification: !!notificationOwner };
    });
    if (row.mfrClerkId && reconciliation.ownsNotification) {
      const notificationContext = orderNotificationContext(order);
      await publishNotification({
        userId: row.mfrClerkId, category: "production", type: "manufacturer_payment_received",
        title: "Payment received", body: `${order.title} is ready for production.`,
        targetId: order.id, targetType: notificationContext.targetType,
        cta: notificationContext.manufacturerCta,
      }).catch((error) => req.log.error({ err: error, orderId: order.id }, "Wallet payment notification failed"));
    }

    res.json({
      ...reconciliation.order,
      paidFromWallet: true,
      createdAt: reconciliation.order.createdAt.toISOString(),
      updatedAt: reconciliation.order.updatedAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err, orderId: req.params.id }, "Failed to pay sample order from wallet");
    res.status(500).json({ error: "Failed to pay from wallet" });
  }
});

// ── POST /api/sample-orders/:id/images/request-upload ────────────────────────
// Returns a presigned GCS PUT URL plus the normalized objectPath. The client
// never parses the signed URL — the server supplies objectPath authoritatively.

router.post("/:id/images/request-upload", async (_req, res) => {
  res.status(410).json({ error: "Direct image uploads are no longer supported. Use the authenticated upload endpoint." });
});

// ── POST /api/sample-orders/:id/images/upload ─────────────────────────────────
// A raw, authenticated upload avoids an unconstrained client-direct storage write.
// The parser rejects bodies above 20 MB before any object is created.
router.post("/:id/images/upload", express.raw({ type: "image/*", limit: MAX_IMAGE_BYTES }), async (req, res) => {
  try {
    const clerkUserId = (req as any).clerkUserId as string;
    const contentType = String(req.headers["content-type"] ?? "").split(";")[0].toLowerCase();
    const bytes = req.body as Buffer;

    if (!contentType || !ACCEPTED_IMAGE_MIMES.has(contentType)) {
      res.status(400).json({
        error: `Invalid content type. Accepted: ${[...ACCEPTED_IMAGE_MIMES].join(", ")}`,
      });
      return;
    }
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
      res.status(400).json({ error: `Image too large. Maximum ${MAX_IMAGE_BYTES / 1024 / 1024} MB.` });
      return;
    }
    if (!isValidImageBytes(bytes, contentType)) {
      res.status(400).json({ error: "Uploaded file content does not match its image type." });
      return;
    }

    const auth = await loadAuthorizedOrder(req.params.id, clerkUserId);
    if (auth.status === 404) { res.status(404).json({ error: "Order not found" }); return; }
    if (auth.status === 403) { res.status(403).json({ error: "Forbidden" }); return; }

    const objectPath = await objectStorage.createObjectEntityFromBuffer(bytes, contentType);
    try {
      try {
        await objectStorage.trySetObjectEntityAclPolicy(objectPath, { owner: clerkUserId, visibility: "private" });
      } catch (error) {
        await objectStorage.deleteObjectEntity(objectPath).catch(() => undefined);
        throw error;
      }
      let updated: { imageUrls: unknown; revision: number } | undefined;
      try {
        [updated] = await db.update(sampleOrders)
          .set({
            // Append inside PostgreSQL rather than reading/replacing JSON in the
            // request. Parallel uploads therefore preserve every object path.
            imageUrls: sql`(COALESCE(${sampleOrders.imageUrls}::jsonb, '[]'::jsonb) || jsonb_build_array(${objectPath}::text))::json`,
            updatedAt: new Date(),
            revision: sql`${sampleOrders.revision} + 1`,
          })
          .where(eq(sampleOrders.id, req.params.id))
          .returning({ imageUrls: sampleOrders.imageUrls, revision: sampleOrders.revision });
      } catch (error) {
        await objectStorage.deleteObjectEntity(objectPath).catch(() => undefined);
        throw error;
      }
      if (!updated) {
        await objectStorage.deleteObjectEntity(objectPath).catch(() => undefined);
        res.status(409).json({
          error: "Order changed while the image was uploading; refresh and retry.",
          code: "STALE_WRITE",
        });
        return;
      }
      const imageUrls = await Promise.all((updated.imageUrls as string[]).map(p => objectStorage.getObjectEntityDownloadURL(p)));
      res.status(201).json({ imageUrls, revision: updated.revision });
    } catch (err) {
      throw err;
    }
  } catch (err) {
    req.log.error({ err, orderId: req.params.id }, "Sample order image upload failed");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

// ── POST /api/sample-orders/:id/images ───────────────────────────────────────
// Records an uploaded object path against the order and binds the object's ACL
// owner to the uploading user. Returns fresh signed display URLs.

router.post("/:id/images", async (_req, res) => {
  res.status(410).json({ error: "Direct image attachment is no longer supported. Upload the image through the authenticated upload endpoint." });
});

// ── GET /api/sample-orders/:id/images ─────────────────────────────────────────
// Lists the order's images as short-lived signed GET URLs so React Native
// <Image> can load them directly without an Authorization header.

router.get("/:id/images", async (req, res) => {
  try {
    const clerkUserId = (req as any).clerkUserId as string;

    const auth = await loadAuthorizedOrder(req.params.id, clerkUserId);
    if (auth.status === 404) { res.status(404).json({ error: "Order not found" }); return; }
    if (auth.status === 403) { res.status(403).json({ error: "Forbidden" }); return; }

    const stored: string[] = Array.isArray(auth.order!.imageUrls)
      ? (auth.order!.imageUrls as string[]) : [];
    const displayUrls = await Promise.all(
      stored.map(p => objectStorage.getObjectEntityDownloadURL(p).catch(() => null)),
    );
    res.json({ imageUrls: displayUrls.filter((u): u is string => !!u) });
  } catch (err) {
    req.log.error({ err, orderId: req.params.id }, "Failed to list sample order images");
    res.status(500).json({ error: "Failed to list images" });
  }
});

export default router;
