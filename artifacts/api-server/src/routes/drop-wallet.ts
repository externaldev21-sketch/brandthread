/**
 * Drop Wallet — per-drop, per-seller held funds ledger.
 * Implements per-order payout release (funds release when order ships).
 * Mounted at /api/drop-wallets
 *
 * POST /:dropId            create wallet for a drop (or return existing)
 * GET  /:dropId            get wallet balance + recent transactions
 * POST /:dropId/deposit    record a buyer order deposit (called by webhook)
 * POST /:dropId/release-order/:orderId  release one order's share to seller bank
 * POST /:dropId/pay-shipping/:orderId   deduct label cost from wallet
 */
import { Router } from "express";
import { db, drops, orders, dropWallets, dropWalletTransactions } from "@workspace/db";
import { users } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requireStripe } from "../lib/stripe";

const router = Router();
router.use(requireAuth);

// ── POST /api/drop-wallets/:dropId ────────────────────────────────────────────
// Create wallet for a drop (idempotent — returns existing if already created).

router.post("/:dropId", async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;

    const [drop] = await db
      .select()
      .from(drops)
      .where(and(eq(drops.id, req.params.dropId), eq(drops.ownerId, sellerId)))
      .limit(1);
    if (!drop) { res.status(404).json({ error: "Drop not found" }); return; }

    // Idempotent — return existing if present
    const [existing] = await db
      .select()
      .from(dropWallets)
      .where(eq(dropWallets.dropId, drop.id))
      .limit(1);
    if (existing) {
      res.json({ ...existing, createdAt: existing.createdAt.toISOString(), updatedAt: existing.updatedAt.toISOString() });
      return;
    }

    const [wallet] = await db
      .insert(dropWallets)
      .values({
        dropId:             drop.id,
        sellerId,
        stripeTransferGroup: `drop_${drop.id}`,
      })
      .returning();

    // For pre-order drops: set seller's Stripe Connect account to manual payouts
    // so funds stay in balance until we explicitly release them.
    try {
      const stripe = requireStripe();
      const [user] = await db
        .select({ stripeAccountId: users.stripeAccountId })
        .from(users)
        .where(eq(users.clerkId, sellerId))
        .limit(1);
      if (user?.stripeAccountId && drop.type === "pre-order") {
        await (stripe.accounts as any).update(user.stripeAccountId, {
          settings: { payouts: { schedule: { interval: "manual" } } },
        }).catch(() => { /* best-effort — non-fatal */ });
      }
    } catch { /* non-fatal */ }

    res.status(201).json({
      ...wallet,
      createdAt: wallet.createdAt.toISOString(),
      updatedAt: wallet.updatedAt.toISOString(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create wallet" });
  }
});

// ── GET /api/drop-wallets/:dropId ─────────────────────────────────────────────

router.get("/:dropId", async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;

    const [wallet] = await db
      .select()
      .from(dropWallets)
      .where(and(eq(dropWallets.dropId, req.params.dropId), eq(dropWallets.sellerId, sellerId)))
      .limit(1);

    if (!wallet) { res.status(404).json({ error: "Wallet not found" }); return; }

    const txns = await db
      .select()
      .from(dropWalletTransactions)
      .where(eq(dropWalletTransactions.walletId, wallet.id))
      .orderBy(desc(dropWalletTransactions.createdAt))
      .limit(50);

    const availableCents = wallet.balanceCents - wallet.releasedCents - wallet.reservedCents;

    res.json({
      ...wallet,
      availableCents,
      transactions: txns.map(t => ({ ...t, createdAt: t.createdAt.toISOString() })),
      createdAt:  wallet.createdAt.toISOString(),
      updatedAt:  wallet.updatedAt.toISOString(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to get wallet" });
  }
});

// ── POST /api/drop-wallets/:dropId/deposit ────────────────────────────────────
// Called internally (from webhooks) when a buyer order is paid for this drop.
// This is also exposed as an API so the webhook handler can call it.

router.post("/:dropId/deposit", async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const { orderId, amountCents, stripeTransferId } = req.body;

    if (!orderId || typeof amountCents !== "number") {
      res.status(400).json({ error: "orderId and amountCents required" }); return;
    }

    const [wallet] = await db
      .select()
      .from(dropWallets)
      .where(and(eq(dropWallets.dropId, req.params.dropId), eq(dropWallets.sellerId, sellerId)))
      .limit(1);
    if (!wallet) { res.status(404).json({ error: "Wallet not found" }); return; }

    await db.transaction(async (tx) => {
      await tx
        .update(dropWallets)
        .set({ balanceCents: wallet.balanceCents + amountCents, updatedAt: new Date() })
        .where(eq(dropWallets.id, wallet.id));

      await tx.insert(dropWalletTransactions).values({
        walletId:         wallet.id,
        type:             "deposit",
        amountCents,
        orderId:          orderId ?? null,
        description:      `Buyer order payment`,
        stripeTransferId: stripeTransferId ?? null,
      });
    });

    res.json({ deposited: true, amountCents });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to deposit" });
  }
});

// ── POST /api/drop-wallets/:dropId/release-order/:orderId ─────────────────────
// Release a specific order's share of the wallet to the seller's bank.
// Triggered when that order gets a tracking number (marked shipped).

router.post("/:dropId/release-order/:orderId", async (req, res) => {
  try {
    const stripe   = requireStripe();
    const sellerId = (req as any).clerkUserId as string;

    // Verify the order belongs to this drop + seller
    const [order] = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.id, req.params.orderId),
          eq(orders.dropId, req.params.dropId as any),
          eq(orders.ownerId, sellerId),
        ),
      )
      .limit(1);
    if (!order) { res.status(404).json({ error: "Order not found for this drop" }); return; }
    if (!order.trackingNumber) { res.status(400).json({ error: "Order has no tracking number — ship it first" }); return; }

    const [wallet] = await db
      .select()
      .from(dropWallets)
      .where(and(eq(dropWallets.dropId, req.params.dropId), eq(dropWallets.sellerId, sellerId)))
      .limit(1);
    if (!wallet) { res.status(404).json({ error: "Wallet not found" }); return; }

    // Check if this order was already released
    const alreadyReleased = await db
      .select({ id: dropWalletTransactions.id })
      .from(dropWalletTransactions)
      .where(
        and(
          eq(dropWalletTransactions.walletId, wallet.id),
          eq(dropWalletTransactions.type, "release"),
          eq(dropWalletTransactions.orderId, order.id),
        ),
      )
      .limit(1);
    if (alreadyReleased.length > 0) {
      res.status(409).json({ error: "This order's share has already been released" }); return;
    }

    // Release amount = order total (minus platform fee already captured by Stripe)
    const releaseCents = order.subtotalCents;
    const available    = wallet.balanceCents - wallet.releasedCents - wallet.reservedCents;
    if (available < releaseCents) {
      res.status(400).json({
        error: `Insufficient wallet balance. Available: $${(available / 100).toFixed(2)}, need: $${(releaseCents / 100).toFixed(2)}`,
      }); return;
    }

    // Get seller's Connect account for Stripe payout
    const [user] = await db
      .select({ stripeAccountId: users.stripeAccountId })
      .from(users)
      .where(eq(users.clerkId, sellerId))
      .limit(1);

    let stripeTransferId: string | null = null;
    if (user?.stripeAccountId) {
      const payout = await stripe.payouts.create(
        {
          amount:   releaseCents,
          currency: "usd",
          metadata: { dropId: wallet.dropId, orderId: order.id, sellerId },
        },
        { stripeAccount: user.stripeAccountId },
      );
      stripeTransferId = payout.id;
    }

    await db.transaction(async (tx) => {
      await tx
        .update(dropWallets)
        .set({
          releasedCents: wallet.releasedCents + releaseCents,
          updatedAt:     new Date(),
        })
        .where(eq(dropWallets.id, wallet.id));

      await tx.insert(dropWalletTransactions).values({
        walletId:         wallet.id,
        type:             "release",
        amountCents:      releaseCents,
        orderId:          order.id,
        description:      `Per-order release for order #${order.orderNumber}`,
        stripeTransferId: stripeTransferId ?? undefined,
      });
    });

    res.json({
      released:         true,
      releaseCents,
      stripePayoutId:   stripeTransferId,
      orderNumber:      order.orderNumber,
    });
  } catch (err: any) {
    if (err.status && err.status < 500) {
      res.status(err.status).json({ error: err.message }); return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to release order share" });
  }
});

// ── POST /api/drop-wallets/:dropId/pay-shipping/:orderId ─────────────────────
// Deduct shipping label cost from wallet (seller pays label from held funds).

router.post("/:dropId/pay-shipping/:orderId", async (req, res) => {
  try {
    const sellerId   = (req as any).clerkUserId as string;
    const { labelCents, carrier, trackingNumber, description } = req.body;

    if (typeof labelCents !== "number" || labelCents <= 0) {
      res.status(400).json({ error: "labelCents required" }); return;
    }

    const [wallet] = await db
      .select()
      .from(dropWallets)
      .where(and(eq(dropWallets.dropId, req.params.dropId), eq(dropWallets.sellerId, sellerId)))
      .limit(1);
    if (!wallet) { res.status(404).json({ error: "Wallet not found" }); return; }

    const available = wallet.balanceCents - wallet.releasedCents - wallet.reservedCents;
    if (available < labelCents) {
      res.status(400).json({ error: `Insufficient wallet balance. Available: $${(available / 100).toFixed(2)}` }); return;
    }

    await db.transaction(async (tx) => {
      await tx
        .update(dropWallets)
        .set({
          reservedCents: wallet.reservedCents + labelCents,
          updatedAt:     new Date(),
        })
        .where(eq(dropWallets.id, wallet.id));

      await tx.insert(dropWalletTransactions).values({
        walletId:    wallet.id,
        type:        "shipping_payment",
        amountCents: labelCents,
        orderId:     req.params.orderId ?? null,
        description: description ?? `Shipping label${carrier ? ` (${carrier})` : ""}`,
      });
    });

    // Optionally update order tracking
    if (trackingNumber || carrier) {
      await db
        .update(orders)
        .set({
          ...(trackingNumber && { trackingNumber }),
          ...(carrier && { carrier }),
          status:    "shipped",
          shippedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(orders.id, req.params.orderId), eq(orders.ownerId, sellerId)));
    }

    res.json({ paid: true, labelCents, deductedFromWallet: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to pay shipping from wallet" });
  }
});

export default router;
