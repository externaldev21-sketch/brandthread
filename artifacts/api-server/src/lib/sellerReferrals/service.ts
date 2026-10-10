/**
 * Seller-to-seller referrals (BT-313). Policy + config in ./config.
 *
 * Attribution: a brand that signs up through another brand's invite link
 * (/invite/CODE — the same link the buyer program uses, so the existing
 * onboarding hand-off records it in `referrals`) is picked up here, or a new
 * brand enters the code within the apply window (POST /api/seller-referrals/apply).
 *
 * Qualification: the new brand's first PAID month (a paid Stripe invoice, or
 * an active — not trial — store subscription). The free trial never counts.
 *
 * Rewards are idempotent: one row per new brand (unique invitee), each Stripe
 * credit carries the idempotency key seller-referral:<rowId>:<role>, and a row
 * is claimed with a conditional update before any money moves.
 */
import { and, count, eq, inArray, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { db, referrals, sellerReferrals, sellerSubscriptionEntitlements, users, type SellerReferralReward } from "@workspace/db";
import { logger } from "../logger";
import { normalizeInviteCode } from "../referrals/policy";
import { creditCents, isSellerAccount, monthlyEquivalentCents, sellerReferralConfig, type SellerReferralConfig } from "./config";

type BillingUser = {
  clerkId: string;
  stripeCustomerId: string | null;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
};

export type ApplySellerReferralResult =
  | { ok: true; inviterId: string }
  | { ok: false; status: number; code: string; error: string };

const billingColumns = {
  clerkId: users.clerkId,
  stripeCustomerId: users.stripeCustomerId,
  subscriptionId: users.subscriptionId,
  subscriptionStatus: users.subscriptionStatus,
};

async function hasActiveStoreSubscription(clerkId: string): Promise<boolean> {
  const [row] = await db.select({ id: sellerSubscriptionEntitlements.id }).from(sellerSubscriptionEntitlements)
    .where(and(
      eq(sellerSubscriptionEntitlements.clerkUserId, clerkId),
      eq(sellerSubscriptionEntitlements.status, "active"),
      eq(sellerSubscriptionEntitlements.isSandbox, false),
    )).limit(1);
  return !!row;
}

/** A new brand enters another brand's code (only before its first paid month). */
export async function applySellerReferralCode(
  inviteeId: string,
  rawCode: unknown,
  cfg: SellerReferralConfig = sellerReferralConfig(),
  now = new Date(),
): Promise<ApplySellerReferralResult> {
  if (!cfg.enabled) return { ok: false, status: 404, code: "DISABLED", error: "Brand referrals aren't available." };
  const code = normalizeInviteCode(rawCode);
  if (!code) return { ok: false, status: 400, code: "INVALID_CODE", error: "Enter a valid code." };

  const [invitee] = await db.select({ ...billingColumns, accountType: users.accountType, createdAt: users.createdAt })
    .from(users).where(eq(users.clerkId, inviteeId)).limit(1);
  if (!invitee || !isSellerAccount(invitee.accountType)) {
    return { ok: false, status: 403, code: "NOT_A_SELLER", error: "Only brands can use a brand referral code." };
  }
  if (now.getTime() - invitee.createdAt.getTime() > cfg.applyWindowDays * 86_400_000) {
    return { ok: false, status: 409, code: "WINDOW_CLOSED", error: `Codes can be added in your first ${cfg.applyWindowDays} days.` };
  }
  if (invitee.subscriptionStatus === "active" || await hasActiveStoreSubscription(inviteeId)) {
    return { ok: false, status: 409, code: "ALREADY_PAYING", error: "Codes can be added before your first paid month." };
  }
  const [inviter] = await db.select({ clerkId: users.clerkId, accountType: users.accountType, suspendedAt: users.suspendedAt, deletedAt: users.deletedAt })
    .from(users).where(eq(users.inviteCode, code)).limit(1);
  if (!inviter || !isSellerAccount(inviter.accountType) || inviter.suspendedAt || inviter.deletedAt) {
    return { ok: false, status: 404, code: "INVALID_CODE", error: "That code doesn't belong to a brand." };
  }
  if (inviter.clerkId === inviteeId) return { ok: false, status: 400, code: "SELF_REFERRAL", error: "You can't use your own code." };

  const inserted = await db.insert(sellerReferrals)
    .values({ inviterId: inviter.clerkId, inviteeId, inviteCode: code, source: "code" })
    .onConflictDoNothing()
    .returning({ id: sellerReferrals.id });
  if (!inserted.length) return { ok: false, status: 409, code: "ALREADY_APPLIED", error: "A referral code is already on your account." };
  return { ok: true, inviterId: inviter.clerkId };
}

/** Brand → brand sign-ups that came through an invite link (recorded by the buyer program). */
export async function syncSellerReferralsFromInviteLinks(now = new Date(), lookbackDays = 60): Promise<number> {
  const since = new Date(now.getTime() - lookbackDays * 86_400_000);
  const rows = await db.execute(sql`
    INSERT INTO seller_referrals (inviter_id, invitee_id, invite_code, source)
    SELECT r.inviter_id, r.invitee_id, r.invite_code, 'link'
    FROM ${referrals} r
    JOIN ${users} inviter ON inviter.clerk_id = r.inviter_id
    JOIN ${users} invitee ON invitee.clerk_id = r.invitee_id
    WHERE r.joined_at >= ${since}
      AND inviter.account_type IN ('seller', 'both')
      AND invitee.account_type IN ('seller', 'both')
      AND r.inviter_id <> r.invitee_id
    ON CONFLICT (invitee_id) DO NOTHING
    RETURNING id
  `);
  return rows.rows.length;
}

/** True once the new brand has paid for a month (never the free trial). */
export async function hasPaidFirstMonth(user: BillingUser, stripe: Stripe | null): Promise<boolean> {
  if (await hasActiveStoreSubscription(user.clerkId)) return true;
  if (!stripe || !user.subscriptionId || user.subscriptionStatus !== "active") return false;
  const invoices = await stripe.invoices.list({ subscription: user.subscriptionId, status: "paid", limit: 10 });
  return invoices.data.some((inv) => (inv.amount_paid ?? 0) > 0);
}

/** Credit one brand: Stripe balance if Stripe-billed, else a manual store offer. */
export async function rewardSeller(
  user: BillingUser,
  role: "inviter" | "invitee",
  rowId: string,
  cfg: SellerReferralConfig,
  stripe: Stripe | null,
): Promise<SellerReferralReward> {
  if (stripe && user.stripeCustomerId && user.subscriptionId && ["active", "trialing", "past_due"].includes(user.subscriptionStatus ?? "")) {
    const sub = await stripe.subscriptions.retrieve(user.subscriptionId);
    const price = sub.items?.data?.[0]?.price ?? null;
    const amount = creditCents(monthlyEquivalentCents(price as any), cfg);
    if (amount > 0 && price?.currency) {
      const txn = await stripe.customers.createBalanceTransaction(
        user.stripeCustomerId,
        {
          amount: -amount,
          currency: price.currency,
          description: cfg.freeMonths === 1 ? "Brand referral: 1 free month" : `Brand referral: ${cfg.freeMonths} free months`,
          metadata: { seller_referral_id: rowId, role },
        },
        { idempotencyKey: `seller-referral:${rowId}:${role}` },
      );
      return { method: "stripe_balance", amountCents: amount, currency: price.currency, reference: txn.id };
    }
  }
  if (await hasActiveStoreSubscription(user.clerkId)) {
    return { method: "app_store_manual", amountCents: 0, currency: null, reference: null };
  }
  return { method: "none", amountCents: 0, currency: null, reference: null };
}

/** Qualify and reward pending referrals. Safe to run on several servers at once. */
export async function runSellerReferrals(opts: { stripe: Stripe | null; now?: Date; cfg?: SellerReferralConfig; limit?: number }): Promise<{ synced: number; rewarded: number; voided: number }> {
  const cfg = opts.cfg ?? sellerReferralConfig();
  const now = opts.now ?? new Date();
  const result = { synced: 0, rewarded: 0, voided: 0 };
  if (!cfg.enabled) return result;
  result.synced = await syncSellerReferralsFromInviteLinks(now);

  const pending = await db.select().from(sellerReferrals)
    .where(eq(sellerReferrals.status, "pending")).limit(opts.limit ?? 100);
  for (const row of pending) {
    try {
      const people = await db.select({ ...billingColumns, suspendedAt: users.suspendedAt, deletedAt: users.deletedAt, accountType: users.accountType })
        .from(users).where(inArray(users.clerkId, [row.inviterId, row.inviteeId]));
      const inviter = people.find((p) => p.clerkId === row.inviterId);
      const invitee = people.find((p) => p.clerkId === row.inviteeId);
      if (!invitee || invitee.deletedAt || invitee.suspendedAt || !isSellerAccount(invitee.accountType) || !inviter) {
        await db.update(sellerReferrals).set({ status: "void", updatedAt: now })
          .where(and(eq(sellerReferrals.id, row.id), eq(sellerReferrals.status, "pending")));
        result.voided++;
        continue;
      }
      if (!(await hasPaidFirstMonth(invitee, opts.stripe))) continue;

      // Claim the row before any money moves; a second server sees it taken.
      const claimed = await db.update(sellerReferrals).set({ status: "rewarding", qualifiedAt: now, updatedAt: now })
        .where(and(eq(sellerReferrals.id, row.id), eq(sellerReferrals.status, "pending")))
        .returning({ id: sellerReferrals.id });
      if (!claimed.length) continue;

      const [{ value: alreadyRewarded }] = await db.select({ value: count() }).from(sellerReferrals)
        .where(and(eq(sellerReferrals.inviterId, row.inviterId), eq(sellerReferrals.status, "rewarded"),
          sql`coalesce(${sellerReferrals.inviterReward}->>'method', '') <> 'capped'`));
      const inviterEligible = !inviter.deletedAt && !inviter.suspendedAt;
      const inviterReward: SellerReferralReward = !inviterEligible
        ? { method: "none", amountCents: 0, currency: null, reference: null }
        : Number(alreadyRewarded) >= cfg.maxRewardsPerSeller
          ? { method: "capped", amountCents: 0, currency: null, reference: null }
          : await rewardSeller(inviter, "inviter", row.id, cfg, opts.stripe);
      const inviteeReward = await rewardSeller(invitee, "invitee", row.id, cfg, opts.stripe);

      await db.update(sellerReferrals).set({ status: "rewarded", inviterReward, inviteeReward, updatedAt: new Date() })
        .where(eq(sellerReferrals.id, row.id));
      result.rewarded++;
      if (inviterReward.method === "app_store_manual" || inviteeReward.method === "app_store_manual") {
        logger.warn({ sellerReferralId: row.id }, "Seller referral earned by a store-billed brand: send an App Store / Google Play offer code");
      }
    } catch (err) {
      // Put a claimed row back so the next run retries (Stripe calls are idempotent).
      await db.update(sellerReferrals).set({ status: "pending", updatedAt: new Date() })
        .where(and(eq(sellerReferrals.id, row.id), eq(sellerReferrals.status, "rewarding"))).catch(() => {});
      logger.error({ err, sellerReferralId: row.id }, "Seller referral reward failed");
    }
  }
  return result;
}

/** What the referring brand sees. */
export async function sellerReferralSummary(sellerId: string) {
  const rows = await db.select({
    id: sellerReferrals.id,
    status: sellerReferrals.status,
    createdAt: sellerReferrals.createdAt,
    inviterReward: sellerReferrals.inviterReward,
    name: sql<string | null>`coalesce(${users.brandName}, ${users.displayName}, ${users.username})`,
  })
    .from(sellerReferrals)
    .leftJoin(users, eq(users.clerkId, sellerReferrals.inviteeId))
    .where(eq(sellerReferrals.inviterId, sellerId))
    .orderBy(sql`${sellerReferrals.createdAt} desc`)
    .limit(100);
  const [mine] = await db.select({ id: sellerReferrals.id }).from(sellerReferrals)
    .where(eq(sellerReferrals.inviteeId, sellerId)).limit(1);
  return {
    referred: rows
      .filter((r) => r.status !== "void")
      .map((r) => ({
        id: r.id,
        name: r.name ?? "A brand",
        status: r.status === "rewarded" ? (r.inviterReward?.method === "capped" ? "capped" : "rewarded") : "pending",
        createdAt: r.createdAt.toISOString(),
      })),
    hasReferrer: !!mine,
  };
}



/** The brand's share code — the same invite code the buyer program uses, created on first use. */
export async function ensureInviteCode(clerkId: string): Promise<string | null> {
  const { generateInviteCode } = await import("../referrals/policy");
  for (let i = 0; i < 10; i++) {
    const [user] = await db.select({ inviteCode: users.inviteCode }).from(users).where(eq(users.clerkId, clerkId)).limit(1);
    if (!user) return null;
    if (user.inviteCode) return user.inviteCode;
    try {
      await db.update(users).set({ inviteCode: generateInviteCode(), updatedAt: new Date() })
        .where(and(eq(users.clerkId, clerkId), sql`${users.inviteCode} IS NULL`));
    } catch (err: any) {
      if (err?.code !== "23505" && err?.cause?.code !== "23505") throw err; // collision: retry
    }
  }
  return null;
}
