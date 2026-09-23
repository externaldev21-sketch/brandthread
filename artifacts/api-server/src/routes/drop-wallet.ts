/**
 * Drop Wallet — the seller's view of one preorder drop's held funds.
 * Mounted at /api/drop-wallets
 *
 * GET  /:dropId                          balance, per-order releases, activity
 * POST /:dropId                          create the wallet (it is also created
 *                                        automatically with the first preorder)
 * POST /:dropId/release-order/:orderId   retry one order's release (the same
 *                                        release that runs automatically when
 *                                        the order gets a tracking number)
 *
 * Money only enters a wallet through a paid Stripe checkout (webhook) and only
 * leaves it through lib/money: bulk payments, in-app labels, per-order
 * releases and refunds. Sellers can never credit a wallet or move money out
 * of it by stating an amount.
 */
import { Router } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, drops, dropWallets, dropWalletTransactions, orderReleases, orders } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { accountBalanceCents } from "../lib/money/ledger";
import { releaseOrderFunds } from "../lib/money/escrow";

const router = Router();
router.use(requireAuth);

function iso<T extends { createdAt: Date; updatedAt?: Date }>(row: T) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    ...(row.updatedAt ? { updatedAt: row.updatedAt.toISOString() } : {}),
  };
}

// ── POST /api/drop-wallets/:dropId ────────────────────────────────────────────
router.post("/:dropId", async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const [drop] = await db.select({ id: drops.id, type: drops.type }).from(drops)
      .where(and(eq(drops.id, req.params.dropId), eq(drops.ownerId, sellerId))).limit(1);
    if (!drop) { res.status(404).json({ error: "Drop not found" }); return; }
    if (drop.type !== "pre-order") {
      res.status(409).json({ error: "Only preorder drops hold funds", code: "NOT_A_PREORDER_DROP" });
      return;
    }
    // Only the request that actually creates the wallet gets 201.
    const [created] = await db.insert(dropWallets).values({
      dropId: drop.id,
      sellerId,
      stripeTransferGroup: `drop_${drop.id}`,
    }).onConflictDoNothing({ target: dropWallets.dropId }).returning();
    if (created) { res.status(201).json(iso(created)); return; }
    const [wallet] = await db.select().from(dropWallets)
      .where(and(eq(dropWallets.dropId, drop.id), eq(dropWallets.sellerId, sellerId))).limit(1);
    if (!wallet) { res.status(404).json({ error: "Drop not found" }); return; }
    res.json(iso(wallet));
  } catch (err) {
    req.log.error({ err }, "Failed to create wallet");
    res.status(500).json({ error: "Failed to create wallet" });
  }
});

// ── GET /api/drop-wallets/:dropId ─────────────────────────────────────────────
router.get("/:dropId", async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const [wallet] = await db.select().from(dropWallets)
      .where(and(eq(dropWallets.dropId, req.params.dropId), eq(dropWallets.sellerId, sellerId)))
      .limit(1);
    if (!wallet) { res.status(404).json({ error: "Wallet not found" }); return; }

    const [txns, releases, [drop], heldCents] = await Promise.all([
      db.select().from(dropWalletTransactions)
        .where(eq(dropWalletTransactions.walletId, wallet.id))
        .orderBy(desc(dropWalletTransactions.createdAt))
        .limit(50),
      db.select({
        orderId: orderReleases.orderId,
        orderNumber: orders.orderNumber,
        state: orderReleases.state,
        amountCents: orderReleases.amountCents,
        labelCents: orderReleases.labelCents,
        bulkShareCents: orderReleases.bulkShareCents,
        reversedCents: orderReleases.reversedCents,
        stripeTransferId: orderReleases.stripeTransferId,
        lastErrorCode: orderReleases.lastErrorCode,
        paidAt: orderReleases.paidAt,
      }).from(orderReleases)
        .innerJoin(orders, eq(orders.id, orderReleases.orderId))
        .where(and(eq(orderReleases.dropId, wallet.dropId), eq(orderReleases.sellerId, sellerId)))
        .orderBy(desc(orderReleases.createdAt))
        .limit(100),
      db.select({
        escrowState: drops.escrowState,
        fulfillmentDeadlineAt: drops.fulfillmentDeadlineAt,
        escrowFailureReason: drops.escrowFailureReason,
      }).from(drops).where(eq(drops.id, wallet.dropId)).limit(1),
      accountBalanceCents(db, { account: "seller_held", partyId: sellerId, dropId: wallet.dropId }),
    ]);

    res.json({
      ...iso(wallet),
      // What the ledger says is held for this drop right now. Negative means
      // refunds exceeded what was left after bulk/labels: the seller owes it.
      heldCents,
      availableCents: wallet.balanceCents - wallet.releasedCents - wallet.reservedCents,
      shortfallCents: heldCents < 0 ? -heldCents : 0,
      escrowState: drop?.escrowState ?? null,
      fulfillmentDeadlineAt: drop?.fulfillmentDeadlineAt?.toISOString() ?? null,
      escrowFailureReason: drop?.escrowFailureReason ?? null,
      releases: releases.map((r) => ({ ...r, paidAt: r.paidAt?.toISOString() ?? null })),
      transactions: txns.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get wallet");
    res.status(500).json({ error: "Failed to get wallet" });
  }
});

// ── Removed: seller-stated deposits and label payments ────────────────────────
// Deposits happen automatically when Stripe confirms a preorder payment.
// Labels are bought through /api/shipping-labels, which pays from the order's
// held funds and triggers that order's release.
router.post("/:dropId/deposit", (_req, res) => {
  res.status(410).json({
    error: "Preorder payments are added to the drop automatically when Stripe confirms them.",
    code: "DEPOSITS_ARE_AUTOMATIC",
  });
});
router.post("/:dropId/pay-shipping/:orderId", (_req, res) => {
  res.status(410).json({
    error: "Buy the label in-app from the order screen; it is paid from that order's held funds.",
    code: "USE_IN_APP_LABELS",
  });
});

// ── POST /api/drop-wallets/:dropId/release-order/:orderId ─────────────────────
router.post("/:dropId/release-order/:orderId", async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const [order] = await db.select({ id: orders.id, orderNumber: orders.orderNumber }).from(orders).where(and(
      eq(orders.id, req.params.orderId),
      sql`${orders.dropId} = ${req.params.dropId}::uuid`,
      eq(orders.ownerId, sellerId),
    )).limit(1);
    if (!order) { res.status(404).json({ error: "Order not found for this drop" }); return; }

    const result = await releaseOrderFunds(order.id, "manual");
    switch (result.status) {
      case "no_tracking":
        res.status(409).json({ error: "Add tracking to this order first — funds release when it ships.", code: "NO_TRACKING" });
        return;
      case "not_held":
        res.status(409).json({ error: "This order was paid to you directly and has nothing held.", code: "NOT_HELD" });
        return;
      case "funds_not_held":
        res.status(409).json({ error: "This order's funds are no longer held (refunded).", code: "FUNDS_NOT_HELD" });
        return;
      case "drop_closed":
        res.status(409).json({ error: "This drop is being refunded, so funds cannot be released.", code: "DROP_CLOSED" });
        return;
      case "not_found":
        res.status(404).json({ error: "Order not found for this drop" });
        return;
    }
    const execution = result.execution;
    const released = execution?.state === "paid";
    res.status(released ? 200 : 202).json({
      released,
      state: execution?.state ?? "pending",
      orderNumber: order.orderNumber,
      amountCents: execution?.amountCents ?? 0,
      stripeTransferId: execution?.stripeTransferId ?? null,
      ...(execution?.errorCode ? { code: execution.errorCode } : {}),
    });
  } catch (err: any) {
    req.log.error({ err }, "Failed to release order share");
    res.status(500).json({ error: "Failed to release order share" });
  }
});

export default router;
