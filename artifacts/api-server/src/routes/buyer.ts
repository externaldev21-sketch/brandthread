/**
 * Buyer-facing authenticated endpoints.
 * Mounted at /api/buyer — all routes require Clerk auth.
 */
import { Router } from "express";
import {
  db, checkoutSessions, orders, orderItems, productVariants, products, users,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requireStripe } from "../lib/stripe";

const router = Router();
router.use(requireAuth);

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
    const { items, successUrl, cancelUrl, contactEmail } = req.body;

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

    // ── Persist cart server-side before calling Stripe ────────────────────
    // This record is the single source of truth for the webhook; Stripe
    // metadata only carries the record's UUID (no per-field keys, no 50-key limit).
    const [csRecord] = await db
      .insert(checkoutSessions)
      .values({ buyerId, sellerId, items: cartItems })
      .returning({ id: checkoutSessions.id });

    // ── Create Stripe Checkout Session ────────────────────────────────────
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: lineItems,
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: buyerId,
      // Single metadata key — immune to the 50-key limit
      metadata: { csRef: csRecord.id },
      payment_intent_data: {
        metadata: { buyerId },
        transfer_data: { destination: seller.stripeAccountId },
      },
      ...(contactEmail ? { customer_email: contactEmail } : {}),
    });

    // Back-fill the Stripe session ID so the webhook can also look up by it
    await db
      .update(checkoutSessions)
      .set({ stripeSessionId: session.id })
      .where(eq(checkoutSessions.id, csRecord.id));

    res.json({ sessionId: session.id, url: session.url });
  } catch (err: any) {
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

    res.json({
      status: session.status,
      paymentStatus: session.payment_status,
      orderId: order?.id ?? null,
      orderNumber: order?.orderNumber ?? null,
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
      .select()
      .from(orders)
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
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, req.params.id), eq(orders.buyerId, buyerId)))
      .limit(1);

    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    const items = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id));

    res.json({ ...order, items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch order" });
  }
});

export default router;
