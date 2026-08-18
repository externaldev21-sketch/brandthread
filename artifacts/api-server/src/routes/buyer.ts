/**
 * Buyer-facing authenticated endpoints.
 * Mounted at /api/buyer — all routes require Clerk auth.
 */
import { Router } from "express";
import {
  db, checkoutSessions, orders, orderItems, productVariants, products, users,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requireStripe, computeApplicationFeeCents, PLATFORM_COMMISSION_RATE, mapStripeError } from "../lib/stripe";

const router = Router();
router.use(requireAuth);

// ─── Startup migration — add tracking_status + estimated_delivery to orders ───
(async () => {
  try {
    await db.execute(sql`
      ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS tracking_status    TEXT,
        ADD COLUMN IF NOT EXISTS estimated_delivery TEXT
    `);
  } catch (err) {
    console.error("[buyer] migration error:", err);
  }
})();

// ─── Checkout ─────────────────────────────────────────────────────────────────

/**
 * POST /api/buyer/checkout/session
 * Body: { items: [{ variantId, productId, quantity }], successUrl, cancelUrl, contactEmail }
 * Returns: { sessionId, url }
 *
 * INVARIANTS:
 *  1. Duplicate variantIds are rejected — client must deduplicate/merge quantities.
 *  2. All items must belong to the same seller (single Connect destination).
 *  3. Seller MUST have an active Stripe Connect account.
 *  4. Cart is persisted server-side in checkout_sessions; only the record UUID
 *     is passed to Stripe, avoiding the 50-key metadata limit.
 */
router.post("/checkout/session", async (req, res) => {
  try {
    const stripe = requireStripe();
    const buyerId = (req as any).clerkUserId as string;
    const { items, successUrl, cancelUrl, contactEmail, shippingAddress, clientIdempotencyKey, dropId } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "items required" });
      return;
    }
    if (!successUrl || !cancelUrl) {
      res.status(400).json({ error: "successUrl and cancelUrl required" });
      return;
    }

    // ── Reject duplicate variantIds up front ──────────────────────────────
    const seenVariants = new Set<string>();
    for (const item of items) {
      if (seenVariants.has(item.variantId)) {
        res.status(400).json({
          error: `Duplicate variantId ${item.variantId}. Merge quantities before checkout.`,
        });
        return;
      }
      seenVariants.add(item.variantId);
    }

    // ── Resolve server-side prices ────────────────────────────────────────
    const lineItems: any[] = [];
    const cartItems: Array<{
      variantId: string;
      productName: string;
      variantLabel: string;
      quantity: number;
      priceCents: number;
    }> = [];
    const sellerIds = new Set<string>();

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const qty = parseInt(item.quantity, 10);
      if (!Number.isInteger(qty) || qty < 1) {
        res.status(400).json({ error: `Item ${i}: quantity must be >= 1` });
        return;
      }

      const [row] = await db
        .select({
          variantId: productVariants.id,
          priceCents: productVariants.priceCents,
          stock: productVariants.stock,
          size: productVariants.size,
          color: productVariants.color,
          productName: products.name,
          productImages: products.images,
          sellerId: products.ownerId,
        })
        .from(productVariants)
        .innerJoin(products, eq(productVariants.productId, products.id))
        .where(
          and(
            eq(productVariants.id, item.variantId),
            eq(products.id, item.productId),
          ),
        )
        .limit(1);

      if (!row) {
        res.status(404).json({ error: `Variant ${item.variantId} not found` });
        return;
      }
      if (row.stock < qty) {
        res.status(400).json({ error: `Insufficient stock for ${row.productName}` });
        return;
      }

      sellerIds.add(row.sellerId);
      if (sellerIds.size > 1) {
        res.status(400).json({
          error:
            "All items must belong to the same seller. Split multi-seller carts into separate checkout sessions.",
        });
        return;
      }

      const variantLabel = [row.size, row.color].filter(Boolean).join(" / ");
      lineItems.push({
        price_data: {
          currency: "usd",
          unit_amount: row.priceCents,
          product_data: {
            name: row.productName,
            ...(variantLabel && { description: variantLabel }),
            ...(Array.isArray(row.productImages) && row.productImages.length > 0
              ? { images: [(row.productImages as string[])[0]] }
              : {}),
          },
        },
        quantity: qty,
      });

      cartItems.push({
        variantId: row.variantId,
        productName: row.productName,
        variantLabel,
        quantity: qty,
        priceCents: row.priceCents,
      });
    }

    // ── Verify seller has an active Connect account ───────────────────────
    const sellerId = [...sellerIds][0];
    const [seller] = await db
      .select({
        stripeAccountId: users.stripeAccountId,
        stripeAccountStatus: users.stripeAccountStatus,
      })
      .from(users)
      .where(eq(users.clerkId, sellerId))
      .limit(1);

    if (!seller?.stripeAccountId) {
      res.status(400).json({
        error: "This seller has not set up a payment account yet. Please try again later.",
      });
      return;
    }
    if (seller.stripeAccountStatus !== "active") {
      res.status(400).json({
        error:
          seller.stripeAccountStatus === "restricted"
            ? "Seller payment account is restricted. Please try again later."
            : "Seller payment account is not yet active. Please try again later.",
      });
      return;
    }

    const hasKey = !!clientIdempotencyKey && typeof clientIdempotencyKey === "string";

    // Validated shipping DTO (set once, used below)
    const validatedShipping = shippingAddress && typeof shippingAddress === "object"
      && shippingAddress.street && shippingAddress.city && shippingAddress.state && shippingAddress.zip
      ? {
          name:    shippingAddress.name ?? undefined,
          street:  shippingAddress.street,
          city:    shippingAddress.city,
          state:   shippingAddress.state,
          zip:     shippingAddress.zip,
          country: shippingAddress.country ?? "US",
        }
      : undefined;

    // ── Server-side idempotency (when client supplies a key) ──────────────
    //
    // Design:
    //  1. Check DB for an existing record with this key.
    //     • Open Stripe session → return it immediately (safe reuse).
    //     • Paid Stripe session (order exists or Stripe says paid) → return it
    //       so the client can proceed to verify/poll without re-charging.
    //     • Expired/cancelled Stripe session → return 410 so the client can
    //       restart checkout with a new key (new checkout session → new idempKey).
    //     • DB record exists but stripeSessionId is null → Stripe creation never
    //       completed; treat the same as expired: return 410.
    //     • No DB record → proceed to create one.
    //  2. Call Stripe BEFORE inserting the DB record.
    //     → A Stripe failure leaves no poisoned DB row; the same key can be
    //       retried immediately and Stripe's own idempotency key returns the
    //       same result if the network had already accepted the request.
    //  3. Upsert the DB record with stripeSessionId already set.
    //     → Concurrent requests that both passed step 1 both call Stripe with
    //       the same idempotency key (identical Stripe session returned).
    //       The ON CONFLICT DO UPDATE merges them into one DB row; both callers
    //       get the same session URL.

    if (hasKey) {
      const [existingCS] = await db
        .select({
          id:              checkoutSessions.id,
          stripeSessionId: checkoutSessions.stripeSessionId,
        })
        .from(checkoutSessions)
        .where(eq(checkoutSessions.clientIdempotencyKey, clientIdempotencyKey))
        .limit(1);

      if (existingCS) {
        if (!existingCS.stripeSessionId) {
          // DB record exists but Stripe never finished — treat as expired.
          res.status(410).json({
            error: "Your previous checkout attempt did not complete. Please retry — your cart is intact.",
            code: "SESSION_INCOMPLETE",
          });
          return;
        }

        // Retrieve the Stripe session to get current status and URL
        let existingStripeSession: any;
        try {
          existingStripeSession = await stripe.checkout.sessions.retrieve(existingCS.stripeSessionId);
        } catch {
          // Stripe retrieve failed — treat as expired to allow a clean retry
          res.status(410).json({
            error: "Could not retrieve your checkout session. Please retry.",
            code: "SESSION_RETRIEVE_FAILED",
          });
          return;
        }

        if (existingStripeSession.status === "open") {
          // Safe to return immediately — buyer hasn't paid yet
          res.json({ sessionId: existingCS.stripeSessionId, url: existingStripeSession.url });
          return;
        }

        if (
          existingStripeSession.payment_status === "paid" ||
          existingStripeSession.status === "complete"
        ) {
          // Already paid — let client proceed to verifySession (webhook may be delayed)
          res.json({
            sessionId: existingCS.stripeSessionId,
            url: existingStripeSession.url ?? "",
          });
          return;
        }

        // Expired or cancelled — buyer must restart checkout with a new key
        res.status(410).json({
          error: "Your checkout session expired. Please review your cart and try again.",
          code: "SESSION_EXPIRED",
        });
        return;
      }
    }

    // ── Compute platform application fee (5% of order subtotal) ──────────
    // For destination charges (regular orders): fee withheld automatically.
    // For escrow/drop orders: fee deducted at transfer time (release-order).
    const subtotalCents = cartItems.reduce(
      (sum, item) => sum + item.priceCents * item.quantity,
      0,
    );
    const applicationFeeCents = computeApplicationFeeCents(subtotalCents);

    // Validate dropId if provided — must be a non-empty string
    const validDropId: string | null =
      dropId && typeof dropId === "string" && dropId.trim() ? dropId.trim() : null;

    // ── Call Stripe FIRST (idempotent via key) — no DB record yet ─────────
    // Drop orders use the "separate charges + transfers" model:
    //   • No transfer_data.destination — charge lands on platform account
    //   • Funds are released to seller via stripe.transfers.create at ship time
    //   • Platform fee is deducted from the transfer amount (not collected here)
    // Regular orders use destination charges:
    //   • transfer_data.destination sends funds directly to seller Connect account
    //   • application_fee_amount keeps the platform commission
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: lineItems,
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: buyerId,
        // metadata.csRef is back-filled after the DB upsert below
        metadata: {
          ...(validDropId ? { dropId: validDropId } : {}),
        },
        payment_intent_data: {
          metadata: { buyerId, ...(validDropId ? { dropId: validDropId } : {}) },
          ...(validDropId
            ? {
                // Escrow model: platform holds the charge until release-order is triggered
              }
            : {
                // Destination charge: funds flow directly to seller Connect account
                transfer_data: { destination: seller.stripeAccountId },
                application_fee_amount: applicationFeeCents,
              }),
        },
        ...(contactEmail ? { customer_email: contactEmail } : {}),
      },
      hasKey ? { idempotencyKey: `cs_${clientIdempotencyKey}` } : {},
    );

    // ── Upsert DB record (cart + stripeSessionId in one shot) ─────────────
    // ON CONFLICT on clientIdempotencyKey covers concurrent requests that both
    // cleared the lookup above and both called Stripe (same session returned).
    // The DO UPDATE just re-applies the same stripeSessionId — safe no-op.
    const insertValues = {
      buyerId,
      sellerId,
      items: cartItems,
      stripeSessionId: session.id,
      ...(validatedShipping ? { shippingAddress: validatedShipping } : {}),
      ...(hasKey ? { clientIdempotencyKey } : {}),
    };

    let csId: string;
    if (hasKey) {
      const [csRecord] = await db
        .insert(checkoutSessions)
        .values(insertValues)
        .onConflictDoUpdate({
          target: checkoutSessions.clientIdempotencyKey,
          set: { stripeSessionId: session.id },
        })
        .returning({ id: checkoutSessions.id });
      csId = csRecord.id;
    } else {
      const [csRecord] = await db
        .insert(checkoutSessions)
        .values(insertValues)
        .returning({ id: checkoutSessions.id });
      csId = csRecord.id;
    }

    // Back-fill csRef in Stripe metadata so the webhook can find the cart row.
    // Best-effort: failure here is non-fatal because the webhook also falls back
    // to looking up by stripe_session_id.
    try {
      await stripe.checkout.sessions.update(session.id, {
        metadata: {
          csRef: csId,
          ...(validDropId ? { dropId: validDropId } : {}),
        },
      });
    } catch (metaErr) {
      console.warn("Could not back-fill csRef metadata on Stripe session:", metaErr);
    }

    res.json({ sessionId: session.id, url: session.url });
  } catch (err: any) {
    // Stripe card errors (e.g. card_declined) → 402 with a buyer-friendly message.
    // Raw Stripe strings must never reach the buyer UI.
    const isStripeCardError =
      err.type === "StripeCardError" ||
      err.code === "card_declined" ||
      err.decline_code != null;
    if (isStripeCardError) {
      res.status(402).json({
        error: mapStripeError(err),
        code: err.decline_code ?? err.code ?? "card_declined",
      });
      return;
    }
    const status = err.status ?? 500;
    if (status < 500) {
      res.status(status).json({ error: err.message });
    } else {
      console.error(err);
      res.status(500).json({ error: "Failed to create checkout session" });
    }
  }
});

/**
 * GET /api/buyer/checkout/session/:sessionId
 * Verify payment status after Stripe redirects back.
 * Returns: { status, paymentStatus, orderId?, orderNumber? }
 */
router.get("/checkout/session/:sessionId", async (req, res) => {
  try {
    const stripe = requireStripe();
    const buyerId = (req as any).clerkUserId as string;
    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);

    if (session.client_reference_id !== buyerId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    // Webhook may be slightly delayed — order may not exist yet
    const [order] = await db
      .select({ id: orders.id, orderNumber: orders.orderNumber, status: orders.status })
      .from(orders)
      .where(eq(orders.stripeCheckoutSessionId, req.params.sessionId))
      .limit(1);

    // If payment was not completed, try to surface a buyer-friendly decline reason
    // by inspecting the PaymentIntent's last_payment_error.
    let declineReason: string | null = null;
    if (session.payment_status !== "paid" && session.payment_intent) {
      try {
        const pi = await stripe.paymentIntents.retrieve(
          session.payment_intent as string,
        );
        if (pi.last_payment_error) {
          declineReason = mapStripeError(pi.last_payment_error as any);
        }
      } catch {
        // Non-fatal — best-effort only; the buyer still sees the generic message
      }
    }

    res.json({
      status:        session.status,
      paymentStatus: session.payment_status,
      amountTotal:   session.amount_total ?? null,  // Stripe's authoritative charged amount in cents
      orderId:       order?.id ?? null,
      orderNumber:   order?.orderNumber ?? null,
      declineReason,
    });
  } catch (err: any) {
    const status = err.status ?? 500;
    if (status < 500) {
      res.status(status).json({ error: err.message });
    } else {
      console.error(err);
      res.status(500).json({ error: "Failed to retrieve session" });
    }
  }
});

// ─── Buyer Orders ─────────────────────────────────────────────────────────────

router.get("/orders", async (req, res) => {
  try {
    const buyerId = (req as any).clerkUserId as string;
    const rows = await db
      .select({
        id:                      orders.id,
        orderNumber:             orders.orderNumber,
        ownerId:                 orders.ownerId,
        sellerDisplayName:       users.displayName,
        status:                  orders.status,
        totalCents:              orders.totalCents,
        subtotalCents:           orders.subtotalCents,
        shippingCents:           orders.shippingCents,
        trackingNumber:          orders.trackingNumber,
        carrier:                 orders.carrier,
        trackingStatus:          orders.trackingStatus,
        estimatedDelivery:       orders.estimatedDelivery,
        shippingAddress:         orders.shippingAddress,
        stripePaymentIntentId:   orders.stripePaymentIntentId,
        createdAt:               orders.createdAt,
      })
      .from(orders)
      .leftJoin(users, eq(users.clerkId, orders.ownerId))
      .where(eq(orders.buyerId, buyerId))
      .orderBy(desc(orders.createdAt));
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

router.get("/orders/:id", async (req, res) => {
  try {
    const buyerId = (req as any).clerkUserId as string;
    const [row] = await db
      .select({
        id:                      orders.id,
        orderNumber:             orders.orderNumber,
        ownerId:                 orders.ownerId,
        sellerDisplayName:       users.displayName,
        status:                  orders.status,
        totalCents:              orders.totalCents,
        subtotalCents:           orders.subtotalCents,
        shippingCents:           orders.shippingCents,
        trackingNumber:          orders.trackingNumber,
        carrier:                 orders.carrier,
        trackingStatus:          orders.trackingStatus,
        estimatedDelivery:       orders.estimatedDelivery,
        shippingAddress:         orders.shippingAddress,
        stripePaymentIntentId:   orders.stripePaymentIntentId,
        cancellationReason:      orders.cancellationReason,
        cancellationNotes:       orders.cancellationNotes,
        createdAt:               orders.createdAt,
      })
      .from(orders)
      .leftJoin(users, eq(users.clerkId, orders.ownerId))
      .where(and(eq(orders.id, req.params.id), eq(orders.buyerId, buyerId)))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    const items = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, row.id));

    res.json({ ...row, items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch order" });
  }
});

// ─── Buyer Order Cancellation ────────────────────────────────────────────────
/**
 * POST /api/buyer/orders/:id/cancel
 * Allows a buyer to cancel their own order within a 60-minute window while
 * the order is still in 'pending' status. Automatically issues a full Stripe
 * refund via the stored payment intent. Fails explicitly if Stripe errors —
 * we never mark an order cancelled without confirming the refund.
 */
router.post("/orders/:id/cancel", async (req, res) => {
  try {
    const buyerId = (req as any).clerkUserId as string;
    const { id }  = req.params;
    const CANCEL_WINDOW_MS = 60 * 60 * 1000; // 60 minutes

    // ── Fetch order — must belong to this buyer ─────────────────────────────
    const [order] = await db
      .select({
        id:                    orders.id,
        orderNumber:           orders.orderNumber,
        status:                orders.status,
        createdAt:             orders.createdAt,
        stripePaymentIntentId: orders.stripePaymentIntentId,
      })
      .from(orders)
      .where(and(eq(orders.id, id), eq(orders.buyerId, buyerId)))
      .limit(1);

    if (!order) {
      res.status(404).json({ error: "Order not found" }); return;
    }

    // ── Only pending orders are cancellable ────────────────────────────────
    if (order.status !== "pending") {
      res.status(409).json({
        error: "Order cannot be cancelled",
        detail: `Only pending orders can be cancelled. Current status: ${order.status}.`,
      }); return;
    }

    // ── Enforce the 60-minute window ────────────────────────────────────────
    const ageMs = Date.now() - new Date(order.createdAt!).getTime();
    if (ageMs > CANCEL_WINDOW_MS) {
      res.status(409).json({
        error: "Cancellation window has closed",
        detail: "Orders can only be cancelled within 60 minutes of placement. Contact the seller to request a cancellation.",
      }); return;
    }

    // ── Refund via Stripe (fail loudly — don't cancel without refunding) ───
    let refunded = false;
    if (order.stripePaymentIntentId) {
      try {
        const stripe = requireStripe();
        await stripe.refunds.create({
          payment_intent: order.stripePaymentIntentId,
          reason: "requested_by_customer",
        });
        refunded = true;
      } catch (stripeErr: any) {
        console.error("[buyerCancel] Stripe refund failed:", stripeErr?.message);
        res.status(502).json({
          error: "Refund could not be processed. Please contact support to cancel this order.",
        });
        return;
      }
    }

    // ── Mark cancelled ──────────────────────────────────────────────────────
    await db
      .update(orders)
      .set({
        status:              "cancelled",
        cancellationReason:  "buyer_requested",
        cancellationNotes:   "Cancelled by buyer within the 60-minute cancellation window.",
        updatedAt:           new Date(),
      })
      .where(eq(orders.id, id));

    res.json({ cancelled: true, refunded, orderNumber: order.orderNumber });
  } catch (err) {
    console.error("POST /buyer/orders/:id/cancel error:", err);
    res.status(500).json({ error: "Failed to cancel order" });
  }
});

// ─── Seller Payment Status ────────────────────────────────────────────────────

/**
 * GET /api/buyer/seller-payment-status/:sellerId
 * Check whether a seller's Stripe Connect account is ready to accept payments.
 * Returns { ready: boolean, reason?: string }
 */
router.get("/seller-payment-status/:sellerId", async (req, res) => {
  try {
    const { sellerId } = req.params;

    const [seller] = await db
      .select({
        stripeAccountId:     users.stripeAccountId,
        stripeAccountStatus: users.stripeAccountStatus,
      })
      .from(users)
      .where(eq(users.clerkId, sellerId))
      .limit(1);

    if (!seller) {
      res.json({ ready: false, reason: "This seller's account could not be found." });
      return;
    }

    if (!seller.stripeAccountId) {
      res.json({ ready: false, reason: "This seller hasn't set up a payment account yet." });
      return;
    }

    if (seller.stripeAccountStatus !== "active") {
      const reason =
        seller.stripeAccountStatus === "restricted"
          ? "This seller's payment account is currently restricted."
          : "This seller's payment account isn't active yet.";
      res.json({ ready: false, reason });
      return;
    }

    res.json({ ready: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ready: false, reason: "Could not verify seller payment status." });
  }
});

export default router;
