import { Router } from "express";
import { db, orders, orderItems, customers, drops, productVariants, products, notificationsFeed, users, dropWallets, dropWalletTransactions } from "@workspace/db";
import { eq, desc, sql, and, ne } from "drizzle-orm";
import { stripe, PLATFORM_COMMISSION_RATE } from "../lib/stripe";
import { requireAuth } from "../middlewares/requireAuth";
import { teamContext, requireRole } from "../middlewares/requireRole";
import { logActivity, reqActor } from "../lib/activityLog";
import { publishNotification } from "./notifications-feed";

const router = Router();
router.use(requireAuth);
// Resolve team membership: managers/staff act on the owner's store while the
// audit log keeps track of who actually performed each action.
router.use(teamContext());

// GET /api/orders
router.get("/", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const rows = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      totalCents: orders.totalCents,
      trackingNumber: orders.trackingNumber,
      carrier: orders.carrier,
      createdAt: orders.createdAt,
      updatedAt: orders.updatedAt,
      // Prefer the explicit customers record; fall back to the buyer's user row
      // (covers Stripe-originated orders where customerId is null but buyerId is set)
      customerName: sql<string>`COALESCE(${customers.name}, NULLIF(${users.displayName}, ''), ${users.name})`,
      customerEmail: sql<string>`COALESCE(${customers.email}, ${users.email})`,
      dropName: drops.name,
      dropType: drops.type,
      itemCount: sql<number>`count(${orderItems.id})::int`,
    })
    .from(orders)
    .leftJoin(customers, eq(orders.customerId, customers.id))
    .leftJoin(users, eq(orders.buyerId, users.clerkId))
    .leftJoin(drops, eq(orders.dropId, drops.id))
    .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
    .where(eq(orders.ownerId, ownerId))
    .groupBy(orders.id, customers.name, customers.email, drops.name, drops.type, users.displayName, users.name, users.email)
    .orderBy(desc(orders.createdAt));
  res.json(rows);
});

// POST /api/orders — transactional, server-side prices, stock validation (manager+)
router.post("/", requireRole("manager"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { customerId, dropId, items, shippingCents = 0, notes, shippingAddress } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: "items required" }); return;
  }
  if (typeof shippingCents !== "number" || !Number.isInteger(shippingCents) || shippingCents < 0) {
    res.status(400).json({ error: "shippingCents must be a non-negative integer" }); return;
  }

  try {
    let createdOrder: any = null;

    await db.transaction(async (tx) => {
      // Resolve server-side prices and validate items
      type ResolvedItem = {
        variantId: string | undefined;
        productName: string;
        variantLabel: string | undefined;
        quantity: number;
        priceCents: number;
      };
      const resolvedItems: ResolvedItem[] = [];
      let subtotalCents = 0;

      for (const item of items) {
        if (!item.productName || typeof item.productName !== "string") {
          throw Object.assign(new Error("Each item requires productName"), { status: 400 });
        }
        const qty = parseInt(item.quantity, 10);
        if (!Number.isInteger(qty) || qty < 1) {
          throw Object.assign(new Error("Each item requires quantity >= 1"), { status: 400 });
        }

        let priceCents: number;

        if (item.variantId) {
          // Server-side price lookup — also verifies ownership through product join
          const [variant] = await tx
            .select({ priceCents: productVariants.priceCents, stock: productVariants.stock })
            .from(productVariants)
            .innerJoin(products, eq(productVariants.productId, products.id))
            .where(and(eq(productVariants.id, item.variantId), eq(products.ownerId, ownerId)))
            .limit(1);

          if (!variant) {
            throw Object.assign(new Error(`Variant ${item.variantId} not found or access denied`), { status: 404 });
          }

          // For non-drop orders, validate stock upfront
          if (!dropId && variant.stock < qty) {
            throw Object.assign(new Error(`Insufficient stock (available: ${variant.stock})`), { status: 400 });
          }

          priceCents = variant.priceCents;
        } else {
          // Custom item without a variant — client must supply priceCents
          const clientPrice = parseInt(item.priceCents, 10);
          if (!Number.isInteger(clientPrice) || clientPrice <= 0) {
            throw Object.assign(new Error("priceCents required for items without variantId"), { status: 400 });
          }
          priceCents = clientPrice;
        }

        resolvedItems.push({
          variantId: item.variantId,
          productName: item.productName,
          variantLabel: item.variantLabel,
          quantity: qty,
          priceCents,
        });
        subtotalCents += priceCents * qty;
      }

      const totalCents = subtotalCents + shippingCents;

      // Concurrency-safe, per-owner order number
      const countRes = await tx.execute(sql`
        SELECT count(*)::int AS c FROM orders WHERE owner_id = ${ownerId}
      `);
      const count: number = (countRes as any).rows?.[0]?.c ?? 0;
      const orderNumber = `BT-${String(count + 1).padStart(5, "0")}`;

      // Insert order
  const [order] = await db.select().from(orders)
    .where(and(eq(orders.id, req.params.id), eq(orders.ownerId, ownerId)))
    .limit(1);

      // Insert items
      await tx.insert(orderItems).values(
        resolvedItems.map(i => ({
          orderId: order.id,
          variantId: i.variantId,
          productName: i.productName,
          variantLabel: i.variantLabel,
          quantity: i.quantity,
          priceCents: i.priceCents,
        }))
      );

      // Deduct stock for non-drop orders (within the same transaction)
      if (!dropId) {
        for (const item of resolvedItems) {
          if (item.variantId) {
            const deductResult = await tx.execute(sql`
              UPDATE product_variants
              SET stock = stock - ${item.quantity}
              WHERE id = ${item.variantId} AND stock >= ${item.quantity}
            `);
            if ((deductResult as any).rowCount === 0) {
              // Race condition — another request grabbed the stock
              throw Object.assign(new Error("Stock no longer available — please try again"), { status: 409 });
            }
          }
        }
      }

      // Update customer totals
      if (customerId) {
        await tx.execute(sql`
          UPDATE customers
          SET total_spent_cents = total_spent_cents + ${totalCents},
              order_count = order_count + 1,
              updated_at = NOW()
          WHERE id = ${customerId} AND owner_id = ${ownerId}
        `);
      }

      // Update drop totals
      if (dropId) {
        await tx.execute(sql`
          UPDATE drops
          SET total_collected_cents = total_collected_cents + ${totalCents},
              order_count = order_count + 1,
              updated_at = NOW()
          WHERE id = ${dropId} AND owner_id = ${ownerId}
        `);
      }

      createdOrder = order;
    });

    res.status(201).json(createdOrder);
  } catch (err: any) {
    const status: number = err.status ?? 500;
    if (status < 500) {
      res.status(status).json({ error: err.message });
    } else {
      console.error(err);
      res.status(500).json({ error: "Order creation failed" });
    }
  }
});

// GET /api/orders/:id
router.get("/:id", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const [order] = await db.select().from(orders)
    .where(and(eq(orders.id, req.params.id), eq(orders.ownerId, ownerId)))
    .limit(1);
  if (!order) { res.status(404).json({ error: "Not found" }); return; }
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));

  // Resolve customer: prefer the customers record, fall back to the buyer's user row
  let customer: any = null;
  if (order.customerId) {
    const [c] = await db.select().from(customers)
      .where(eq(customers.id, order.customerId)).limit(1);
    customer = c ?? null;
  }
  if (!customer && order.buyerId) {
    const [u] = await db.select({
      id:          users.id,
      // Prefer displayName (brand/buyer alias) when set; fall back to the required name field
      name:        sql<string>`COALESCE(NULLIF(${users.displayName}, ''), ${users.name})`,
      email:       users.email,
      orderCount:  sql<number>`1`,
      totalSpentCents: sql<number>`0`,
      tags:        sql<string[]>`ARRAY[]::text[]`,
    }).from(users)
      .where(eq(users.clerkId, order.buyerId)).limit(1);
    if (u) {
      customer = u;
    }
  }

  res.json({ ...order, items, customer });
});

// Recognized cancellation reasons — kept in sync with mobile orderTypes.ts
const VALID_CANCELLATION_REASONS = [
  "customer_request", "out_of_stock", "production_issue",
  "fraud_risk", "shipping_restriction", "duplicate_order",
  "seller_decision", "other",
] as const;
const CANCELLATION_NOTES_MAX_LENGTH = 1000;

// PATCH /api/orders/:id/status — fulfillment (staff+)
router.patch("/:id/status", requireRole("staff"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { status, reason, notes } = req.body;
  const valid = ["pending", "processing", "fulfilled", "shipped", "delivered", "cancelled"];
  if (!valid.includes(status)) {
    res.status(400).json({ error: `status must be one of: ${valid.join(", ")}` }); return;
  }

  // Cancellation-specific validation
  if (status === "cancelled") {
    if (!reason) {
      res.status(400).json({ error: "reason is required when cancelling an order" }); return;
    }
    if (!VALID_CANCELLATION_REASONS.includes(reason as any)) {
      res.status(400).json({ error: `reason must be one of: ${VALID_CANCELLATION_REASONS.join(", ")}` }); return;
    }
    if (notes !== undefined) {
      if (typeof notes !== "string") {
        res.status(400).json({ error: "notes must be a string" }); return;
      }
      if (notes.length > CANCELLATION_NOTES_MAX_LENGTH) {
        res.status(400).json({ error: `notes must be ${CANCELLATION_NOTES_MAX_LENGTH} characters or fewer` }); return;
      }
    }
  }

  // Build the update payload — include cancellation fields when cancelling
  const updatePayload: Record<string, any> = { status, updatedAt: new Date() };
  if (status === "cancelled") {
    updatePayload.cancellationReason = reason;
    updatePayload.cancellationNotes  = (notes as string | undefined)?.trim() || null;
  }

  // Atomically update only when status is actually changing — prevents duplicate notifications
  // from concurrent retries that both read the old status before either write completes.
  const [transitioned] = await db.update(orders)
    .set(updatePayload)
    .where(and(
      eq(orders.id, req.params.id),
      eq(orders.ownerId, ownerId),
      ne(orders.status, status),           // skip the write if already at target status
    ))
    .returning();

  if (!transitioned) {
    // Either not found, or order was already at the requested status (idempotent).
    const [current] = await db.select().from(orders)
      .where(and(eq(orders.id, req.params.id), eq(orders.ownerId, ownerId))).limit(1);
    if (!current) { res.status(404).json({ error: "Not found" }); return; }
    res.json(current); return;  // Already at target status — no notification needed
  }

  // Audit log: which team member changed the status
  {
    const actor = reqActor(req);
    void logActivity(
      actor.ownerClerkId, actor.actorClerkId, actor.actorRole,
      `Marked order #${transitioned.orderNumber} as ${status}`,
      "order", transitioned.id, { status, reason, notes },
    );
  }

  // Genuine transition — notify buyer for meaningful statuses
  const cancellationReasonLabel = reason
    ? ` Reason: ${reason.replace(/_/g, " ")}.`
    : "";
  const notifMap: Record<string, { type: string; title: string; body: string } | undefined> = {
    shipped:   { type: "order_shipped",   title: "Your order has shipped! 🚚", body: `Order #${transitioned.orderNumber} is on its way.` },
    delivered: { type: "order_delivered", title: "Your order was delivered! 📦", body: `Order #${transitioned.orderNumber} has been delivered.` },
    cancelled: { type: "order_cancelled", title: "Order cancelled", body: `Order #${transitioned.orderNumber} has been cancelled.${cancellationReasonLabel}` },
  };
  const notif = notifMap[status];
  if (transitioned.buyerId && notif) {
    publishNotification({
      userId:     transitioned.buyerId,
      category:   "orders",
      type:       notif.type,
      title:      notif.title,
      body:       notif.body,
      targetId:   transitioned.id,
      targetType: "order",
    }).catch(() => { /* non-critical */ });
  }

  res.json(transitioned);
});

// PATCH /api/orders/:id/tracking — fulfillment (staff+)
router.patch("/:id/tracking", requireRole("staff"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { trackingNumber, carrier } = req.body;
  if (!trackingNumber) { res.status(400).json({ error: "trackingNumber required" }); return; }

  // Step 1: Atomically transition to shipped only when status isn't already shipped.
  // This prevents duplicate ship notifications on repeated tracking updates.
  const [statusTransition] = await db.update(orders)
    .set({ status: "shipped", shippedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(orders.id, req.params.id),
      eq(orders.ownerId, ownerId),
      ne(orders.status, "shipped"),        // skip write if already shipped
    ))
    .returning({ id: orders.id, buyerId: orders.buyerId, orderNumber: orders.orderNumber, dropId: orders.dropId, ownerId: orders.ownerId, subtotalCents: orders.subtotalCents });

  // Step 2: Always update tracking fields (idempotent for repeated calls)
  const [updated] = await db.update(orders)
    .set({ trackingNumber, carrier: carrier ?? null, updatedAt: new Date() })
    .where(and(eq(orders.id, req.params.id), eq(orders.ownerId, ownerId)))
    .returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  // Audit log: which team member added tracking
  {
    const actor = reqActor(req);
    void logActivity(
      actor.ownerClerkId, actor.actorClerkId, actor.actorRole,
      `Added tracking ${trackingNumber} to order #${updated.orderNumber}`,
      "order", updated.id, { trackingNumber, carrier: carrier ?? null },
    );
  }

  // Notify buyer only when status genuinely transitioned to shipped
  if (statusTransition?.buyerId) {
    const carrierLabel = carrier ?? "carrier";
    publishNotification({
      userId:     statusTransition.buyerId,
      category:   "orders",
      type:       "order_shipped",
      title:      "Your order has shipped! 🚚",
      body:       `Order #${statusTransition.orderNumber} is on its way via ${carrierLabel} — tracking: ${trackingNumber}`,
      targetId:   statusTransition.id,
      targetType: "order",
    }).catch(() => { /* non-critical */ });
  }

  // Auto-release drop wallet share when order ships
  // Drop order payments sit on the platform account (escrow); on ship, we
  // create a Stripe Transfer to the seller's Connect account (net of fee).
  if (statusTransition?.dropId) {
    setImmediate(() => {
      autoReleaseDropOrder(statusTransition.id, statusTransition.ownerId, statusTransition.dropId!, statusTransition.subtotalCents)
        .catch(err => console.error(`Auto drop-wallet release failed for order ${statusTransition.id}:`, err));
    });
  }

  res.json(updated);
});

// ─── Drop wallet auto-release helper ─────────────────────────────────────────
// Called automatically when a drop order is marked shipped.
async function autoReleaseDropOrder(
  orderId: string,
  sellerId: string,
  dropId: string,
  subtotalCents: number,
): Promise<void> {
  if (!stripe) { console.warn("autoReleaseDropOrder: Stripe not configured"); return; }

  const [user] = await db
    .select({ stripeAccountId: users.stripeAccountId })
    .from(users)
    .where(eq(users.clerkId, sellerId))
    .limit(1);

  if (!user?.stripeAccountId) {
    console.warn(`autoReleaseDropOrder: seller ${sellerId} has no Connect account`); return;
  }

  const feeCents      = Math.round(subtotalCents * PLATFORM_COMMISSION_RATE);
  const transferCents = subtotalCents - feeCents;

  await db.transaction(async (tx) => {
    // Lock wallet row to prevent concurrent double-releases
    const lockResult = await tx.execute(
      sql`SELECT id, balance_cents, released_cents, reserved_cents, stripe_transfer_group FROM drop_wallets WHERE drop_id = ${dropId}::uuid FOR UPDATE LIMIT 1`,
    );
    const w = (lockResult as any).rows?.[0];
    if (!w) { console.warn(`autoReleaseDropOrder: no wallet for drop ${dropId}`); return; }

    // Idempotency — skip if already released for this order
    const already = await tx.execute(
      sql`SELECT id FROM drop_wallet_transactions WHERE wallet_id = ${w.id}::uuid AND order_id = ${orderId}::uuid AND type = 'release' LIMIT 1`,
    );
    if ((already as any).rows?.length > 0) { return; }

    const available = w.balance_cents - w.released_cents - w.reserved_cents;
    if (available < subtotalCents) {
      console.error(`autoReleaseDropOrder: insufficient balance. available=${available}, need=${subtotalCents}`); return;
    }

    let stripeTransferId: string | null = null;
    if (transferCents > 0) {
      try {
        const transfer = await stripe!.transfers.create({
          amount:         transferCents,
          currency:       "usd",
          destination:    user.stripeAccountId!,
          transfer_group: w.stripe_transfer_group ?? `drop_${dropId}`,
          metadata:       { dropId, orderId, sellerId, trigger: "auto_on_ship" },
        });
        stripeTransferId = transfer.id;
      } catch (stripeErr) {
        console.error("autoReleaseDropOrder: Stripe transfer failed:", stripeErr);
        return; // Don't mark released if Stripe call failed
      }
    }

    await tx.execute(
      sql`UPDATE drop_wallets SET released_cents = released_cents + ${subtotalCents}, updated_at = NOW() WHERE id = ${w.id}::uuid`,
    );

    await tx.insert(dropWalletTransactions).values({
      walletId:         w.id as string,
      type:             "release",
      amountCents:      subtotalCents,
      orderId,
      description:      `Auto-release on ship (net: $${(transferCents / 100).toFixed(2)}, fee: $${(feeCents / 100).toFixed(2)})`,
      stripeTransferId: stripeTransferId ?? undefined,
    });
  });
}

export default router;
