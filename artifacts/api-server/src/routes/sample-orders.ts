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
 */
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { sampleOrders, manufacturers, manufacturerThreads, dropWallets, dropWalletTransactions } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requireStripe, PLATFORM_COMMISSION_RATE, computeApplicationFeeCents } from "../lib/stripe";

const router = Router();
router.use(requireAuth);

const ORDER_STAGES = [
  "payment_received",
  "processing",
  "cut_and_sew",
  "packing",
  "shipped",
  "delivered",
] as const;

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
    console.error(err);
    res.status(500).json({ error: "Failed to list orders" });
  }
});

// ── POST /api/sample-orders ────────────────────────────────────────────────────
// Creates order + Stripe PaymentIntent (manufacturer must have Connect account).

router.post("/", async (req, res) => {
  try {
    const stripe = requireStripe();
    const sellerId = (req as any).clerkUserId as string;
    const { manufacturerId, threadId, orderType = "sample", title, description, quantity = 1, priceCents, notes } = req.body;

    if (!manufacturerId || !title || typeof priceCents !== "number" || priceCents <= 0) {
      res.status(400).json({ error: "manufacturerId, title, priceCents required" }); return;
    }

    const [mfr] = await db
      .select({ stripeAccountId: manufacturers.stripeAccountId })
      .from(manufacturers)
      .where(eq(manufacturers.id, manufacturerId))
      .limit(1);

    if (!mfr) { res.status(404).json({ error: "Manufacturer not found" }); return; }

    const platformFeeCents = computeApplicationFeeCents(priceCents);
    let stripePaymentIntentId: string | null = null;
    let clientSecret: string | null = null;

    if (mfr.stripeAccountId) {
      // Create payment intent with manufacturer as destination
      const intent = await stripe.paymentIntents.create({
        amount:                priceCents,
        currency:              "usd",
        application_fee_amount: platformFeeCents,
        transfer_data:         { destination: mfr.stripeAccountId },
        metadata: {
          orderType,
          sellerId,
          manufacturerId,
          title,
        },
      });
      stripePaymentIntentId = intent.id;
      clientSecret          = intent.client_secret;
    }

    const [order] = await db
      .insert(sampleOrders)
      .values({
        manufacturerId,
        sellerId,
        threadId:  threadId ?? null,
        orderType,
        title,
        description: description ?? null,
        quantity,
        priceCents,
        platformFeeCents,
        stripePaymentIntentId,
        notes: notes ?? null,
        status: stripePaymentIntentId ? "payment_received" : "payment_received",
      })
      .returning();

    res.status(201).json({
      ...order,
      clientSecret,
      hasConnect:  !!mfr.stripeAccountId,
      createdAt:   order.createdAt.toISOString(),
      updatedAt:   order.updatedAt.toISOString(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create order" });
  }
});

// ── GET /api/sample-orders/:id ────────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const [row] = await db
      .select({
        order:      sampleOrders,
        mfrName:    manufacturers.businessName,
        mfrCountry: manufacturers.country,
        mfrStripe:  manufacturers.stripeAccountId,
      })
      .from(sampleOrders)
      .leftJoin(manufacturers, eq(sampleOrders.manufacturerId, manufacturers.id))
      .where(and(eq(sampleOrders.id, req.params.id), eq(sampleOrders.sellerId, sellerId)))
      .limit(1);

    if (!row) { res.status(404).json({ error: "Not found" }); return; }

    const stageIndex = ORDER_STAGES.indexOf(row.order.status as any);

    res.json({
      ...row.order,
      manufacturerName:     row.mfrName,
      manufacturerCountry:  row.mfrCountry,
      manufacturerHasStripe: !!row.mfrStripe,
      stageIndex,
      stages: ORDER_STAGES,
      createdAt:  row.order.createdAt.toISOString(),
      updatedAt:  row.order.updatedAt.toISOString(),
      shippedAt:  row.order.shippedAt?.toISOString() ?? null,
      deliveredAt: row.order.deliveredAt?.toISOString() ?? null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to get order" });
  }
});

// ── PATCH /api/sample-orders/:id/advance ──────────────────────────────────────
// Manufacturer (or seller for demo) advances production stage.

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

    // Allow seller (for demo) or the manufacturer themselves
    const isSeller        = row.order.sellerId === clerkUserId;
    const isManufacturer  = row.mfrClerkId === clerkUserId;
    if (!isSeller && !isManufacturer) {
      res.status(403).json({ error: "Forbidden" }); return;
    }

    const current = row.order.status;
    const idx     = ORDER_STAGES.indexOf(current as any);
    if (idx < 0 || idx >= ORDER_STAGES.length - 1) {
      res.status(400).json({ error: "Already at final stage" }); return;
    }

    const nextStage = ORDER_STAGES[idx + 1];
    const now       = new Date();
    const extra: Partial<typeof sampleOrders.$inferInsert> = {};
    if (nextStage === "shipped") extra.shippedAt = now;
    if (nextStage === "delivered") extra.deliveredAt = now;

    const [updated] = await db
      .update(sampleOrders)
      .set({ status: nextStage, ...extra, updatedAt: now })
      .where(eq(sampleOrders.id, req.params.id))
      .returning();

    res.json({
      ...updated,
      createdAt:  updated.createdAt.toISOString(),
      updatedAt:  updated.updatedAt.toISOString(),
      shippedAt:  updated.shippedAt?.toISOString() ?? null,
      deliveredAt: updated.deliveredAt?.toISOString() ?? null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to advance stage" });
  }
});

// ── PATCH /api/sample-orders/:id/tracking ─────────────────────────────────────
// Adds tracking number and marks shipped. Also triggers payout to manufacturer.

router.patch("/:id/tracking", async (req, res) => {
  try {
    const stripe      = requireStripe();
    const sellerId    = (req as any).clerkUserId as string;
    const { trackingNumber, carrier } = req.body;

    if (!trackingNumber) {
      res.status(400).json({ error: "trackingNumber required" }); return;
    }

    const [row] = await db
      .select({
        order:           sampleOrders,
        mfrStripeId:     manufacturers.stripeAccountId,
      })
      .from(sampleOrders)
      .leftJoin(manufacturers, eq(sampleOrders.manufacturerId, manufacturers.id))
      .where(and(eq(sampleOrders.id, req.params.id), eq(sampleOrders.sellerId, sellerId)))
      .limit(1);

    if (!row) { res.status(404).json({ error: "Not found" }); return; }

    const order = row.order;
    const now   = new Date();

    // Attempt Stripe payout to manufacturer Connect account if not already released
    let stripeTransferId: string | null = order.stripeTransferId;
    if (!order.payoutReleased && row.mfrStripeId && order.stripePaymentIntentId) {
      try {
        const netCents = order.priceCents - order.platformFeeCents;
        const transfer = await stripe.transfers.create({
          amount:      netCents,
          currency:    "usd",
          destination: row.mfrStripeId,
          transfer_group: `sample_${order.id}`,
          metadata: { sampleOrderId: order.id, sellerId },
        });
        stripeTransferId = transfer.id;
      } catch (e) {
        console.error("Stripe transfer failed (non-fatal):", e);
      }
    }

    const [updated] = await db
      .update(sampleOrders)
      .set({
        trackingNumber,
        carrier:         carrier ?? null,
        status:          "shipped",
        shippedAt:       now,
        payoutReleased:  !!stripeTransferId,
        stripeTransferId: stripeTransferId ?? order.stripeTransferId,
        updatedAt:       now,
      })
      .where(eq(sampleOrders.id, req.params.id))
      .returning();

    res.json({
      ...updated,
      createdAt:   updated.createdAt.toISOString(),
      updatedAt:   updated.updatedAt.toISOString(),
      shippedAt:   updated.shippedAt?.toISOString() ?? null,
      deliveredAt: updated.deliveredAt?.toISOString() ?? null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to add tracking" });
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

    if (wallet.sellerId !== sellerId) {
      res.status(403).json({ error: "Wallet does not belong to you" }); return;
    }

    const availableCents = wallet.balanceCents - wallet.releasedCents - wallet.reservedCents;
    if (availableCents < order.priceCents) {
      res.status(400).json({
        error: `Insufficient wallet balance. Available: $${(availableCents / 100).toFixed(2)}, required: $${(order.priceCents / 100).toFixed(2)}`,
      }); return;
    }

    // Transfer from platform to manufacturer's Connect account
    let stripeTransferId: string | null = null;
    if (row.mfrStripeId) {
      const transfer = await stripe.transfers.create({
        amount:      order.priceCents,
        currency:    "usd",
        destination: row.mfrStripeId,
        transfer_group: wallet.stripeTransferGroup ?? `drop_${wallet.dropId}`,
        metadata: { sampleOrderId: order.id, sellerId, paymentSource: "drop_wallet" },
      });
      stripeTransferId = transfer.id;
    }

    // Debit wallet
    await db.transaction(async (tx) => {
      await tx
        .update(dropWallets)
        .set({
          reservedCents: wallet.reservedCents + order.priceCents,
          updatedAt:     new Date(),
        })
        .where(eq(dropWallets.id, walletId));

      await tx
        .insert(dropWalletTransactions)
        .values({
          walletId,
          type:             "bulk_payment",
          amountCents:      order.priceCents,
          sampleOrderId:    order.id,
          description:      `Bulk order payment: ${order.title}`,
          stripeTransferId: stripeTransferId ?? undefined,
        });
    });

    const [updated] = await db
      .update(sampleOrders)
      .set({
        walletId,
        stripeTransferId: stripeTransferId ?? undefined,
        updatedAt:        new Date(),
      })
      .where(eq(sampleOrders.id, req.params.id))
      .returning();

    res.json({
      ...updated,
      paidFromWallet: true,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to pay from wallet" });
  }
});

export default router;
