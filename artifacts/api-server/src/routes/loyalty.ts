/**
 * Buyer Loyalty / Rewards Points
 *
 * GET  /api/loyalty         — balance + history (buyer)
 * POST /api/loyalty/earn    — internal: award points (called by orders, referrals)
 * POST /api/loyalty/redeem  — buyer redeems points for a discount token
 *
 * Point rules:
 *  • 1 point per $1 spent on a completed order (purchase)
 *  • 500 points per successful referral (credited to inviter)
 *  • 100 points on first signup
 *  • 100 points = $1.00 discount
 *  • Minimum redemption: 100 pts ($1.00)
 */
import { Router } from "express";
import { db, loyaltyPoints, users } from "@workspace/db";
import { eq, sql, desc, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();
router.use(requireAuth);

// ─── GET /api/loyalty ─────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;

  const [balanceRow] = await db
    .select({ total: sql<number>`COALESCE(SUM(${loyaltyPoints.points}), 0)` })
    .from(loyaltyPoints)
    .where(eq(loyaltyPoints.buyerId, clerkId));

  const history = await db
    .select()
    .from(loyaltyPoints)
    .where(eq(loyaltyPoints.buyerId, clerkId))
    .orderBy(desc(loyaltyPoints.createdAt))
    .limit(50);

  const balance = Number(balanceRow?.total ?? 0);

  return res.json({
    balance,
    valueCents: Math.floor(balance),   // 100 pts = $1 = 100 cents
    history,
  });
});

// ─── POST /api/loyalty/earn ───────────────────────────────────────────────────
// Internal endpoint — called by orders completion, referrals, and signup.
// Also accessible externally for awarding points programmatically.
router.post("/earn", async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const { buyerId, points, source, referenceId, note } = req.body as {
    buyerId?:     string;
    points?:      number;
    source?:      string;
    referenceId?: string;
    note?:        string;
  };

  // Allow awarding to a different buyerId (e.g. inviter credit during referral apply)
  const targetId = buyerId ?? clerkId;

  if (!points || points <= 0 || !Number.isInteger(points)) {
    return res.status(400).json({ error: "points must be a positive integer" });
  }
  if (!source || !["purchase", "referral", "signup", "bonus"].includes(source)) {
    return res.status(400).json({ error: "source required: purchase|referral|signup|bonus" });
  }

  const [row] = await db
    .insert(loyaltyPoints)
    .values({ buyerId: targetId, points, source, referenceId: referenceId ?? null, note: note ?? null })
    .returning();

  return res.status(201).json(row);
});

// ─── POST /api/loyalty/redeem ─────────────────────────────────────────────────
// Buyer redeems points for a discount at checkout.
// Returns { discountCents, token } — mobile passes token to checkout.
router.post("/redeem", async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const { points: rawPoints } = req.body as { points?: number };
  const points = Math.floor(Number(rawPoints));

  if (!points || points < 100) {
    return res.status(400).json({ error: "Minimum redemption is 100 points" });
  }

  // Check balance
  const [balanceRow] = await db
    .select({ total: sql<number>`COALESCE(SUM(${loyaltyPoints.points}), 0)` })
    .from(loyaltyPoints)
    .where(eq(loyaltyPoints.buyerId, clerkId));

  const balance = Number(balanceRow?.total ?? 0);

  if (points > balance) {
    return res.status(400).json({
      error: `Insufficient points. You have ${balance} pts.`,
      code: "INSUFFICIENT_POINTS",
    });
  }

  // Deduct points (negative ledger entry)
  const discountCents = points;  // 100 pts = $1.00 = 100 cents
  const token = `LOYAL-${clerkId.slice(-6).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;

  await db.insert(loyaltyPoints).values({
    buyerId:     clerkId,
    points:      -points,
    source:      "redemption",
    referenceId: token,
    note:        `Redeemed ${points} pts for $${(discountCents / 100).toFixed(2)} off`,
  });

  return res.json({
    ok:           true,
    pointsUsed:   points,
    discountCents,
    token,        // client passes this to /api/buyer/checkout to apply the discount
  });
});

export default router;
