/**
 * Apple Wallet passes for pre-orders.
 *
 *   GET  /api/wallet/status                 → { enabled } (public; the app hides the button when false)
 *   POST /api/wallet/orders/:id/link        → { path } a 10-minute signed download path (buyer's own pre-order)
 *   GET  /api/wallet/passes/:token          → application/vnd.apple.pkpass (the signed link is the auth)
 *
 * Off until every APPLE_WALLET_* key is set (lib/walletPass/config.ts).
 */
import { Router } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, orderItems, orders, users } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { walletPassConfig } from "../lib/walletPass/config";
import { createWalletLinkToken, readWalletLinkToken } from "../lib/walletPass/linkToken";
import { buildPreorderPass, isWalletEligible } from "../lib/walletPass/pass";

const router = Router();

function linkSecret(): string | null {
  return process.env.SESSION_SECRET?.trim() || null;
}

async function loadBuyerPreorder(orderId: string, buyerId: string) {
  const [row] = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      isPreorder: orders.isPreorder,
      promisedShipDate: orders.promisedShipDate,
      shippedAt: orders.shippedAt,
      storeName: users.brandName,
      sellerDisplayName: users.displayName,
    })
    .from(orders)
    .leftJoin(users, eq(users.clerkId, orders.ownerId))
    .where(and(eq(orders.id, orderId), eq(orders.buyerId, buyerId)))
    .limit(1);
  return row ?? null;
}

router.get("/status", (_req, res) => {
  res.json({ enabled: walletPassConfig() !== null && linkSecret() !== null });
});

router.post("/orders/:id/link", requireAuth, async (req, res) => {
  const buyerId = (req as any).clerkUserId as string;
  const orderId = String(req.params.id);
  const secret = linkSecret();
  if (!walletPassConfig() || !secret) return res.status(404).json({ error: "wallet_unavailable" });
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return res.status(404).json({ error: "Order not found" });
  try {
    const order = await loadBuyerPreorder(orderId, buyerId);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (!isWalletEligible(order)) return res.status(409).json({ error: "not_a_preorder" });
    return res.json({ path: `/api/wallet/passes/${createWalletLinkToken(order.id, buyerId, secret)}` });
  } catch (err) {
    req.log.error({ err, orderId }, "Failed to create wallet pass link");
    return res.status(500).json({ error: "Failed to create wallet pass link" });
  }
});

router.get("/passes/:token", async (req, res) => {
  const cfg = walletPassConfig();
  const secret = linkSecret();
  if (!cfg || !secret) return res.status(404).json({ error: "wallet_unavailable" });
  const claims = readWalletLinkToken(String(req.params.token).replace(/\.pkpass$/, ""), secret);
  if (!claims) return res.status(410).json({ error: "This link has expired. Open the order in Brandthread and try again." });
  try {
    const order = await loadBuyerPreorder(claims.orderId, claims.buyerId);
    if (!order || !isWalletEligible(order)) return res.status(404).json({ error: "Order not found" });
    const items = await db
      .select({ productName: orderItems.productName })
      .from(orderItems)
      .where(inArray(orderItems.orderId, [order.id]));
    const pass = buildPreorderPass({
      orderId: order.id,
      orderNumber: order.orderNumber,
      productName: items[0]?.productName ?? "Pre-order",
      moreCount: Math.max(0, items.length - 1),
      storeName: order.storeName || order.sellerDisplayName || "Brandthread store",
      promisedShipDate: order.promisedShipDate,
    }, cfg);
    res.setHeader("Content-Type", "application/vnd.apple.pkpass");
    res.setHeader("Content-Disposition", `attachment; filename="${order.orderNumber}.pkpass"`);
    res.setHeader("Cache-Control", "no-store");
    return res.send(pass);
  } catch (err) {
    req.log.error({ err, orderId: claims.orderId }, "Failed to build wallet pass");
    return res.status(500).json({ error: "Failed to build wallet pass" });
  }
});

export default router;
