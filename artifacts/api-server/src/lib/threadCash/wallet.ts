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
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import {
  blocks, db, follows, pool, threadCashConfig, threadCashEntries, threadCashHeartbeats, threadCashStreaks,
  threadCashTransfers, users,
} from "@workspace/db";
import { DEFAULT_THREAD_CASH_CONFIG, type ThreadCashConfig } from "./streaks";
import {
  FUNDING_SHIFT_SOURCE, entrySplit, getFundingBalances, insertCreditRows, insertDebitEntry, insertRestoreEntry,
  splitPromoFirst, type FundingSplit,
} from "./funding";

/** A transfer sits unclaimed for this long before it expires back to the sender. */
export const THREAD_CASH_TRANSFER_EXPIRY_DAYS = 14;

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

/** Postgres 23505 (unique_violation), however drizzle/pg happens to wrap it. */
function isUniqueViolation(error: any): boolean {
  return error?.code === "23505" || error?.cause?.code === "23505";
}

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
    dailySendCapCents: row.dailySendCapCents,
    dailyReceiveCapCents: row.dailyReceiveCapCents,
    minAccountAgeHoursForSend: row.minAccountAgeHoursForSend,
    maxCheckInsPerDevicePerDay: row.maxCheckInsPerDevicePerDay,
  };
}

export async function getBalanceCents(executor: DbExecutor, buyerId: string): Promise<number> {
  const [row] = await executor
    .select({ total: sql<string>`COALESCE(SUM(${threadCashEntries.amountCents}), 0)` })
    .from(threadCashEntries)
    .where(eq(threadCashEntries.buyerId, buyerId));
  return Number(row?.total ?? 0);
}

/**
 * The part of a balance that may be cashed out to real money: PAID-funded
 * Thread Cash received from other people (Live gifts, message payments), less
 * paid money already cashed out or spent, capped at the balance. Promo credit
 * — platform rewards, including promo a buyer gifted — is spendable in the
 * app but never cashable (lib/threadCash/funding.ts). This narrows the older
 * "earned − cashed out" rule: only real buyer-paid money is withdrawable.
 */
export async function getCashableBalanceCents(executor: DbExecutor, userId: string): Promise<number> {
  return (await getFundingBalances(executor, userId)).cashableCents;
}

/** The one lock every balance-reducing write for a user takes, so no two of
 *  them (send, live gift, redemption, cash-out) can pass a balance check
 *  concurrently. */
export function balanceLockKey(userId: string): string {
  return `thread-cash-balance:${userId}`;
}

/** Whether a moderator-controlled feature flag is enabled (safe default: off). */
export async function isFeatureEnabled(key: string, safeDefault = false): Promise<boolean> {
  const result = await pool.query<{ enabled: boolean }>(
    `SELECT enabled FROM feature_flags WHERE key = $1`,
    [key],
  );
  return result.rows[0]?.enabled ?? safeDefault;
}

/** Anti-farming, per buyer: an admin freeze blocks every mutation. */
export async function assertThreadCashNotFrozen(executor: DbExecutor, buyerId: string): Promise<void> {
  const [row] = await executor
    .select({ frozen: threadCashStreaks.frozen, reason: threadCashStreaks.frozenReason })
    .from(threadCashStreaks)
    .where(eq(threadCashStreaks.buyerId, buyerId))
    .limit(1);
  if (row?.frozen) {
    throw new ThreadCashError(
      row.reason || "Your Thread Cash account has been frozen. Contact support.",
      403,
      "THREAD_CASH_ACCOUNT_FROZEN",
    );
  }
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
    await assertThreadCashNotFrozen(tx, award.buyerId);

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

    // Anti-farming: cap how many distinct accounts can check in from the
    // same device on the same (buyer-local) day — a device farm running many
    // accounts is the obvious way to multiply the daily award.
    if (award.deviceId) {
      const config = await getThreadCashConfig(tx);
      const [row] = await tx
        .select({ count: sql<string>`COUNT(*)` })
        .from(threadCashStreaks)
        .where(and(
          eq(threadCashStreaks.lastDeviceId, award.deviceId),
          eq(threadCashStreaks.lastCheckInDate, award.localDate),
          sql`${threadCashStreaks.buyerId} <> ${award.buyerId}`,
        ));
      if (Number(row?.count ?? 0) >= config.maxCheckInsPerDevicePerDay) {
        throw new ThreadCashError(
          "Too many Thread Cash check-ins from this device today.",
          429,
          "THREAD_CASH_DEVICE_CHECKIN_CAP",
        );
      }
    }

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

// ─── Active-time daily claim (replaces the button-tap check-in trigger) ────
// The buyer no longer taps to claim: the client accumulates foreground
// seconds and pings a heartbeat roughly once a minute, then calls
// /daily/claim once it has 420s. The award itself reuses the exact same
// streak math and one-per-buyer-local-date ledger guard as
// awardDailyCheckInOnce; the only difference is this extra gate requiring
// the server to have actually heard from the client a handful of times that
// day, so a client can't just claim on launch by lying about elapsed time.

export const MIN_HEARTBEATS_FOR_DAILY_CLAIM = 6;
export const MIN_ACTIVE_SECONDS_FOR_DAILY_CLAIM = 420;

/** Records one heartbeat for the buyer's local day; idempotent-additive (each call increments). */
export async function recordThreadCashHeartbeat(
  buyerId: string,
  localDate: string,
  activeSeconds: number,
): Promise<{ heartbeatCount: number }> {
  const clampedSeconds = Math.max(0, Math.min(24 * 3600, Math.floor(activeSeconds) || 0));
  const [row] = await db
    .insert(threadCashHeartbeats)
    .values({ buyerId, localDate, heartbeatCount: 1, activeSeconds: clampedSeconds })
    .onConflictDoUpdate({
      target: [threadCashHeartbeats.buyerId, threadCashHeartbeats.localDate],
      set: {
        heartbeatCount: sql`${threadCashHeartbeats.heartbeatCount} + 1`,
        activeSeconds: sql`GREATEST(${threadCashHeartbeats.activeSeconds}, ${clampedSeconds})`,
        updatedAt: new Date(),
      },
    })
    .returning({ heartbeatCount: threadCashHeartbeats.heartbeatCount });
  return { heartbeatCount: row?.heartbeatCount ?? 1 };
}

async function getHeartbeatState(executor: DbExecutor, buyerId: string, localDate: string): Promise<{ heartbeatCount: number }> {
  const [row] = await executor
    .select({ heartbeatCount: threadCashHeartbeats.heartbeatCount })
    .from(threadCashHeartbeats)
    .where(and(eq(threadCashHeartbeats.buyerId, buyerId), eq(threadCashHeartbeats.localDate, localDate)))
    .limit(1);
  return { heartbeatCount: row?.heartbeatCount ?? 0 };
}

type ActiveTimeClaimAward = CheckInAward & {
  /** Cumulative active seconds the client reports for this local date. */
  activeSeconds: number;
};

/**
 * Awards one day's Thread Cash from active foreground time rather than a
 * button tap. Same one-per-(buyer, local date) ledger guard as
 * awardDailyCheckInOnce (still the ultimate idempotency boundary), plus a
 * minimum-active-time and minimum-heartbeat-count abuse gate before paying.
 */
export async function awardDailyActiveTimeClaimOnce(
  award: ActiveTimeClaimAward,
): Promise<{ created: boolean }> {
  if (award.activeSeconds < MIN_ACTIVE_SECONDS_FOR_DAILY_CLAIM) {
    throw new ThreadCashError(
      "Keep the app open a little longer to earn today's Thread Cash.",
      400,
      "THREAD_CASH_NOT_ENOUGH_ACTIVE_TIME",
    );
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`thread-cash-checkin:${award.buyerId}:${award.localDate}`}))`);
    await assertThreadCashNotFrozen(tx, award.buyerId);

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

    const { heartbeatCount } = await getHeartbeatState(tx, award.buyerId, award.localDate);
    if (heartbeatCount < MIN_HEARTBEATS_FOR_DAILY_CLAIM) {
      throw new ThreadCashError(
        "Keep the app open a little longer to earn today's Thread Cash.",
        400,
        "THREAD_CASH_NOT_ENOUGH_HEARTBEATS",
      );
    }

    if (award.deviceId) {
      const config = await getThreadCashConfig(tx);
      const [row] = await tx
        .select({ count: sql<string>`COUNT(*)` })
        .from(threadCashStreaks)
        .where(and(
          eq(threadCashStreaks.lastDeviceId, award.deviceId),
          eq(threadCashStreaks.lastCheckInDate, award.localDate),
          sql`${threadCashStreaks.buyerId} <> ${award.buyerId}`,
        ));
      if (Number(row?.count ?? 0) >= config.maxCheckInsPerDevicePerDay) {
        throw new ThreadCashError(
          "Too many Thread Cash claims from this device today.",
          429,
          "THREAD_CASH_DEVICE_CHECKIN_CAP",
        );
      }
    }

    await tx.insert(threadCashEntries).values({
      buyerId: award.buyerId,
      amountCents: award.earnedCents,
      source: "daily_checkin",
      referenceId: award.localDate,
      note: `Daily Thread Cash (${award.localDate})`,
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
    // funding_shift rows only record which funds an entry used; never shown.
    .where(and(eq(threadCashEntries.buyerId, buyerId), sql`${threadCashEntries.source} <> ${FUNDING_SHIFT_SOURCE}`))
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
export async function redeemThreadCash(
  buyerId: string,
  amountCents: number,
  idempotencyKey: string,
): Promise<ThreadCashRedemption> {
  if (!Number.isInteger(amountCents) || amountCents < 1) {
    throw new ThreadCashError("Enter a valid Thread Cash amount.");
  }
  if (!idempotencyKey || idempotencyKey.length > 160) {
    throw new ThreadCashError("A valid idempotency key is required.", 400, "THREAD_CASH_IDEMPOTENCY_KEY_REQUIRED");
  }
  const config = await getThreadCashConfig();
  if (config.maxRedemptionPerOrderCents != null && amountCents > config.maxRedemptionPerOrderCents) {
    throw new ThreadCashError(
      `You can apply up to $${(config.maxRedemptionPerOrderCents / 100).toFixed(2)} of Thread Cash per order.`,
      400,
      "THREAD_CASH_REDEMPTION_CAP",
    );
  }
  async function lookupByKey(executor: DbExecutor): Promise<ThreadCashRedemption | null> {
    const [row] = await executor
      .select({ referenceId: threadCashEntries.referenceId, amountCents: threadCashEntries.amountCents })
      .from(threadCashEntries)
      .where(and(eq(threadCashEntries.buyerId, buyerId), eq(threadCashEntries.idempotencyKey, idempotencyKey)))
      .limit(1);
    return row ? { token: row.referenceId!, discountCents: -row.amountCents } : null;
  }

  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`thread-cash-balance:${buyerId}`}))`);
      await assertThreadCashNotFrozen(tx, buyerId);

      // Exactly-once: a retried/double-tapped request with the same key
      // returns the SAME redemption instead of spending twice. Checked
      // AFTER the advisory lock so two concurrent identical requests from
      // the same buyer are fully serialized here, never racing on insert.
      const existing = await lookupByKey(tx);
      if (existing) return existing;

      const balance = await getBalanceCents(tx, buyerId);
      if (amountCents > balance) {
        throw new ThreadCashError(`Insufficient Thread Cash. You have $${(balance / 100).toFixed(2)}.`, 400, "INSUFFICIENT_THREAD_CASH");
      }
      const token = `TCASH-${buyerId.slice(-6).toUpperCase()}-${randomUUID().toUpperCase()}`;
      // Promo credit is spent before paid Thread Cash (lib/threadCash/funding.ts).
      const split = splitPromoFirst(amountCents, await getFundingBalances(tx, buyerId));
      await insertDebitEntry(tx, {
        buyerId,
        source: "redemption",
        referenceId: token,
        idempotencyKey,
        note: `Redeemed $${(amountCents / 100).toFixed(2)} Thread Cash`,
      }, amountCents, split);
      return { token, discountCents: amountCents };
    });
  } catch (error: any) {
    // A unique-constraint conflict means a concurrent identical request
    // (same buyer, different advisory-lock timing, or a cross-buyer key
    // collision) won the race. Once Postgres aborts a transaction on a
    // constraint violation no further statement in THAT transaction can
    // run, so the winner is looked up fresh, outside it, on a new
    // connection — never inside the now-aborted one.
    if (isUniqueViolation(error)) {
      const winner = await lookupByKey(db);
      if (winner) return winner;
    }
    throw error;
  }
}

/** Reserves a previously redeemed token for exactly one checkout attempt. */
export async function reserveThreadCashRedemption(
  buyerId: string,
  token: string,
  checkoutReservationId: string,
  orderTotalBeforeDiscountCents: number,
  /**
   * Thread Cash is a discount on a card purchase, never a full payment
   * method: the resulting card charge must always be left with at least
   * this many cents (Stripe's minimum charge for a card payment).
   */
  minRemainderCents = 1,
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
    if (discountCents > orderTotalBeforeDiscountCents - Math.max(1, minRemainderCents)) {
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

/**
 * Item 108/109: undo a redemption the buyer no longer wants (they turned the
 * checkout toggle off, or the app is re-sizing it to a new order total).
 *
 * `redeemThreadCash` moves the amount out of the balance the moment a token
 * is created, so without this a buyer who toggled Thread Cash on and back
 * off lost that balance for good. It posts a compensating
 * `redemption_cancelled` entry and marks the token used, so the token can
 * never discount a checkout afterwards.
 *
 * Only a token that is NOT attached to a checkout can be cancelled. A token
 * a Stripe session is holding stays with that session: the session either
 * pays (and consumes it) or expires (and the webhook releases it, after
 * which it can be cancelled here). Idempotent: cancelling twice returns the
 * same result and credits once.
 */
export async function cancelThreadCashRedemption(
  buyerId: string,
  token: string,
): Promise<{ returnedCents: number; balanceCents: number }> {
  const normalizedToken = String(token ?? "").trim().toUpperCase();
  if (!normalizedToken || normalizedToken.length > 160) {
    throw new ThreadCashError("Enter a valid Thread Cash token.");
  }
  const cancelKey = `redemption-cancel:${normalizedToken}`;
  return db.transaction(async (tx) => {
    // Same two locks the redeem and reserve paths take, in the same order
    // (balance first), so a cancel can't race a checkout reservation.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`thread-cash-balance:${buyerId}`}))`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`thread-cash-redemption:${normalizedToken}`}))`);

    const [already] = await tx.select({ amountCents: threadCashEntries.amountCents })
      .from(threadCashEntries)
      .where(and(eq(threadCashEntries.buyerId, buyerId), eq(threadCashEntries.idempotencyKey, cancelKey)))
      .limit(1);
    if (already) {
      return { returnedCents: already.amountCents, balanceCents: await getBalanceCents(tx, buyerId) };
    }

    const [redemption] = await tx.select({
      id: threadCashEntries.id,
      amountCents: threadCashEntries.amountCents,
      funding: threadCashEntries.funding,
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
      throw new ThreadCashError("This Thread Cash token is not valid for your account.", 404, "THREAD_CASH_TOKEN_NOT_FOUND");
    }
    if (redemption.usedAt) {
      throw new ThreadCashError("This Thread Cash was already spent on an order.", 409, "THREAD_CASH_TOKEN_USED");
    }
    if (redemption.checkoutSessionId) {
      throw new ThreadCashError(
        "This Thread Cash is attached to a checkout that's still open. Finish or close that payment first.",
        409,
        "THREAD_CASH_TOKEN_RESERVED",
      );
    }

    const returnedCents = -redemption.amountCents;
    await tx.update(threadCashEntries)
      .set({ usedAt: new Date() })
      .where(and(
        eq(threadCashEntries.buyerId, buyerId),
        eq(threadCashEntries.source, "redemption"),
        eq(threadCashEntries.referenceId, normalizedToken),
        isNull(threadCashEntries.usedAt),
        isNull(threadCashEntries.checkoutSessionId),
      ));
    // Back to exactly the funds the redemption used (promo stays promo).
    await insertRestoreEntry(tx, {
      buyerId,
      source: "redemption_cancelled",
      referenceId: normalizedToken,
      idempotencyKey: cancelKey,
      note: `Returned $${(returnedCents / 100).toFixed(2)} Thread Cash from checkout`,
    }, await entrySplit(tx, redemption));
    return { returnedCents, balanceCents: await getBalanceCents(tx, buyerId) };
  });
}

/**
 * Redemptions that hold balance but aren't spent or attached to a checkout —
 * e.g. from a checkout the buyer abandoned. The client returns them to the
 * balance (cancelThreadCashRedemption) unless it's still holding one.
 */
export async function listOpenThreadCashRedemptions(
  executor: DbExecutor,
  buyerId: string,
): Promise<Array<{ token: string; amountCents: number; createdAt: string }>> {
  const rows = await executor.select({
    token: threadCashEntries.referenceId,
    amountCents: threadCashEntries.amountCents,
    createdAt: threadCashEntries.createdAt,
  })
    .from(threadCashEntries)
    .where(and(
      eq(threadCashEntries.buyerId, buyerId),
      eq(threadCashEntries.source, "redemption"),
      isNull(threadCashEntries.usedAt),
      isNull(threadCashEntries.checkoutSessionId),
    ));
  return rows
    .filter((row) => typeof row.token === "string" && row.amountCents < 0)
    .map((row) => ({ token: row.token!, amountCents: -row.amountCents, createdAt: new Date(row.createdAt).toISOString() }));
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

  // Returned as the funds the order's redemption used — paid money first, so
  // a refund never turns a buyer's paid Thread Cash into promo credit. With
  // no paid funds involved (every order today) it is promo, as before.
  const [redemption] = await transaction
    .select({ id: threadCashEntries.id, amountCents: threadCashEntries.amountCents, funding: threadCashEntries.funding })
    .from(threadCashEntries)
    .where(and(
      eq(threadCashEntries.buyerId, buyerId),
      eq(threadCashEntries.source, "redemption"),
      eq(threadCashEntries.usedOrderId, orderId),
    ))
    .limit(1);
  const spent: FundingSplit = redemption ? await entrySplit(transaction, redemption) : { promoCents: amountCents, paidCents: 0 };
  const paidCents = Math.min(amountCents, spent.paidCents);
  await insertRestoreEntry(transaction, {
    buyerId,
    source: "refund_credit",
    referenceId,
    note: `Thread Cash returned from refunded order ${orderId}`,
    usedOrderId: orderId,
  }, { promoCents: amountCents - paidCents, paidCents });
  return { created: true };
}

// ─── Send in chat (Apple-Cash-style) ───────────────────────────────────────
// Friends (mutual follow) can send Thread Cash to each other freely — kept
// low-friction, but layered with the same anti-farming protections as
// everything else: funds leave the sender's balance immediately (so a
// sender can never send more than they have, and can never see it and spend
// it elsewhere at the same time) and only become spendable by the recipient
// once claimed. Mutual-follow and block are re-checked at claim time too,
// since a follow/block can change between send and claim.

async function isMutualFollow(executor: DbExecutor, a: string, b: string): Promise<boolean> {
  const rows = await executor.execute(sql`
    SELECT 1 WHERE EXISTS (SELECT 1 FROM follows WHERE follower_id = ${a} AND following_id = ${b})
      AND EXISTS (SELECT 1 FROM follows WHERE follower_id = ${b} AND following_id = ${a})
  `);
  return ((rows as any).rows ?? []).length > 0;
}

async function isBlocked(executor: DbExecutor, a: string, b: string): Promise<boolean> {
  const rows = await executor.execute(sql`
    SELECT 1 FROM blocks
    WHERE (blocker_id = ${a} AND blocked_id = ${b}) OR (blocker_id = ${b} AND blocked_id = ${a})
    LIMIT 1
  `);
  return ((rows as any).rows ?? []).length > 0;
}

/**
 * Thread Cash a buyer received from a friend can be spent, but never sent
 * onward — otherwise a ring of accounts could launder farmed check-in
 * rewards into one payout by relaying it through several "friends". Spends
 * (redemption, checkout, resending) are assumed to draw down received money
 * first, so any spending "cleans" it; what's left held is what still can't
 * be re-sent.
 */
async function sendableBalanceCents(executor: DbExecutor, buyerId: string): Promise<number> {
  const [row] = await executor
    .select({
      balance: sql<string>`COALESCE(SUM(${threadCashEntries.amountCents}), 0)`,
      received: sql<string>`COALESCE(SUM(${threadCashEntries.amountCents}) FILTER (WHERE ${threadCashEntries.source} = 'send_received'), 0)`,
      spent: sql<string>`COALESCE(SUM(-${threadCashEntries.amountCents}) FILTER (WHERE ${threadCashEntries.amountCents} < 0 AND ${threadCashEntries.source} <> 'funding_shift'), 0)`,
    })
    .from(threadCashEntries)
    .where(eq(threadCashEntries.buyerId, buyerId));
  const balance = Number(row?.balance ?? 0);
  const received = Number(row?.received ?? 0);
  const spent = Number(row?.spent ?? 0);
  const heldReceived = Math.max(0, received - spent);
  return Math.max(0, balance - heldReceived);
}

async function rollingWindowCents(
  executor: DbExecutor,
  buyerId: string,
  source: "send_sent" | "send_received",
): Promise<number> {
  const amountExpr = source === "send_sent" ? sql`-${threadCashEntries.amountCents}` : threadCashEntries.amountCents;
  const [row] = await executor
    .select({ total: sql<string>`COALESCE(SUM(${amountExpr}), 0)` })
    .from(threadCashEntries)
    .where(and(
      eq(threadCashEntries.buyerId, buyerId),
      eq(threadCashEntries.source, source),
      gt(threadCashEntries.createdAt, sql`now() - interval '24 hours'`),
    ));
  return Math.max(0, Number(row?.total ?? 0));
}

async function liveGiftRollingWindowCents(executor: DbExecutor, userId: string, direction: "sent" | "received"): Promise<number> {
  const source = direction === "sent" ? "live_gift_sent" : "live_gift";
  const amountExpr = direction === "sent" ? sql`-${threadCashEntries.amountCents}` : threadCashEntries.amountCents;
  const [row] = await executor
    .select({ total: sql<string>`COALESCE(SUM(${amountExpr}), 0)` })
    .from(threadCashEntries)
    .where(and(
      eq(threadCashEntries.buyerId, userId),
      eq(threadCashEntries.source, source),
      gt(threadCashEntries.createdAt, sql`now() - interval '24 hours'`),
    ));
  return Math.max(0, Number(row?.total ?? 0));
}

export async function sendThreadCash(
  senderId: string,
  recipientId: string,
  amountCents: number,
  options: { conversationId?: string | null; note?: string | null; idempotencyKey: string },
): Promise<{ transferId: string }> {
  if (!Number.isInteger(amountCents) || amountCents < 1) {
    throw new ThreadCashError("Enter a valid Thread Cash amount.");
  }
  if (senderId === recipientId) {
    throw new ThreadCashError("You can't send Thread Cash to yourself.");
  }
  if (!options.idempotencyKey || options.idempotencyKey.length > 160) {
    throw new ThreadCashError("A valid idempotency key is required.", 400, "THREAD_CASH_IDEMPOTENCY_KEY_REQUIRED");
  }
  const note = options.note?.trim().slice(0, 140) || null;

  async function lookupTransferByKey(executor: DbExecutor): Promise<{ transferId: string } | null> {
    const [row] = await executor.select({ id: threadCashTransfers.id })
      .from(threadCashTransfers)
      .where(eq(threadCashTransfers.idempotencyKey, options.idempotencyKey))
      .limit(1);
    return row ? { transferId: row.id } : null;
  }

  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`thread-cash-balance:${senderId}`}))`);
      await assertThreadCashNotFrozen(tx, senderId);

      // Idempotency check, serialized by the advisory lock above so two
      // concurrent identical-key sends from the same sender can never both
      // reach the insert below.
      const existingByKey = await lookupTransferByKey(tx);
      if (existingByKey) return existingByKey;

      if (await isBlocked(tx, senderId, recipientId)) {
        throw new ThreadCashError("You can't send Thread Cash to this person.", 403, "THREAD_CASH_BLOCKED");
      }
      if (!(await isMutualFollow(tx, senderId, recipientId))) {
        throw new ThreadCashError(
          "You can only send Thread Cash to people who follow you back.",
          403,
          "THREAD_CASH_NOT_MUTUAL_FOLLOWERS",
        );
      }

      // Use `tx`, not the default pooled `db` — a second connection here
      // while still holding the sender's advisory lock can deadlock the
      // pool under concurrency (every other waiting sender-lock attempt
      // also holds its own connection while blocked on the same lock).
      const config = await getThreadCashConfig(tx);
      const [sender] = await tx.select({ createdAt: users.createdAt }).from(users).where(eq(users.clerkId, senderId)).limit(1);
      const accountAgeHours = sender ? (Date.now() - sender.createdAt.valueOf()) / 3_600_000 : 0;
      if (accountAgeHours < config.minAccountAgeHoursForSend) {
        throw new ThreadCashError(
          "Your account needs to be a little older before you can send Thread Cash.",
          403,
          "THREAD_CASH_ACCOUNT_TOO_NEW",
        );
      }

      const sendable = await sendableBalanceCents(tx, senderId);
      if (amountCents > sendable) {
        throw new ThreadCashError(
          sendable < await getBalanceCents(tx, senderId)
            ? "Some of your Thread Cash was received from a friend and can't be sent again."
            : `Insufficient Thread Cash. You have $${(sendable / 100).toFixed(2)}.`,
          400,
          "INSUFFICIENT_THREAD_CASH",
        );
      }

      const sentToday = await rollingWindowCents(tx, senderId, "send_sent");
      if (sentToday + amountCents > config.dailySendCapCents) {
        throw new ThreadCashError("You've reached today's Thread Cash sending limit.", 400, "THREAD_CASH_DAILY_SEND_CAP");
      }
      const receivedTodayByRecipient = await rollingWindowCents(tx, recipientId, "send_received");
      if (receivedTodayByRecipient + amountCents > config.dailyReceiveCapCents) {
        throw new ThreadCashError("This person has reached today's Thread Cash receiving limit.", 400, "THREAD_CASH_DAILY_RECEIVE_CAP");
      }

      const [transfer] = await tx.insert(threadCashTransfers).values({
        senderId,
        recipientId,
        conversationId: options.conversationId ?? null,
        amountCents,
        note,
        status: "pending",
        idempotencyKey: options.idempotencyKey,
        expiresAt: new Date(Date.now() + THREAD_CASH_TRANSFER_EXPIRY_DAYS * 86_400_000),
      }).returning({ id: threadCashTransfers.id });

      // Promo first; the recipient later receives the same funding mix.
      await insertDebitEntry(tx, {
        buyerId: senderId,
        source: "send_sent",
        referenceId: transfer.id,
        note: note ? `Sent $${(amountCents / 100).toFixed(2)} Thread Cash: ${note}` : `Sent $${(amountCents / 100).toFixed(2)} Thread Cash`,
      }, amountCents, splitPromoFirst(amountCents, await getFundingBalances(tx, senderId)));
      return { transferId: transfer.id };
    });
  } catch (error: any) {
    // See redeemThreadCash: once a unique-constraint conflict aborts the
    // transaction, the winner is looked up fresh, outside it.
    if (isUniqueViolation(error)) {
      const winner = await lookupTransferByKey(db);
      if (winner) return winner;
    }
    throw error;
  }
}

/**
 * A LIVE gift: buyer → seller Thread Cash, instant and unconditional —
 * unlike sendThreadCash's friend-to-friend transfer this is never gated on
 * mutual follow (a viewer gifting a host they're watching doesn't follow
 * them back) and never sits pending a claim; it posts both the debit and
 * the credit in the same transaction. The seller's credit uses the
 * `'live_gift'` source cashOut.ts already expects (see its module doc) so
 * cashing out and the seller's Thread Cash history both see it correctly
 * with no further plumbing.
 */
export async function sendLiveGift(
  buyerId: string,
  sellerId: string,
  streamId: string,
  amountCents: number,
  idempotencyKey: string,
): Promise<{ giftId: string }> {
  if (!Number.isInteger(amountCents) || amountCents < 1) {
    throw new ThreadCashError("Enter a valid Thread Cash amount.");
  }
  if (buyerId === sellerId) {
    throw new ThreadCashError("You can't gift yourself.");
  }
  if (!idempotencyKey || idempotencyKey.length > 160) {
    throw new ThreadCashError("A valid idempotency key is required.", 400, "THREAD_CASH_IDEMPOTENCY_KEY_REQUIRED");
  }

  async function lookupByKey(executor: DbExecutor): Promise<{ giftId: string } | null> {
    const [row] = await executor.select({ id: threadCashEntries.id, buyerId: threadCashEntries.buyerId })
      .from(threadCashEntries)
      .where(and(eq(threadCashEntries.idempotencyKey, idempotencyKey), eq(threadCashEntries.source, "live_gift_sent")))
      .limit(1);
    if (!row) return null;
    // Keys are unique across ALL entries; a key another user (or another
    // kind of write) already used must never read back as this gift
    // succeeding — that would report "sent" with nothing debited.
    if (row.buyerId !== buyerId) {
      throw new ThreadCashError("This request key was already used. Try again.", 409, "THREAD_CASH_IDEMPOTENCY_KEY_REUSED");
    }
    return { giftId: row.id };
  }

  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`thread-cash-balance:${buyerId}`}))`);
      await assertThreadCashNotFrozen(tx, buyerId);

      const existingByKey = await lookupByKey(tx);
      if (existingByKey) return existingByKey;

      if (await isBlocked(tx, buyerId, sellerId)) {
        throw new ThreadCashError("You can't send Thread Cash to this person.", 403, "THREAD_CASH_BLOCKED");
      }

      const config = await getThreadCashConfig(tx);
      const sendable = await sendableBalanceCents(tx, buyerId);
      if (amountCents > sendable) {
        throw new ThreadCashError(
          sendable < await getBalanceCents(tx, buyerId)
            ? "Some of your Thread Cash was received from a friend and can't be sent again."
            : `Insufficient Thread Cash. You have $${(sendable / 100).toFixed(2)}.`,
          400,
          "INSUFFICIENT_THREAD_CASH",
        );
      }

      // Same daily send/receive ceilings sendThreadCash enforces (one
      // combined "Thread Cash sent today" cap across friend-sends and live
      // gifts, not two independent ones a buyer could stack; and a receive
      // cap on the seller — cashable Thread Cash makes the anti-farming
      // reasoning that already applies to friend transfers matter here too).
      const sentTodayFriends = await rollingWindowCents(tx, buyerId, "send_sent");
      const sentTodayGifts = await liveGiftRollingWindowCents(tx, buyerId, "sent");
      if (sentTodayFriends + sentTodayGifts + amountCents > config.dailySendCapCents) {
        throw new ThreadCashError("You've reached today's Thread Cash sending limit.", 400, "THREAD_CASH_DAILY_SEND_CAP");
      }
      // The receive cap is per SELLER across every sender, so it must be
      // checked under a seller-scoped lock too — the buyer lock alone lets
      // two different buyers gifting at once both pass it. Lock order is
      // always buyer-balance → seller-receive (receive locks are never held
      // while taking a balance lock), so this can't deadlock.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`thread-cash-gift-receive:${sellerId}`}))`);
      const receivedTodayBySeller = await liveGiftRollingWindowCents(tx, sellerId, "received");
      if (receivedTodayBySeller + amountCents > config.dailyReceiveCapCents) {
        throw new ThreadCashError("This seller has reached today's Thread Cash receiving limit.", 400, "THREAD_CASH_DAILY_RECEIVE_CAP");
      }

      // Promo first: a buyer's promo credit is gifted before any paid
      // Thread Cash, and the seller receives exactly that mix — promo stays
      // promo (spendable, never withdrawable); only the paid part is cashable.
      const split = splitPromoFirst(amountCents, await getFundingBalances(tx, buyerId));
      const debit = await insertDebitEntry(tx, {
        buyerId,
        source: "live_gift_sent",
        referenceId: streamId,
        idempotencyKey,
        note: `Sent $${(amountCents / 100).toFixed(2)} Thread Cash in a live`,
      }, amountCents, split);

      await insertCreditRows(tx, {
        buyerId: sellerId,
        source: "live_gift",
        referenceId: streamId,
        note: `Received $${(amountCents / 100).toFixed(2)} Thread Cash gift in a live`,
      }, split);

      return { giftId: debit.id };
    });
  } catch (error: any) {
    if (isUniqueViolation(error)) {
      const winner = await lookupByKey(db);
      if (winner) return winner;
    }
    throw error;
  }
}

export async function claimThreadCash(transferId: string, claimerId: string): Promise<{ amountCents: number }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`thread-cash-transfer:${transferId}`}))`);
    const [transfer] = await tx.select().from(threadCashTransfers).where(eq(threadCashTransfers.id, transferId)).limit(1);
    if (!transfer) throw new ThreadCashError("This Thread Cash send could not be found.", 404, "THREAD_CASH_TRANSFER_NOT_FOUND");
    if (transfer.recipientId !== claimerId) {
      throw new ThreadCashError("This Thread Cash send is not addressed to you.", 403, "THREAD_CASH_TRANSFER_FORBIDDEN");
    }
    await assertThreadCashNotFrozen(tx, claimerId);

    if (transfer.status === "pending" && transfer.expiresAt && transfer.expiresAt.valueOf() <= Date.now()) {
      await expireOneTransfer(tx, transfer);
      throw new ThreadCashError("This Thread Cash send has expired and was returned to the sender.", 409, "THREAD_CASH_TRANSFER_EXPIRED");
    }
    if (transfer.status !== "pending") {
      throw new ThreadCashError("This Thread Cash send has already been claimed or is no longer available.", 409, "THREAD_CASH_TRANSFER_NOT_PENDING");
    }
    // Follow/block state can change between send and claim — re-check both.
    if (await isBlocked(tx, transfer.senderId, claimerId)) {
      throw new ThreadCashError("You can't claim this Thread Cash send.", 403, "THREAD_CASH_BLOCKED");
    }
    if (!(await isMutualFollow(tx, transfer.senderId, claimerId))) {
      throw new ThreadCashError(
        "You need to follow each other to claim this Thread Cash send.",
        403,
        "THREAD_CASH_NOT_MUTUAL_FOLLOWERS",
      );
    }

    const [claimed] = await tx.update(threadCashTransfers)
      .set({ status: "claimed", claimedAt: new Date() })
      .where(and(eq(threadCashTransfers.id, transferId), eq(threadCashTransfers.status, "pending")))
      .returning({ id: threadCashTransfers.id });
    if (!claimed) {
      throw new ThreadCashError("This Thread Cash send has already been claimed or is no longer available.", 409, "THREAD_CASH_TRANSFER_NOT_PENDING");
    }
    await insertCreditRows(tx, {
      buyerId: claimerId,
      source: "send_received",
      referenceId: transferId,
      note: `Received $${(transfer.amountCents / 100).toFixed(2)} Thread Cash`,
    }, await sentSplit(tx, transfer));
    return { amountCents: transfer.amountCents };
  });
}

/** The sender cancels a still-pending send; funds return immediately. */
export async function cancelThreadCash(transferId: string, senderId: string): Promise<void> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`thread-cash-transfer:${transferId}`}))`);
    const [transfer] = await tx.select().from(threadCashTransfers).where(eq(threadCashTransfers.id, transferId)).limit(1);
    if (!transfer) throw new ThreadCashError("This Thread Cash send could not be found.", 404, "THREAD_CASH_TRANSFER_NOT_FOUND");
    if (transfer.senderId !== senderId) {
      throw new ThreadCashError("This Thread Cash send is not yours to cancel.", 403, "THREAD_CASH_TRANSFER_FORBIDDEN");
    }
    const [cancelled] = await tx.update(threadCashTransfers)
      .set({ status: "cancelled", cancelledAt: new Date() })
      .where(and(eq(threadCashTransfers.id, transferId), eq(threadCashTransfers.status, "pending")))
      .returning({ id: threadCashTransfers.id });
    if (!cancelled) {
      throw new ThreadCashError("This Thread Cash send can no longer be cancelled.", 409, "THREAD_CASH_TRANSFER_NOT_PENDING");
    }
    await insertRestoreEntry(tx, {
      buyerId: senderId,
      source: "send_cancelled",
      referenceId: transferId,
      note: `Cancelled Thread Cash send of $${(transfer.amountCents / 100).toFixed(2)}`,
    }, await sentSplit(tx, transfer));
  });
}

async function expireOneTransfer(tx: DbExecutor, transfer: typeof threadCashTransfers.$inferSelect): Promise<boolean> {
  const [expired] = await tx.update(threadCashTransfers)
    .set({ status: "expired" })
    .where(and(eq(threadCashTransfers.id, transfer.id), eq(threadCashTransfers.status, "pending")))
    .returning({ id: threadCashTransfers.id });
  if (!expired) return false;
  await insertRestoreEntry(tx, {
    buyerId: transfer.senderId,
    source: "send_expired",
    referenceId: transfer.id,
    note: `Thread Cash send of $${(transfer.amountCents / 100).toFixed(2)} expired and was returned`,
  }, await sentSplit(tx, transfer));
  return true;
}

/** The funds a send debited from its sender (what the recipient or a refund gets). */
async function sentSplit(tx: DbExecutor, transfer: typeof threadCashTransfers.$inferSelect): Promise<FundingSplit> {
  const [debit] = await tx.select({ id: threadCashEntries.id, amountCents: threadCashEntries.amountCents, funding: threadCashEntries.funding })
    .from(threadCashEntries)
    .where(and(
      eq(threadCashEntries.buyerId, transfer.senderId),
      eq(threadCashEntries.source, "send_sent"),
      eq(threadCashEntries.referenceId, transfer.id),
    ))
    .limit(1);
  return debit ? entrySplit(tx, debit) : { promoCents: transfer.amountCents, paidCents: 0 };
}

/**
 * Proactively expires and refunds pending sends past their expiry, for
 * transfers the recipient never opens (claim-time also does this lazily for
 * the one transfer being claimed). Intended to run on a daily schedule
 * alongside the app's other maintenance jobs.
 */
export async function expirePendingThreadCashTransfers(now = new Date(), limit = 500): Promise<number> {
  const due = await db.select({ id: threadCashTransfers.id }).from(threadCashTransfers)
    .where(and(eq(threadCashTransfers.status, "pending"), sql`${threadCashTransfers.expiresAt} <= ${now}`))
    .limit(limit);
  let count = 0;
  for (const { id } of due) {
    const didExpire = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`thread-cash-transfer:${id}`}))`);
      const [transfer] = await tx.select().from(threadCashTransfers).where(eq(threadCashTransfers.id, id)).limit(1);
      if (!transfer || transfer.status !== "pending") return false;
      return expireOneTransfer(tx, transfer);
    });
    if (didExpire) count++;
  }
  return count;
}
