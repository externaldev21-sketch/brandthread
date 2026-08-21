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
import { db, loyaltyPoints } from "@workspace/db";
import { eq, sql, desc, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();
router.use(requireAuth);

type LoyaltyAward = {
  buyerId: string;
  points: number;
  source: "purchase" | "referral" | "signup" | "bonus";
  referenceId: string;
  note?: string;
};

/**
 * Add a one-time loyalty ledger entry.
 *
 * Callers provide a stable reference ID (the order ID, Clerk ID, etc.). We
 * check before inserting for a clear fast path; a transaction-scoped lock is
 * the concurrency-safe guard when retries overlap.
 */
export async function awardLoyaltyPointsOnce(
  award: LoyaltyAward,
  transaction?: any,
): Promise<{ created: boolean; row: { id: string } | undefined }> {
  if (transaction) {
    return insertLoyaltyAwardOnce(transaction, award);
  }

  return db.transaction((tx) => insertLoyaltyAwardOnce(tx, award));
}

async function insertLoyaltyAwardOnce(
  transaction: any,
  award: LoyaltyAward,
): Promise<{ created: boolean; row: { id: string } | undefined }> {
  // Serialize only attempts for this source/reference pair. This makes the
  // lookup-and-insert sequence safe for concurrent Stripe webhook deliveries
  // without imposing a new constraint on historical ledger rows.
  await transaction.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`${award.source}:${award.referenceId}`}))`,
  );

  const [existing] = await transaction
    .select({ id: loyaltyPoints.id })
    .from(loyaltyPoints)
    .where(and(
      eq(loyaltyPoints.source, award.source),
      eq(loyaltyPoints.referenceId, award.referenceId),
    ))
    .limit(1);

  if (existing) {
    return { created: false, row: existing };
  }

  const [created] = await transaction
    .insert(loyaltyPoints)
    .values({
      buyerId: award.buyerId,
      points: award.points,
      source: award.source,
      referenceId: award.referenceId,
      note: award.note ?? null,
    })
    .returning({ id: loyaltyPoints.id });

  return { created: true, row: created };
}

type PurchaseReversal = {
  buyerId: string;
  orderId: string;
  referenceId: string;
  requestedPoints: number;
  note?: string;
};

/**
 * Reverse points from a refund or cancellation without ever taking back more
 * than the corresponding purchase award. Each refund action gets its own
 * stable reference ID, so retries remain safe while multiple partial refunds
 * can be applied proportionally.
 */
export async function reversePurchasePointsOnce(
  reversal: PurchaseReversal,
  transaction?: any,
): Promise<{ created: boolean; pointsReversed: number }> {
  if (transaction) {
    return insertPurchaseReversalOnce(transaction, reversal);
  }

  return db.transaction((tx) => insertPurchaseReversalOnce(tx, reversal));
}

async function insertPurchaseReversalOnce(
  transaction: any,
  reversal: PurchaseReversal,
): Promise<{ created: boolean; pointsReversed: number }> {
  // Purchase awards and reversals share this lock. A cancellation cannot be
  // interleaved between a paid order committing and its reward being recorded.
  await transaction.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`purchase:${reversal.orderId}`}))`,
  );

  const [purchase] = await transaction
    .select({ points: loyaltyPoints.points })
    .from(loyaltyPoints)
    .where(and(
      eq(loyaltyPoints.buyerId, reversal.buyerId),
      eq(loyaltyPoints.source, "purchase"),
      eq(loyaltyPoints.referenceId, reversal.orderId),
    ))
    .limit(1);

  if (!purchase || purchase.points < 1 || reversal.requestedPoints < 1) {
    return { created: false, pointsReversed: 0 };
  }

  const [existing] = await transaction
    .select({ id: loyaltyPoints.id })
    .from(loyaltyPoints)
    .where(and(
      eq(loyaltyPoints.source, "purchase_reversal"),
      eq(loyaltyPoints.referenceId, reversal.referenceId),
    ))
    .limit(1);
  if (existing) {
    return { created: false, pointsReversed: 0 };
  }

  const [reversed] = await transaction
    .select({
      total: sql<number>`COALESCE(SUM(${loyaltyPoints.points}), 0)`,
    })
    .from(loyaltyPoints)
    .where(and(
      eq(loyaltyPoints.buyerId, reversal.buyerId),
      eq(loyaltyPoints.source, "purchase_reversal"),
      sql`${loyaltyPoints.referenceId} LIKE ${`${reversal.orderId}:%`}`,
    ));

  const availableToReverse = Math.max(0, purchase.points + Number(reversed?.total ?? 0));
  const pointsToReverse = Math.min(reversal.requestedPoints, availableToReverse);
  if (pointsToReverse < 1) {
    return { created: false, pointsReversed: 0 };
  }

  await transaction.insert(loyaltyPoints).values({
    buyerId: reversal.buyerId,
    points: -pointsToReverse,
    source: "purchase_reversal",
    referenceId: reversal.referenceId,
    note: reversal.note ?? `Purchase reward reversed for order ${reversal.orderId}`,
  });

  return { created: true, pointsReversed: pointsToReverse };
}

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
