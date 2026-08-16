/**
 * Stripe webhook handler — raw body required for signature verification.
 * Mounted at /api/webhooks (before express.json() middleware).
 */
import { Router, type Request, type Response } from "express";
import {
  db, checkoutSessions, orders, orderItems, productVariants, users,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { stripe, STRIPE_WEBHOOK_SECRET } from "../lib/stripe";

const router = Router();

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
    console.error("Stripe webhook signature verification failed:", err.message);
    res.status(400).json({ error: `Webhook error: ${err.message}` });
    return;
  }

  try {
    switch (event.type) {
      // Synchronous payment (cards, wallets) — already captured at session completion
      case "checkout.session.completed":
        if (event.data.object.payment_status === "paid") {
          await handleCheckoutPaid(event.data.object);
        }
        // payment_status === 'unpaid' means async method chosen → wait for below
        break;

      // Delayed payment method (ACH bank debit, etc.) captured successfully
      case "checkout.session.async_payment_succeeded":
        await handleCheckoutPaid(event.data.object);
        break;

      // Delayed payment failed — log; no order was created, nothing to clean up
      case "checkout.session.async_payment_failed":
        console.warn(
          `Async payment failed for session ${event.data.object.id}`,
          event.data.object.payment_status,
        );
        break;

      case "account.updated":
        await handleAccountUpdated(event.data.object);
        break;

      default:
        break;
    }

    res.json({ received: true });
  } catch (err) {
    console.error("Webhook handler error:", err);
    res.status(500).json({ error: "Webhook handler failed" });
  }
});

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
async function handleCheckoutPaid(session: any) {
  const sessionId: string   = session.id;
  const buyerId:   string   = session.client_reference_id ?? "";
  const piId:      string | null = session.payment_intent ?? null;
  const metadata:  Record<string, string> = session.metadata ?? {};
  const csRef:     string | undefined = metadata["csRef"];

  if (!buyerId) {
    console.error("checkout paid: missing client_reference_id", sessionId);
    return;
  }

  // ── Fast-path idempotency check (unique DB index is the hard guarantee) ──
  const [existing] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.stripeCheckoutSessionId, sessionId))
    .limit(1);
  if (existing) {
    console.log(`Order already exists for session ${sessionId}, skipping`);
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
    console.error(`checkout paid: no server-side cart record for session ${sessionId}`);
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
  // Derive shipping as the difference between what Stripe charged and item subtotal
  const shippingCents = Math.max(0, totalCents - subtotalCents);

  // Prefer the buyer-provided address stored in the server-side checkout record
  // (captured before Stripe was opened, so it always has the address).
  // Fall back to session.shipping_details if the csRecord address is missing
  // (e.g. older sessions or sessions created with shipping_address_collection).
  let shippingAddress: { name?: string; street: string; city: string; state: string; zip: string; country: string } | undefined;
  if (csRecord.shippingAddress && (csRecord.shippingAddress as any).street) {
    const sa = csRecord.shippingAddress as any;
    shippingAddress = {
      name:    sa.name    ?? undefined,
      street:  sa.street,
      city:    sa.city,
      state:   sa.state,
      zip:     sa.zip,
      country: sa.country ?? "US",
    };
  } else {
    const shipDetails = session.shipping_details;
    if (shipDetails?.address) {
      shippingAddress = {
        name:    shipDetails.name ?? undefined,
        street:  shipDetails.address.line1 ?? "",
        city:    shipDetails.address.city ?? "",
        state:   shipDetails.address.state ?? "",
        zip:     shipDetails.address.postal_code ?? "",
        country: shipDetails.address.country ?? "US",
      };
    }
  }

  // ── All-or-nothing stock reservation inside transaction ───────────────────
  let oversoldItems: string[] = [];

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
    const [order] = await tx
      .insert(orders)
      .values({
        ownerId,
        buyerId,
        orderNumber,
        status:                  oversoldItems.length > 0 ? "refund_pending" : "pending",
        totalCents,
        subtotalCents,
        shippingCents,
        stripePaymentIntentId:   piId,
        stripeCheckoutSessionId: sessionId,
        ...(shippingAddress && { shippingAddress }),
      })
      .returning();

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
  });

  // ── Issue Stripe refund for oversold orders ───────────────────────────────
  if (oversoldItems.length > 0) {
    console.error(
      `Oversold after payment — issuing refund. Session: ${sessionId}. Items: ${oversoldItems.join(", ")}`,
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
        console.log(`Refund issued for payment intent ${piId}`);
      } catch (refundErr) {
        // Refund failed — order remains "refund_pending" for manual review
        console.error(`Failed to issue automatic refund for ${piId}:`, refundErr);
      }
    }
  } else {
    console.log(`Order created for buyer ${buyerId}, session ${sessionId}`);
  }
}

async function handleAccountUpdated(account: any) {
  const stripeAccountId: string  = account.id;
  const chargesEnabled:  boolean = account.charges_enabled ?? false;
  const payoutsEnabled:  boolean = account.payouts_enabled ?? false;
  const detailsSubmitted: boolean = account.details_submitted ?? false;

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

  console.log(`Connect account ${stripeAccountId} updated — status: ${status}`);
}

export default router;
