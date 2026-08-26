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
import { eq, sql, desc, and, inArray, isNull } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();
router.use(requireAuth);

type LoyaltyAward = {
  buyerId: string;
  points: number;
  source: "purchase" | "order_earn" | "referral" | "signup" | "bonus";
  referenceId: string;
  note?: string;
};

export class LoyaltyRedemptionError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code = "LOYALTY_TOKEN_INVALID",
  ) {
    super(message);
  }
}

type LoyaltyRedemption = {
  token: string;
  discountCents: number;
  pointsUsed: number;
};

/**
 * Validate and reserve a previously redeemed token for exactly one checkout.
 * The points were deducted when the buyer created the token; this reservation
 * stops that value being attached to multiple open Checkout Sessions.
 */
export async function reserveLoyaltyRedemption(
  buyerId: string,
  token: string,
  checkoutReservationId: string,
  orderTotalBeforeDiscountCents: number,
): Promise<LoyaltyRedemption> {
  const normalizedToken = String(token ?? "").trim().toUpperCase();
  if (!normalizedToken || normalizedToken.length > 160) {
    throw new LoyaltyRedemptionError("Enter a valid rewards token.");
  }
  if (!Number.isInteger(orderTotalBeforeDiscountCents) || orderTotalBeforeDiscountCents < 1) {
    throw new LoyaltyRedemptionError("This order is not eligible for a rewards discount.");
  }

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`loyalty-redemption:${normalizedToken}`}))`,
    );
    const [redemption] = await tx
      .select({
        points: loyaltyPoints.points,
        checkoutSessionId: loyaltyPoints.checkoutSessionId,
        usedAt: loyaltyPoints.usedAt,
      })
      .from(loyaltyPoints)
      .where(and(
        eq(loyaltyPoints.buyerId, buyerId),
        eq(loyaltyPoints.source, "redemption"),
        eq(loyaltyPoints.referenceId, normalizedToken),
      ))
      .limit(1);

    if (!redemption || redemption.points >= 0) {
      throw new LoyaltyRedemptionError("This rewards token is not valid for your account.");
    }
    if (redemption.usedAt) {
      throw new LoyaltyRedemptionError("This rewards token has already been used.", 409, "LOYALTY_TOKEN_USED");
    }
    if (
      redemption.checkoutSessionId &&
      redemption.checkoutSessionId !== checkoutReservationId
    ) {
      throw new LoyaltyRedemptionError(
        "This rewards token is already being used for another checkout.",
        409,
        "LOYALTY_TOKEN_RESERVED",
      );
    }

    const discountCents = -redemption.points;
    if (discountCents >= orderTotalBeforeDiscountCents) {
      throw new LoyaltyRedemptionError(
        "Choose fewer points so your order still has a balance to pay.",
        400,
        "LOYALTY_DISCOUNT_TOO_LARGE",
      );
    }

    await tx
      .update(loyaltyPoints)
      .set({ checkoutSessionId: checkoutReservationId })
      .where(and(
        eq(loyaltyPoints.buyerId, buyerId),
        eq(loyaltyPoints.source, "redemption"),
        eq(loyaltyPoints.referenceId, normalizedToken),
        isNull(loyaltyPoints.usedAt),
      ));

    return { token: normalizedToken, discountCents, pointsUsed: discountCents };
  });
}

/** Bind a reservation to the durable server-side checkout record. */
export async function bindLoyaltyRedemptionToCheckout(
  buyerId: string,
  token: string,
  reservationId: string,
  checkoutRecordId: string,
): Promise<void> {
  const [updated] = await db
    .update(loyaltyPoints)
    .set({ checkoutSessionId: checkoutRecordId })
    .where(and(
      eq(loyaltyPoints.buyerId, buyerId),
      eq(loyaltyPoints.source, "redemption"),
      eq(loyaltyPoints.referenceId, token),
      eq(loyaltyPoints.checkoutSessionId, reservationId),
      isNull(loyaltyPoints.usedAt),
    ))
    .returning({ id: loyaltyPoints.id });

  if (!updated) {
    throw new LoyaltyRedemptionError("This rewards token could not be attached to checkout.", 409);
  }
}

/** Mark a redemption used in the same transaction that creates its paid order. */
export async function consumeLoyaltyRedemption(
  transaction: any,
  buyerId: string,
  token: string,
  checkoutRecordId: string,
  orderId: string,
): Promise<void> {
  const [consumed] = await transaction
    .update(loyaltyPoints)
    .set({ usedAt: new Date(), usedOrderId: orderId })
    .where(and(
      eq(loyaltyPoints.buyerId, buyerId),
      eq(loyaltyPoints.source, "redemption"),
      eq(loyaltyPoints.referenceId, token),
      eq(loyaltyPoints.checkoutSessionId, checkoutRecordId),
      isNull(loyaltyPoints.usedAt),
    ))
    .returning({ id: loyaltyPoints.id });

  if (!consumed) {
    throw new LoyaltyRedemptionError(
      "The rewards discount could not be finalized for this order.",
      409,
      "LOYALTY_TOKEN_NOT_RESERVED",
    );
  }
}

/** A refunded oversold order leaves the buyer's existing token usable. */
export async function releaseLoyaltyRedemption(
  transaction: any,
  buyerId: string,
  token: string,
  checkoutRecordId: string,
): Promise<void> {
  await transaction
    .update(loyaltyPoints)
    .set({ checkoutSessionId: null })
    .where(and(
      eq(loyaltyPoints.buyerId, buyerId),
      eq(loyaltyPoints.source, "redemption"),
      eq(loyaltyPoints.referenceId, token),
      eq(loyaltyPoints.checkoutSessionId, checkoutRecordId),
      isNull(loyaltyPoints.usedAt),
    ));
}

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
  // Serialize order awards under one key so the canonical order_earn source
  // and legacy purchase source cannot race with a refund/cancellation.
  const lockKey =
    award.source === "purchase" || award.source === "order_earn"
      ? `purchase:${award.referenceId}`
      : `${award.source}:${award.referenceId}`;
  await transaction.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`,
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
      inArray(loyaltyPoints.source, ["purchase", "order_earn"]),
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
// Point awards are written by trusted server-side helpers, never by a buyer.
router.post("/earn", async (req, res) => {
  return res.status(403).json({
    error: "Points are awarded only by verified server-side events.",
  });
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

  const discountCents = points;  // 100 pts = $1.00 = 100 cents
  const token = `LOYAL-${clerkId.slice(-6).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
  try {
    await db.transaction(async (tx) => {
      // Serializing on buyer ID prevents concurrent requests from observing the
      // same balance and creating more token value than the buyer owns.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`loyalty-balance:${clerkId}`}))`,
      );
      const [balanceRow] = await tx
        .select({ total: sql<number>`COALESCE(SUM(${loyaltyPoints.points}), 0)` })
        .from(loyaltyPoints)
        .where(eq(loyaltyPoints.buyerId, clerkId));
      const balance = Number(balanceRow?.total ?? 0);
      if (points > balance) {
        throw new LoyaltyRedemptionError(
          `Insufficient points. You have ${balance} pts.`,
          400,
          "INSUFFICIENT_POINTS",
        );
      }
      await tx.insert(loyaltyPoints).values({
        buyerId:     clerkId,
        points:      -points,
        source:      "redemption",
        referenceId: token,
        note:        `Redeemed ${points} pts for $${(discountCents / 100).toFixed(2)} off`,
      });
    });
  } catch (error) {
    if (error instanceof LoyaltyRedemptionError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    throw error;
  }

  return res.json({
    ok:           true,
    pointsUsed:   points,
    discountCents,
    token,        // client passes this to /api/buyer/checkout to apply the discount
  });
});

export default router;
