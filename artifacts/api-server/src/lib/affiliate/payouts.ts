/**
 * Creator payouts through Stripe Connect transfers.
 *
 * Same three-phase shape and idempotency conventions as lib/money/refunds.ts:
 *  A. (DB) lock the creator's payable commissions, pick the payout amount
 *     (payable rows minus clawback debts), and record ONE open payout row plus
 *     its line items. A partial unique index allows a single open payout per
 *     seller+creator, so two servers can never both start one.
 *  B. (Stripe) create the transfer with the key `affiliate-payout/<id>/<attempt>`.
 *     A definitive rejection (4xx) records a failure and the NEXT attempt uses
 *     a new key; an ambiguous failure (network/5xx) leaves the payout
 *     `processing` and the retry reuses the SAME key, so Stripe returns the
 *     original transfer instead of paying twice.
 *  C. (DB) mark the payout paid and settle the commissions exactly once,
 *     guarded by `state = 'processing'`.
 *
 * Nothing here runs unless AFFILIATE_PAYOUTS_ENABLED=true and a Stripe key is
 * configured; without either, commissions keep tracking and the API reports
 * payouts as unavailable.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type Stripe from "stripe";
import {
  db, affiliateCommissions, affiliatePayoutItems, affiliatePayouts, affiliatePrograms, users,
} from "@workspace/db";
import { stripe as defaultStripe } from "../stripe";
import { logger } from "../logger";
import { isDefinitiveStripeRejection, safeErrorMessage, stripeErrorCode } from "../money/stripeMoney";
import { owedCents, planPayout, statusAfterChange, type PayoutPlanRow } from "./commission";
import { promoteEligibleCommissions, reconcileReversals } from "./service";

export type StripeTransfers = Pick<Stripe, "transfers" | "accounts">;

export function payoutsConfigured(env: NodeJS.ProcessEnv = process.env, stripeClient: unknown = defaultStripe): boolean {
  return Boolean(stripeClient) && env.AFFILIATE_PAYOUTS_ENABLED === "true";
}

export function payoutIdempotencyKey(payoutId: string, attempt: number): string {
  return `affiliate-payout/${payoutId}/${attempt}`;
}

const RETRY_BACKOFF_MS = 60 * 60_000;
const AMBIGUOUS_RETRY_AFTER_MS = 60_000;

export type CreatorAccountState = { ready: boolean; accountId: string | null };

/** Live check: the creator's Connect account must be able to receive transfers. */
export async function creatorAccountState(
  creatorId: string,
  stripeClient: StripeTransfers | null,
): Promise<CreatorAccountState> {
  const [user] = await db.select({ accountId: users.stripeAccountId }).from(users)
    .where(eq(users.clerkId, creatorId)).limit(1);
  if (!user?.accountId) return { ready: false, accountId: null };
  if (!stripeClient) return { ready: false, accountId: user.accountId };
  try {
    const account = await stripeClient.accounts.retrieve(user.accountId);
    const transfers = (account.capabilities as Record<string, string> | undefined)?.transfers;
    return { ready: account.payouts_enabled === true && transfers === "active", accountId: user.accountId };
  } catch (err) {
    logger.warn({ err, creatorId }, "Affiliate payout: could not read creator Connect account");
    return { ready: false, accountId: user.accountId };
  }
}

export type PayoutOutcome =
  | { status: "paid"; payoutId: string; amountCents: number; transferId: string }
  | { status: "failed"; payoutId: string; code: string }
  | { status: "unconfirmed"; payoutId: string }
  | { status: "skipped"; reason: "unavailable" | "no_account" | "below_minimum" | "nothing_owed" | "in_progress" | "not_due" };

type Candidate = { id: string; owed: number; status: "pending" | "payable" | "paid" | "reversed" };

async function lockCandidates(tx: Pick<typeof db, "execute">, sellerId: string, creatorId: string): Promise<Candidate[]> {
  const res = await tx.execute(sql`
    SELECT id, status, amount_cents, reversed_cents, paid_cents FROM affiliate_commissions
    WHERE seller_id = ${sellerId} AND creator_id = ${creatorId} AND payout_id IS NULL
      AND (status = 'payable' OR amount_cents - reversed_cents - paid_cents < 0)
    ORDER BY created_at, id FOR UPDATE
  `);
  return ((res as unknown as { rows?: any[] }).rows ?? []).map((r) => ({
    id: r.id,
    status: r.status,
    owed: owedCents({ amountCents: Number(r.amount_cents), reversedCents: Number(r.reversed_cents), paidCents: Number(r.paid_cents) }),
  }));
}

export async function runCreatorPayout(input: {
  sellerId: string;
  creatorId: string;
  stripe?: StripeTransfers | null;
  now?: Date;
  enabled?: boolean;
  accountState?: CreatorAccountState;
}): Promise<PayoutOutcome> {
  const stripeClient = input.stripe === undefined ? defaultStripe : input.stripe;
  const now = input.now ?? new Date();
  const enabled = input.enabled ?? payoutsConfigured(process.env, stripeClient);
  if (!enabled || !stripeClient) return { status: "skipped", reason: "unavailable" };

  const account = input.accountState ?? await creatorAccountState(input.creatorId, stripeClient);

  // ── Phase A ────────────────────────────────────────────────────────────
  const phaseA = await db.transaction(async (tx) => {
    const [open] = (await tx.execute(sql`
      SELECT * FROM affiliate_payouts WHERE seller_id = ${input.sellerId} AND creator_id = ${input.creatorId}
        AND state IN ('processing', 'failed') FOR UPDATE
    `) as unknown as { rows: any[] }).rows;

    if (open) {
      if (open.state === "processing") {
        // Ambiguous earlier attempt: re-drive with the SAME key and amount,
        // but give a concurrent in-flight attempt a minute to finish first.
        if (now.getTime() - new Date(open.updated_at).getTime() < AMBIGUOUS_RETRY_AFTER_MS) {
          return { kind: "skip" as const, reason: "in_progress" as const };
        }
        return { kind: "go" as const, payout: { id: open.id as string, amountCents: Number(open.amount_cents), attempt: Number(open.attempt) } };
      }
      // Failed earlier with a definitive rejection: a new attempt, new key,
      // amount recomputed from the linked rows (a refund may have changed it).
      if (open.next_attempt_at && new Date(open.next_attempt_at).getTime() > now.getTime()) {
        return { kind: "skip" as const, reason: "not_due" as const };
      }
      if (!account.ready || !account.accountId) return { kind: "skip" as const, reason: "no_account" as const };
      const items = (await tx.execute(sql`
        SELECT c.id, c.amount_cents, c.reversed_cents, c.paid_cents FROM affiliate_commissions c
        WHERE c.payout_id = ${open.id}::uuid FOR UPDATE
      `) as unknown as { rows: any[] }).rows;
      const amount = items.reduce((s, r) => s + owedCents({
        amountCents: Number(r.amount_cents), reversedCents: Number(r.reversed_cents), paidCents: Number(r.paid_cents),
      }), 0);
      await tx.delete(affiliatePayoutItems).where(eq(affiliatePayoutItems.payoutId, open.id));
      if (amount <= 0) {
        await tx.update(affiliateCommissions).set({ payoutId: null, updatedAt: now }).where(eq(affiliateCommissions.payoutId, open.id));
        await tx.update(affiliatePayouts).set({ state: "cancelled", failureCode: "nothing_owed", nextAttemptAt: null, updatedAt: now })
          .where(eq(affiliatePayouts.id, open.id));
        return { kind: "skip" as const, reason: "nothing_owed" as const };
      }
      for (const r of items) {
        await tx.insert(affiliatePayoutItems).values({
          payoutId: open.id, commissionId: r.id, sellerId: input.sellerId,
          amountCents: owedCents({ amountCents: Number(r.amount_cents), reversedCents: Number(r.reversed_cents), paidCents: Number(r.paid_cents) }),
        });
      }
      const attempt = Number(open.attempt) + 1;
      await tx.update(affiliatePayouts).set({
        state: "processing", attempt, amountCents: amount, failureCode: null, failureMessage: null, nextAttemptAt: null, updatedAt: now,
      }).where(eq(affiliatePayouts.id, open.id));
      return { kind: "go" as const, payout: { id: open.id as string, amountCents: amount, attempt } };
    }

    const [program] = await tx.select().from(affiliatePrograms).where(eq(affiliatePrograms.sellerId, input.sellerId)).limit(1);
    const candidates = await lockCandidates(tx, input.sellerId, input.creatorId);
    const plan = planPayout({
      rows: candidates.map((c): PayoutPlanRow => ({ commissionId: c.id, owed: c.owed, status: c.status })),
      minPayoutCents: program?.minPayoutCents ?? 2500,
      accountReady: account.ready && Boolean(account.accountId),
      payoutsAvailable: true,
    });
    if (!plan.eligible) return { kind: "skip" as const, reason: plan.reason === "ok" ? ("nothing_owed" as const) : plan.reason };

    const [payout] = await tx.insert(affiliatePayouts).values({
      sellerId: input.sellerId, creatorId: input.creatorId, amountCents: plan.amountCents, state: "processing", attempt: 1,
    }).returning();
    await tx.insert(affiliatePayoutItems).values(plan.rows.map((r) => ({
      payoutId: payout.id, commissionId: r.commissionId, sellerId: input.sellerId, amountCents: r.owed,
    })));
    await tx.update(affiliateCommissions).set({ payoutId: payout.id, updatedAt: now })
      .where(inArray(affiliateCommissions.id, plan.rows.map((r) => r.commissionId)));
    return { kind: "go" as const, payout: { id: payout.id, amountCents: plan.amountCents, attempt: 1 } };
  });

  if (phaseA.kind === "skip") return { status: "skipped", reason: phaseA.reason };
  const { payout } = phaseA;
  const destination = account.accountId;
  if (!destination) return { status: "skipped", reason: "no_account" };

  // ── Phase B ────────────────────────────────────────────────────────────
  let transfer: Stripe.Transfer;
  try {
    transfer = await stripeClient.transfers.create({
      amount: payout.amountCents,
      currency: "usd",
      destination,
      transfer_group: `affiliate-${payout.id}`,
      metadata: { affiliatePayoutId: payout.id, sellerId: input.sellerId, creatorId: input.creatorId },
    }, { idempotencyKey: payoutIdempotencyKey(payout.id, payout.attempt) });
  } catch (error) {
    if (isDefinitiveStripeRejection(error)) {
      const code = stripeErrorCode(error);
      await db.update(affiliatePayouts).set({
        state: "failed", failureCode: code, failureMessage: safeErrorMessage(error),
        nextAttemptAt: new Date(now.getTime() + RETRY_BACKOFF_MS * payout.attempt), updatedAt: now,
      }).where(and(eq(affiliatePayouts.id, payout.id), eq(affiliatePayouts.state, "processing")));
      logger.warn({ payoutId: payout.id, code }, "Affiliate payout rejected by Stripe; will retry with a new key");
      return { status: "failed", payoutId: payout.id, code };
    }
    logger.error({ err: error, payoutId: payout.id }, "Affiliate payout result unknown; will retry with the same key");
    return { status: "unconfirmed", payoutId: payout.id };
  }

  // ── Phase C ────────────────────────────────────────────────────────────
  await db.transaction(async (tx) => {
    const [settled] = await tx.update(affiliatePayouts).set({
      state: "paid", stripeTransferId: transfer.id, paidAt: now, failureCode: null, failureMessage: null, updatedAt: now,
    }).where(and(eq(affiliatePayouts.id, payout.id), eq(affiliatePayouts.state, "processing"))).returning();
    if (!settled) return; // already settled by a concurrent run
    const items = await tx.select().from(affiliatePayoutItems).where(eq(affiliatePayoutItems.payoutId, payout.id));
    for (const item of items) {
      const [c] = (await tx.execute(sql`SELECT * FROM affiliate_commissions WHERE id = ${item.commissionId}::uuid FOR UPDATE`) as unknown as { rows: any[] }).rows;
      if (!c) continue;
      const paidCents = Number(c.paid_cents) + item.amountCents;
      const status = statusAfterChange({
        amountCents: Number(c.amount_cents), reversedCents: Number(c.reversed_cents), paidCents,
        eligibleAt: c.eligible_at ? new Date(c.eligible_at) : null, now,
      });
      await tx.update(affiliateCommissions).set({ paidCents, status, payoutId: null, updatedAt: now })
        .where(eq(affiliateCommissions.id, c.id));
      await tx.execute(sql`
        INSERT INTO affiliate_commission_events (commission_id, seller_id, creator_id, kind, amount_cents, meta)
        VALUES (${c.id}::uuid, ${c.seller_id}, ${c.creator_id}, ${item.amountCents >= 0 ? "paid" : "clawback_settled"},
                ${item.amountCents}, ${JSON.stringify({ payoutId: payout.id, transferId: transfer.id })}::jsonb)
      `);
    }
  });
  return { status: "paid", payoutId: payout.id, amountCents: payout.amountCents, transferId: transfer.id };
}

export type PayoutRunResult = {
  promoted: number; reversed: number; paid: number; failed: number; unconfirmed: number; skipped: number; available: boolean;
};

/** Sweep: reverse stale commissions, promote eligible ones, then pay every creator due. */
export async function runAffiliatePayouts(options: { now?: Date; stripe?: StripeTransfers | null; enabled?: boolean } = {}): Promise<PayoutRunResult> {
  const now = options.now ?? new Date();
  const stripeClient = options.stripe === undefined ? defaultStripe : options.stripe;
  const reversed = await reconcileReversals(now);
  const promoted = await promoteEligibleCommissions(now);
  const enabled = options.enabled ?? payoutsConfigured(process.env, stripeClient);
  const result: PayoutRunResult = { promoted, reversed, paid: 0, failed: 0, unconfirmed: 0, skipped: 0, available: enabled && Boolean(stripeClient) };
  if (!result.available) return result;

  const pairs = ((await db.execute(sql`
    SELECT DISTINCT seller_id, creator_id FROM affiliate_commissions
     WHERE payout_id IS NOT NULL OR status = 'payable' OR amount_cents - reversed_cents - paid_cents < 0
    UNION
    SELECT seller_id, creator_id FROM affiliate_payouts WHERE state IN ('processing', 'failed')
  `)) as unknown as { rows: Array<{ seller_id: string; creator_id: string }> }).rows;

  const accountCache = new Map<string, CreatorAccountState>();
  for (const pair of pairs) {
    try {
      let account = accountCache.get(pair.creator_id);
      if (!account) {
        account = await creatorAccountState(pair.creator_id, stripeClient);
        accountCache.set(pair.creator_id, account);
      }
      const outcome = await runCreatorPayout({
        sellerId: pair.seller_id, creatorId: pair.creator_id, stripe: stripeClient, now, enabled, accountState: account,
      });
      if (outcome.status === "paid") result.paid++;
      else if (outcome.status === "failed") result.failed++;
      else if (outcome.status === "unconfirmed") result.unconfirmed++;
      else result.skipped++;
    } catch (err) {
      logger.error({ err, ...pair }, "Affiliate payout run failed for a creator");
      result.failed++;
    }
  }
  return result;
}
