/**
 * Thread Cash wallet: balance, daily check-in award, and checkout redemption
 * reservation. Same append-only, SUM()-is-the-balance shape as
 * routes/loyalty.ts, kept as its own ledger (thread_cash_entries) rather than
 * folded into loyalty_points, since Thread Cash has its own rules (streaks,
 * optional expiry) and must never be confused with loyalty points.
 *
 * Money only ever enters a buyer's balance through a server-computed award
 * (check-in, streak bonus, refund credit) — a buyer can never state an
 * amount and have it credited.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, pool, threadCashConfig, threadCashEntries, threadCashTransfers } from "@workspace/db";
import { DEFAULT_THREAD_CASH_CONFIG, type ThreadCashConfig } from "./streaks";

export class ThreadCashError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code = "THREAD_CASH_ERROR",
  ) {
    super(message);
  }
}

/** Anything with drizzle's query API: the db itself or an open transaction. */
type DbExecutor = Pick<typeof db, "select" | "insert" | "update" | "execute">;

export async function getThreadCashConfig(executor: DbExecutor = db): Promise<ThreadCashConfig> {
  const [row] = await executor.select().from(threadCashConfig).where(eq(threadCashConfig.id, "default")).limit(1);
  if (!row) return DEFAULT_THREAD_CASH_CONFIG;
  return {
    dailyAmountCents: row.dailyAmountCents,
    streakBonusCents: row.streakBonusCents,
    streakBonusDays: row.streakBonusDays,
    graceHours: row.graceHours,
    expiryDays: row.expiryDays,
    maxRedemptionPerOrderCents: row.maxRedemptionPerOrderCents,
  };
}

export async function getBalanceCents(executor: DbExecutor, buyerId: string): Promise<number> {
  const [row] = await executor
    .select({ total: sql<string>`COALESCE(SUM(${threadCashEntries.amountCents}), 0)` })
    .from(threadCashEntries)
    .where(eq(threadCashEntries.buyerId, buyerId));
  return Number(row?.total ?? 0);
}

/** Whether a moderator-controlled feature flag is enabled (safe default: off). */
export async function isFeatureEnabled(key: string, safeDefault = false): Promise<boolean> {
  const result = await pool.query<{ enabled: boolean }>(
    `SELECT enabled FROM feature_flags WHERE key = $1`,
    [key],
  );
  return result.rows[0]?.enabled ?? safeDefault;
}

type CheckInAward = {
  buyerId: string;
  /** Buyer-local YYYY-MM-DD — the idempotency reference for this award. */
  localDate: string;
  earnedCents: number;
  streakBonusCents: number;
  deviceId?: string | null;
};

/**
 * Awards one day's Thread Cash (and streak bonus, if any) exactly once per
 * buyer-local calendar date. The unique index on
 * (buyer_id, reference_id) WHERE source = 'daily_checkin' is the ultimate
 * guard; the advisory lock just avoids a wasted round trip under a race.
 */
export async function awardDailyCheckInOnce(
  award: CheckInAward,
): Promise<{ created: boolean }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`thread-cash-checkin:${award.buyerId}:${award.localDate}`}))`);

    const [existing] = await tx
      .select({ id: threadCashEntries.id })
      .from(threadCashEntries)
      .where(and(
        eq(threadCashEntries.buyerId, award.buyerId),
        eq(threadCashEntries.source, "daily_checkin"),
        eq(threadCashEntries.referenceId, award.localDate),
      ))
      .limit(1);
    if (existing) return { created: false };

    await tx.insert(threadCashEntries).values({
      buyerId: award.buyerId,
      amountCents: award.earnedCents,
      source: "daily_checkin",
      referenceId: award.localDate,
      note: `Daily check-in (${award.localDate})`,
    });
    if (award.streakBonusCents > 0) {
      await tx.insert(threadCashEntries).values({
        buyerId: award.buyerId,
        amountCents: award.streakBonusCents,
        source: "streak_bonus",
        referenceId: award.localDate,
        note: `Streak bonus (${award.localDate})`,
      });
    }
    return { created: true };
  });
}

export async function getHistory(buyerId: string, limit = 50) {
  return db
    .select()
    .from(threadCashEntries)
    .where(eq(threadCashEntries.buyerId, buyerId))
    .orderBy(desc(threadCashEntries.createdAt))
    .limit(limit);
}

type ThreadCashRedemption = { token: string; discountCents: number };

/**
 * Deducts Thread Cash from the buyer's balance and returns a one-time
 * redemption token, mirroring routes/loyalty.ts `redeemLoyaltyPoints`. The
 * token still has to be reserved against a specific checkout
 * (reserveThreadCashRedemption) before it can discount anything.
 */
export async function redeemThreadCash(buyerId: string, amountCents: number): Promise<ThreadCashRedemption> {
  if (!Number.isInteger(amountCents) || amountCents < 1) {
    throw new ThreadCashError("Enter a valid Thread Cash amount.");
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`thread-cash-balance:${buyerId}`}))`);
    const balance = await getBalanceCents(tx, buyerId);
    if (amountCents > balance) {
      throw new ThreadCashError(`Insufficient Thread Cash. You have $${(balance / 100).toFixed(2)}.`, 400, "INSUFFICIENT_THREAD_CASH");
    }
    const token = `TCASH-${buyerId.slice(-6).toUpperCase()}-${randomUUID().toUpperCase()}`;
    await tx.insert(threadCashEntries).values({
      buyerId,
      amountCents: -amountCents,
      source: "redemption",
      referenceId: token,
      note: `Redeemed $${(amountCents / 100).toFixed(2)} Thread Cash`,
    });
    return { token, discountCents: amountCents };
  });
}

/** Reserves a previously redeemed token for exactly one checkout attempt. */
export async function reserveThreadCashRedemption(
  buyerId: string,
  token: string,
  checkoutReservationId: string,
  orderTotalBeforeDiscountCents: number,
): Promise<ThreadCashRedemption> {
  const normalizedToken = String(token ?? "").trim().toUpperCase();
  if (!normalizedToken || normalizedToken.length > 160) {
    throw new ThreadCashError("Enter a valid Thread Cash token.");
  }
  if (!Number.isInteger(orderTotalBeforeDiscountCents) || orderTotalBeforeDiscountCents < 1) {
    throw new ThreadCashError("This order is not eligible for a Thread Cash discount.");
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`thread-cash-redemption:${normalizedToken}`}))`);
    const [redemption] = await tx
      .select({
        amountCents: threadCashEntries.amountCents,
        checkoutSessionId: threadCashEntries.checkoutSessionId,
        usedAt: threadCashEntries.usedAt,
      })
      .from(threadCashEntries)
      .where(and(
        eq(threadCashEntries.buyerId, buyerId),
        eq(threadCashEntries.source, "redemption"),
        eq(threadCashEntries.referenceId, normalizedToken),
      ))
      .limit(1);

    if (!redemption || redemption.amountCents >= 0) {
      throw new ThreadCashError("This Thread Cash token is not valid for your account.");
    }
    if (redemption.usedAt) {
      throw new ThreadCashError("This Thread Cash token has already been used.", 409, "THREAD_CASH_TOKEN_USED");
    }
    if (redemption.checkoutSessionId && redemption.checkoutSessionId !== checkoutReservationId) {
      throw new ThreadCashError("This Thread Cash token is already being used for another checkout.", 409, "THREAD_CASH_TOKEN_RESERVED");
    }

    const discountCents = -redemption.amountCents;
    if (discountCents >= orderTotalBeforeDiscountCents) {
      throw new ThreadCashError("Choose less Thread Cash so your order still has a balance to pay.", 400, "THREAD_CASH_DISCOUNT_TOO_LARGE");
    }

    await tx.update(threadCashEntries)
      .set({ checkoutSessionId: checkoutReservationId })
      .where(and(
        eq(threadCashEntries.buyerId, buyerId),
        eq(threadCashEntries.source, "redemption"),
        eq(threadCashEntries.referenceId, normalizedToken),
        isNull(threadCashEntries.usedAt),
      ));

    return { token: normalizedToken, discountCents };
  });
}

export async function bindThreadCashRedemptionToCheckout(
  buyerId: string,
  token: string,
  reservationId: string,
  checkoutRecordId: string,
): Promise<void> {
  const [updated] = await db.update(threadCashEntries)
    .set({ checkoutSessionId: checkoutRecordId })
    .where(and(
      eq(threadCashEntries.buyerId, buyerId),
      eq(threadCashEntries.source, "redemption"),
      eq(threadCashEntries.referenceId, token),
      eq(threadCashEntries.checkoutSessionId, reservationId),
      isNull(threadCashEntries.usedAt),
    ))
    .returning({ id: threadCashEntries.id });
  if (!updated) throw new ThreadCashError("This Thread Cash token could not be attached to checkout.", 409);
}

export async function consumeThreadCashRedemption(
  transaction: any,
  buyerId: string,
  token: string,
  checkoutRecordId: string,
  orderId: string,
): Promise<void> {
  const [consumed] = await transaction.update(threadCashEntries)
    .set({ usedAt: new Date(), usedOrderId: orderId })
    .where(and(
      eq(threadCashEntries.buyerId, buyerId),
      eq(threadCashEntries.source, "redemption"),
      eq(threadCashEntries.referenceId, token),
      eq(threadCashEntries.checkoutSessionId, checkoutRecordId),
      isNull(threadCashEntries.usedAt),
    ))
    .returning({ id: threadCashEntries.id });
  if (!consumed) {
    throw new ThreadCashError("The Thread Cash discount could not be finalized for this order.", 409, "THREAD_CASH_TOKEN_NOT_RESERVED");
  }
}

/** A refunded/cancelled order leaves the buyer's existing token usable. */
export async function releaseThreadCashRedemption(
  transaction: any,
  buyerId: string,
  token: string,
  checkoutRecordId: string,
): Promise<void> {
  await transaction.update(threadCashEntries)
    .set({ checkoutSessionId: null })
    .where(and(
      eq(threadCashEntries.buyerId, buyerId),
      eq(threadCashEntries.source, "redemption"),
      eq(threadCashEntries.referenceId, token),
      eq(threadCashEntries.checkoutSessionId, checkoutRecordId),
      isNull(threadCashEntries.usedAt),
    ));
}

/** Returns Thread Cash spent on an order (as a positive amount) to the buyer's balance. */
export async function refundThreadCashSpend(
  transaction: any,
  buyerId: string,
  orderId: string,
  amountCents: number,
): Promise<{ created: boolean }> {
  if (amountCents < 1) return { created: false };
  const referenceId = `refund:${orderId}`;
  const [existing] = await transaction
    .select({ id: threadCashEntries.id })
    .from(threadCashEntries)
    .where(and(
      eq(threadCashEntries.source, "refund_credit"),
      eq(threadCashEntries.referenceId, referenceId),
    ))
    .limit(1);
  if (existing) return { created: false };

  await transaction.insert(threadCashEntries).values({
    buyerId,
    amountCents,
    source: "refund_credit",
    referenceId,
    note: `Thread Cash returned from refunded order ${orderId}`,
    usedOrderId: orderId,
  });
  return { created: true };
}

// ─── Send in chat (Apple-Cash-style) ───────────────────────────────────────
// Gated behind the 'threadCashSend' feature flag (see PR notes: needs legal
// sign-off before it is turned on). Funds leave the sender's balance
// immediately (so a sender can never send more than they have, and can never
// see it and spend it elsewhere at the same time) and only become spendable
// by the recipient once claimed.

export async function sendThreadCash(
  senderId: string,
  recipientId: string,
  amountCents: number,
  conversationId?: string | null,
): Promise<{ transferId: string }> {
  if (!Number.isInteger(amountCents) || amountCents < 1) {
    throw new ThreadCashError("Enter a valid Thread Cash amount.");
  }
  if (senderId === recipientId) {
    throw new ThreadCashError("You can't send Thread Cash to yourself.");
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`thread-cash-balance:${senderId}`}))`);
    const balance = await getBalanceCents(tx, senderId);
    if (amountCents > balance) {
      throw new ThreadCashError(`Insufficient Thread Cash. You have $${(balance / 100).toFixed(2)}.`, 400, "INSUFFICIENT_THREAD_CASH");
    }
    const [transfer] = await tx.insert(threadCashTransfers).values({
      senderId,
      recipientId,
      conversationId: conversationId ?? null,
      amountCents,
      status: "pending",
    }).returning({ id: threadCashTransfers.id });

    await tx.insert(threadCashEntries).values({
      buyerId: senderId,
      amountCents: -amountCents,
      source: "send_sent",
      referenceId: transfer.id,
      note: `Sent $${(amountCents / 100).toFixed(2)} Thread Cash`,
    });
    return { transferId: transfer.id };
  });
}

export async function claimThreadCash(transferId: string, claimerId: string): Promise<{ amountCents: number }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`thread-cash-transfer:${transferId}`}))`);
    const [transfer] = await tx.select().from(threadCashTransfers).where(eq(threadCashTransfers.id, transferId)).limit(1);
    if (!transfer) throw new ThreadCashError("This Thread Cash send could not be found.", 404, "THREAD_CASH_TRANSFER_NOT_FOUND");
    if (transfer.recipientId !== claimerId) {
      throw new ThreadCashError("This Thread Cash send is not addressed to you.", 403, "THREAD_CASH_TRANSFER_FORBIDDEN");
    }
    if (transfer.status !== "pending") {
      throw new ThreadCashError("This Thread Cash send has already been claimed or is no longer available.", 409, "THREAD_CASH_TRANSFER_NOT_PENDING");
    }
    await tx.update(threadCashTransfers)
      .set({ status: "claimed", claimedAt: new Date() })
      .where(eq(threadCashTransfers.id, transferId));
    await tx.insert(threadCashEntries).values({
      buyerId: claimerId,
      amountCents: transfer.amountCents,
      source: "send_received",
      referenceId: transferId,
      note: `Received $${(transfer.amountCents / 100).toFixed(2)} Thread Cash`,
    });
    return { amountCents: transfer.amountCents };
  });
}
