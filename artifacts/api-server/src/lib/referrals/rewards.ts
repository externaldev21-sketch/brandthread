/**
 * Referral attribution + Thread Cash rewards (DB side). Policy lives in ./policy.
 *
 * Every cash credit carries the idempotency key `referral:<inviteeId>:<role>`
 * (unique partial index on thread_cash_entries), so a retried request, a
 * redelivered Stripe webhook or a concurrent apply can never pay twice.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, orders, referrals, threadCashEntries, users } from "@workspace/db";
import { awardLoyaltyPointsOnce } from "../../routes/loyalty";
import { assertThreadCashNotFrozen, ThreadCashError } from "../threadCash/wallet";
import { logger } from "../logger";
import { personProfileIds } from "../accountProfiles";
import { notifyReferralReward } from "../activityEvents";
import {
  REFERRAL_INVITEE_REWARD_CENTS,
  REFERRAL_JOIN_POINTS,
  decideQualification,
  referralIdempotencyKey,
} from "./policy";

type Executor = Pick<typeof db, "select" | "insert" | "update" | "execute">;

/**
 * Credits Thread Cash once per (invitee, role). Returns the entry id when a new
 * credit was written, or null when it already existed or the wallet is frozen.
 */
export async function creditReferralCash(
  executor: Executor,
  input: { buyerId: string; inviteeId: string; role: "inviter" | "invitee"; amountCents: number },
): Promise<string | null> {
  try {
    await assertThreadCashNotFrozen(executor, input.buyerId);
  } catch (err) {
    if (err instanceof ThreadCashError) return null;
    throw err;
  }
  const [row] = await executor
    .insert(threadCashEntries)
    .values({
      buyerId: input.buyerId,
      amountCents: input.amountCents,
      source: "referral",
      referenceId: input.inviteeId,
      note: input.role === "invitee" ? "Referral welcome credit" : "Referral reward — friend's first order",
      idempotencyKey: referralIdempotencyKey(input.inviteeId, input.role),
    })
    .onConflictDoNothing()
    .returning({ id: threadCashEntries.id });
  return row?.id ?? null;
}

export type ApplyReferralResult =
  | { ok: true; inviterId: string; inviteeRewardCents: number }
  | { ok: false; status: number; error: string; code: string };

export async function applyReferralCode(input: {
  inviteeId: string;
  code: string;
  source?: "code" | "link";
}): Promise<ApplyReferralResult> {
  const { inviteeId, code } = input;

  // One referral credit per PERSON: a login's buyer and seller profiles
  // (and deleted ones) share it.
  const personIds = await personProfileIds(inviteeId, { includeDeleted: true });
  const [existing] = await db
    .select({ inviteeId: referrals.inviteeId })
    .from(referrals)
    .where(inArray(referrals.inviteeId, personIds))
    .limit(1);
  if (existing) return { ok: false, status: 409, error: "Referral already recorded.", code: "ALREADY_APPLIED" };

  const [inviter] = await db
    .select({ clerkId: users.clerkId })
    .from(users)
    .where(eq(users.inviteCode, code))
    .limit(1);
  if (!inviter) return { ok: false, status: 404, error: "Invite code not found.", code: "INVALID_CODE" };
  if (inviter.clerkId === inviteeId || personIds.includes(inviter.clerkId)) {
    return { ok: false, status: 400, error: "You cannot use your own invite code.", code: "SELF_REFERRAL" };
  }

  // Referrals are for new customers: an account that already has orders
  // cannot claim the welcome credit.
  const [priorOrder] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(inArray(orders.buyerId, personIds))
    .limit(1);
  if (priorOrder) {
    return { ok: false, status: 409, error: "Invite codes are for new customers.", code: "NOT_NEW_CUSTOMER" };
  }

  // Attribution, loyalty points and the invitee's cash commit together. The
  // unique invitee row plus the idempotency keys make retries and concurrent
  // applies safe.
  const applied = await db.transaction(async (tx) => {
    const [created] = await tx.insert(referrals).values({
      inviterId: inviter.clerkId,
      inviteeId,
      inviteCode: code,
      source: input.source ?? "code",
    }).onConflictDoNothing().returning({ id: referrals.id });
    if (!created) return null;

    await tx.update(users)
      .set({ referredByCode: code, updatedAt: new Date() })
      .where(eq(users.clerkId, inviteeId));

    // Unchanged from before: the inviter earns 500 loyalty points on join.
    await awardLoyaltyPointsOnce({
      buyerId: inviter.clerkId,
      points: REFERRAL_JOIN_POINTS,
      source: "referral",
      referenceId: inviteeId,
      note: "Referral bonus — friend joined",
    }, tx);

    const entryId = await creditReferralCash(tx, {
      buyerId: inviteeId,
      inviteeId,
      role: "invitee",
      amountCents: REFERRAL_INVITEE_REWARD_CENTS,
    });
    if (entryId) {
      await tx.update(referrals)
        .set({ inviteeRewardCents: REFERRAL_INVITEE_REWARD_CENTS, inviteeRewardEntryId: entryId })
        .where(eq(referrals.id, created.id));
    }
    return { inviteeRewardCents: entryId ? REFERRAL_INVITEE_REWARD_CENTS : 0 };
  });

  if (!applied) return { ok: false, status: 409, error: "Referral already recorded.", code: "ALREADY_APPLIED" };
  return { ok: true, inviterId: inviter.clerkId, ...applied };
}

export type QualifyResult =
  | { rewarded: true; inviterId: string; inviteeId: string; amountCents: number }
  | { rewarded: false; reason: string };

/**
 * Paid-order hook. Call once an order is confirmed paid (safe to call many
 * times, for any order, including guest orders). Pays the inviter the first
 * time the invitee has a qualifying order, per `decideQualification`.
 */
export async function qualifyReferralForOrder(orderId: string): Promise<QualifyResult> {
  const [order] = await db
    .select({
      buyerId: orders.buyerId,
      status: orders.status,
      totalCents: orders.totalCents,
      threadCashAppliedCents: orders.threadCashAppliedCents,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order?.buyerId) return { rewarded: false, reason: "no_buyer" };
  const inviteeId = order.buyerId;

  const result = await db.transaction(async (tx): Promise<QualifyResult> => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`referral-qualify:${inviteeId}`}))`);

    const [referral] = await tx.select().from(referrals).where(eq(referrals.inviteeId, inviteeId)).limit(1);
    if (!referral) return { rewarded: false, reason: "no_referral" };
    if (referral.status !== "pending") return { rewarded: false, reason: "already_qualified" };

    // Serialize payouts for one inviter so the cap can't be raced past.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`referral-inviter:${referral.inviterId}`}))`);

    const [[inviter], [invitee], [{ count }]] = await Promise.all([
      tx.select({ email: users.email }).from(users).where(eq(users.clerkId, referral.inviterId)).limit(1),
      tx.select({ email: users.email }).from(users).where(eq(users.clerkId, inviteeId)).limit(1),
      tx.select({ count: sql<number>`count(*)::int` }).from(referrals)
        .where(and(eq(referrals.inviterId, referral.inviterId), eq(referrals.status, "rewarded"))),
    ]);

    const decision = decideQualification({
      referral,
      order: {
        buyerId: order.buyerId,
        status: order.status,
        paidCents: Math.max(0, order.totalCents - (order.threadCashAppliedCents ?? 0)),
        createdAt: order.createdAt,
      },
      inviterEmail: inviter?.email ?? null,
      inviteeEmail: invitee?.email ?? null,
      inviterRewardedCount: Number(count ?? 0),
    });

    if (decision.action === "skip") return { rewarded: false, reason: decision.reason };

    const now = new Date();
    if (decision.action === "cap") {
      await tx.update(referrals)
        .set({ status: "capped", qualifiedAt: now, qualifyingOrderId: orderId })
        .where(eq(referrals.id, referral.id));
      return { rewarded: false, reason: "capped" };
    }

    const entryId = await creditReferralCash(tx, {
      buyerId: referral.inviterId,
      inviteeId,
      role: "inviter",
      amountCents: decision.amountCents,
    });
    await tx.update(referrals)
      .set(entryId
        ? {
            status: "rewarded", qualifiedAt: now, rewardedAt: now, qualifyingOrderId: orderId,
            inviterRewardCents: decision.amountCents, inviterRewardEntryId: entryId,
          }
        : { status: "qualified", qualifiedAt: now, qualifyingOrderId: orderId })
      .where(eq(referrals.id, referral.id));
    if (!entryId) return { rewarded: false, reason: "credit_unavailable" };
    return { rewarded: true, inviterId: referral.inviterId, inviteeId, amountCents: decision.amountCents };
  });

  if (result.rewarded) {
    // Post-commit, non-throwing.
    await notifyReferralReward(result);
  }
  return result;
}

/** Hook-safe wrapper: never throws into the payment webhook. */
export async function qualifyReferralForOrderSafe(orderId: string): Promise<void> {
  try {
    await qualifyReferralForOrder(orderId);
  } catch (err) {
    logger.error({ err, orderId }, "Referral qualification failed");
  }
}
