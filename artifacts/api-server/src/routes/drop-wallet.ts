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
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requireStripe, PLATFORM_COMMISSION_RATE } from "../lib/stripe";

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
    req.log.error({ err }, "Failed to create wallet");
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
    req.log.error({ err }, "Failed to get wallet");
    res.status(500).json({ error: "Failed to get wallet" });
  }
});

// ── POST /api/drop-wallets/:dropId/deposit ────────────────────────────────────
// Called by sellers to manually credit a wallet, or via webhook auto-credit.
// Uses SELECT FOR UPDATE to prevent concurrent duplicate deposits.

router.post("/:dropId/deposit", async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const { orderId, amountCents, stripeTransferId } = req.body;

    if (!orderId || typeof amountCents !== "number") {
      res.status(400).json({ error: "orderId and amountCents required" }); return;
    }

    await db.transaction(async (tx) => {
      // Lock wallet row — prevents concurrent deposits from double-crediting
      const lockResult = await tx.execute(
        sql`SELECT id FROM drop_wallets WHERE drop_id = ${req.params.dropId}::uuid AND seller_id = ${sellerId} FOR UPDATE LIMIT 1`,
      );
      const walletRow = (lockResult as any).rows?.[0];
      if (!walletRow) { throw Object.assign(new Error("Wallet not found"), { status: 404 }); }

      // Atomic balance increment (no read-modify-write race)
      await tx.execute(
        sql`UPDATE drop_wallets SET balance_cents = balance_cents + ${amountCents}, updated_at = NOW() WHERE id = ${walletRow.id}::uuid`,
      );

      await tx.insert(dropWalletTransactions).values({
        walletId:         walletRow.id as string,
        type:             "deposit",
        amountCents,
        orderId:          orderId ?? null,
        description:      "Buyer order payment",
        stripeTransferId: stripeTransferId ?? null,
      });
    });

    res.json({ deposited: true, amountCents });
  } catch (err: any) {
    if (err.status && err.status < 500) { res.status(err.status).json({ error: err.message }); return; }
    req.log.error({ err }, "Failed to deposit into wallet");
    res.status(500).json({ error: "Failed to deposit" });
  }
});

// ── POST /api/drop-wallets/:dropId/release-order/:orderId ─────────────────────
// Release a specific order's share from the platform's escrow to the seller.
//
// Architecture (separate charges + transfers model):
//   • Buyer checkout lands the full payment on the PLATFORM's Stripe account
//     (no transfer_data.destination on drop checkouts).
//   • This endpoint creates a Stripe Transfer from platform → seller Connect,
//     net of the 5% platform commission.
//   • Uses SELECT FOR UPDATE to prevent concurrent double-releases.
//
// Triggered automatically by PATCH /api/orders/:id/tracking (on ship).
// Also callable manually by the seller if auto-release failed.

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
    if (!order.trackingNumber) {
      res.status(400).json({ error: "Order has no tracking number — ship it first" }); return;
    }

    // Get seller's Connect account before the locked transaction
    const [user] = await db
      .select({ stripeAccountId: users.stripeAccountId })
      .from(users)
      .where(eq(users.clerkId, sellerId))
      .limit(1);
    if (!user?.stripeAccountId) {
      res.status(400).json({ error: "Seller has no Connect account configured" }); return;
    }

    const releaseCents  = order.subtotalCents;
    const feeCents      = Math.round(releaseCents * PLATFORM_COMMISSION_RATE);
    const transferCents = releaseCents - feeCents;

    let stripeTransferId: string | null = null;
    let resp: { releaseCents: number; orderNumber: string } | null = null;

    await db.transaction(async (tx) => {
      // Lock wallet row — prevents concurrent double-releases
      const lockResult = await tx.execute(
        sql`SELECT id, balance_cents, released_cents, reserved_cents, stripe_transfer_group FROM drop_wallets WHERE drop_id = ${req.params.dropId}::uuid AND seller_id = ${sellerId} FOR UPDATE LIMIT 1`,
      );
      const w = (lockResult as any).rows?.[0];
      if (!w) { throw Object.assign(new Error("Wallet not found"), { status: 404 }); }

      // Idempotency: abort if already released for this exact order
      const already = await tx.execute(
        sql`SELECT id FROM drop_wallet_transactions WHERE wallet_id = ${w.id}::uuid AND order_id = ${req.params.orderId}::uuid AND type = 'release' LIMIT 1`,
      );
      if ((already as any).rows?.length > 0) {
        throw Object.assign(new Error("This order's share has already been released"), { status: 409 });
      }

      const available = w.balance_cents - w.released_cents - w.reserved_cents;
      if (available < releaseCents) {
        throw Object.assign(new Error(
          `Insufficient wallet balance. Available: $${(available / 100).toFixed(2)}, need: $${(releaseCents / 100).toFixed(2)}`
        ), { status: 400 });
      }

      // Platform → seller Connect transfer (correct escrow release mechanism)
      if (transferCents > 0) {
        const transfer = await stripe.transfers.create({
          amount:         transferCents,
          currency:       "usd",
          destination:    user.stripeAccountId!,
          transfer_group: w.stripe_transfer_group ?? `drop_${req.params.dropId}`,
          metadata:       { dropId: req.params.dropId, orderId: req.params.orderId, sellerId },
        });
        stripeTransferId = transfer.id;
      }

      // Atomic balance update — no read-modify-write race
      await tx.execute(
        sql`UPDATE drop_wallets SET released_cents = released_cents + ${releaseCents}, updated_at = NOW() WHERE id = ${w.id}::uuid`,
      );

      await tx.insert(dropWalletTransactions).values({
        walletId:         w.id as string,
        type:             "release",
        amountCents:      releaseCents,
        orderId:          req.params.orderId,
        description:      `Per-order release for #${order.orderNumber} (transferred: $${(transferCents / 100).toFixed(2)}, fee: $${(feeCents / 100).toFixed(2)})`,
        stripeTransferId: stripeTransferId ?? undefined,
      });

      resp = { releaseCents, orderNumber: order.orderNumber };
    });

    res.json({
      released:         true,
      releaseCents:     resp!.releaseCents,
      transferCents,
      feeCents,
      stripeTransferId,
      orderNumber:      resp!.orderNumber,
    });
  } catch (err: any) {
    if (err.status && err.status < 500) {
      res.status(err.status).json({ error: err.message }); return;
    }
    req.log.error({ err }, "Failed to release order share");
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
    req.log.error({ err }, "Failed to pay shipping from wallet");
    res.status(500).json({ error: "Failed to pay shipping from wallet" });
  }
});

export default router;
