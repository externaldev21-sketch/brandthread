/**
 * In-app opt-in to a store's email list — the "Get emails from {store}"
 * box at checkout and on Follow (unticked by default; the app only calls
 * this when the buyer ticks it).
 *
 * POST /api/buyer/email-opt-in   { sellerId, source: "checkout" | "follow" }
 *
 * Uses the signed-in buyer's own account email (already verified at sign-up),
 * so there is no confirmation email; consent time and a hashed IP are kept
 * as evidence, like the web-store form. Unsubscribe links in every campaign
 * work the same way.
 */
import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, storefronts, users } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { rateLimit } from "../middlewares/rateLimit";
import { subscribeEmail } from "../lib/emailMarketing/subscribers";
import { hashIp } from "../lib/emailMarketing/tokens";

const router = Router();
const SOURCES = new Set(["checkout", "follow"]);

router.post("/", requireAuth, rateLimit("mutation"), async (req, res): Promise<void> => {
  const buyerId = (req as any).clerkUserId as string;
  const sellerId = typeof req.body?.sellerId === "string" ? req.body.sellerId.trim() : "";
  const source = typeof req.body?.source === "string" ? req.body.source : "";
  if (!sellerId || !SOURCES.has(source)) {
    res.status(400).json({ error: "sellerId and source (checkout or follow) are required" });
    return;
  }
  if (sellerId === buyerId) { res.status(400).json({ error: "You can't join your own list" }); return; }
  const [[store], [buyer]] = await Promise.all([
    db.select({ id: storefronts.id }).from(storefronts).where(eq(storefronts.ownerId, sellerId)).limit(1),
    db.select({ email: users.email }).from(users).where(eq(users.clerkId, buyerId)).limit(1),
  ]);
  if (!store) { res.status(404).json({ error: "Store not found" }); return; }
  if (!buyer?.email) { res.status(400).json({ error: "Add an email to your account first" }); return; }
  const outcome = await subscribeEmail({
    sellerId, email: buyer.email, source, ipHash: hashIp(req.ip), doubleOptIn: false,
  });
  res.json({ status: outcome.status });
});

export default router;
