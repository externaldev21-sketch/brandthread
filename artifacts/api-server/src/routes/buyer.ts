/**
 * Buyer-facing authenticated endpoints.
 * Mounted at /api/buyer — all routes require Clerk auth.
 */
import { Router } from "express";
import { db, orders, orderItems, productVariants, products, users } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requireStripe } from "../lib/stripe";

const router = Router();
router.use(requireAuth);

// ─── Checkout ─────────────────────────────────────────────────────────────────

/**
 * POST /api/buyer/checkout/session
 * Body: { items: [{ variantId, productId, quantity }], successUrl, cancelUrl, contactEmail, shippingAddress }
 * Returns: { sessionId, url }
 */
router.post("/checkout/session", async (req, res) => {
  try {
    const stripe = requireStripe();
    const buyerId = (req as any).clerkUserId as string;
    const {
      items,
      successUrl,
      cancelUrl,
      contactEmail,
      shippingAddress,
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "items required" });
      return;
    }
    if (!successUrl || !cancelUrl) {
      res.status(400).json({ error: "successUrl and cancelUrl required" });
      return;
    }

    // Resolve server-side prices and build line items
    const lineItems: any[] = [];
    let sellerAccountId: string | null = null;
    const cartMetadata: Record<string, string> = {};

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const qty = parseInt(item.quantity, 10);
      if (!Number.isInteger(qty) || qty < 1) {
        res.status(400).json({ error: `Item ${i}: quantity must be >= 1` });
        return;
      }

      // Look up variant + product + seller
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
          )
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

      // Collect seller's Stripe account for Connect transfer
      if (!sellerAccountId) {
        const [seller] = await db
          .select({ stripeAccountId: users.stripeAccountId })
          .from(users)
          .where(eq(users.clerkId, row.sellerId))
          .limit(1);
        sellerAccountId = seller?.stripeAccountId ?? null;
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

      // Store cart items in metadata for webhook reconstruction
      cartMetadata[`item_${i}_variantId`] = row.variantId;
      cartMetadata[`item_${i}_productName`] = row.productName;
      cartMetadata[`item_${i}_variantLabel`] = variantLabel;
      cartMetadata[`item_${i}_quantity`] = String(qty);
      cartMetadata[`item_${i}_priceCents`] = String(row.priceCents);
    }
    cartMetadata["itemCount"] = String(items.length);

    // Build session params
    const sessionParams: any = {
      mode: "payment",
      line_items: lineItems,
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: buyerId,
      metadata: cartMetadata,
      payment_intent_data: { metadata: { buyerId } },
    };

    if (contactEmail) {
      sessionParams.customer_email = contactEmail;
    }

    if (shippingAddress) {
      sessionParams.shipping_address_collection = undefined; // already collected on mobile
    }

    // Route payment to seller via Stripe Connect (if seller has Connect account)
    if (sellerAccountId) {
      sessionParams.payment_intent_data.transfer_data = {
        destination: sellerAccountId,
      };
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

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
 * Returns: { status: 'complete' | 'open' | 'expired', paymentStatus, orderId? }
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

    // Look up order created by webhook
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

// GET /api/buyer/orders
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

// GET /api/buyer/orders/:id
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
