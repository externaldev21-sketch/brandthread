/**
 * Admin revenue model (BT-447 / BT-469): every line Brandthread earns, and
 * what it costs to earn it, for the admin Revenue page.
 *
 * Gross platform revenue (period = last N days)
 *   retail      orders.platform_fee_cents − refunded fees (paid orders)
 *   b2b         sample/bulk order platform fees (card- or wallet-paid)
 *   freelance   freelancer job platform fees (paid, not refunded)
 *   promotions  boosts + Create ads + paid featured slots (paid, not refunded)
 *   aiCredits   AI credit packs (paid)
 *   subs        subscription MRR (Stripe web + native IAP) × days / 30
 *
 * Deductions (each its own line)
 *   Stripe fees absorbed:
 *     - retail: the ledger's processing-fee variance per order (Stripe's
 *       actual fee − the estimate charged to the seller); 0 when they match.
 *     - platform charges (B2B card, freelance, Stripe-paid promotions, AI
 *       credits, Stripe subscriptions): Stripe's balance transactions aren't
 *       stored for these, so the documented US card estimate is used —
 *       STRIPE_CARD_FEE (2.9% + 30¢ per charge).
 *   App Store / Google Play commission (est.): STORE_COMMISSION_BPS on native
 *       subscription revenue and IAP-bought promotions (Small Business
 *       Program rate; 30% if Brandthread leaves it).
 *   Dispute fees: the fee Stripe reported on the dispute (dispute_events
 *       payload.feeCents), else STRIPE_DISPUTE_FEE_CENTS, per dispute opened.
 *   Thread Cash redeemed at checkout: orders.thread_cash_applied_cents.
 *   Thread Cash rewards issued: daily check-in, streak bonus and referral
 *       credit posted to thread_cash_entries.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { PLAN_CATALOGUE, isSellerPlanId, type SellerPlanId } from "../planCatalogue";

/** Stripe's standard US card pricing (estimate only; see header). */
export const STRIPE_CARD_FEE = { bps: 290, fixedCents: 30 } as const;
/** Stripe's US dispute fee when the dispute payload carries none. */
export const STRIPE_DISPUTE_FEE_CENTS = 1500;
/** App Store / Google Play commission on in-app purchases (Small Business Program). */
export const STORE_COMMISSION_BPS = 1500;
/** Thread Cash sources that are platform-paid rewards. */
export const THREAD_CASH_REWARD_SOURCES = ["daily_checkin", "streak_bonus", "referral"] as const;

export function estimateCardFeeCents(amountCents: number, charges: number): number {
  if (amountCents <= 0 || charges <= 0) return 0;
  return Math.round((amountCents * STRIPE_CARD_FEE.bps) / 10_000) + charges * STRIPE_CARD_FEE.fixedCents;
}

type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => ((r as { rows?: Row[] }).rows ?? []);
const n = (v: unknown) => Number(v ?? 0) || 0;

// ─── Subscriptions / MRR ─────────────────────────────────────────────────────

export interface MrrReport {
  days: number;
  mrrCents: number;
  activeSubscribers: number;
  trialing: number;
  trialConversions: number;
  churned: number;
  byTier: { planId: SellerPlanId; name: string; priceCents: number; active: number; trialing: number; mrrCents: number }[];
  byProvider: { stripe: { active: number; trialing: number; mrrCents: number }; native: { active: number; trialing: number; mrrCents: number } };
  /** RevenueCat webhook deliveries in the period, by event type. */
  nativeEvents: Record<string, number>;
}

export async function computeMrr(days: number, now = new Date()): Promise<MrrReport> {
  const since = new Date(now.getTime() - days * 86_400_000);
  // One row per subscriber: a Stripe subscription wins over a native
  // entitlement for the same person so nobody is counted twice.
  const subscribers = rowsOf(await db.execute(sql`
    WITH stripe_subs AS (
      SELECT clerk_id AS user_id, 'stripe'::text AS provider, COALESCE(subscription_plan_id, 'starter') AS plan_id,
             CASE WHEN subscription_status IN ('active', 'past_due') THEN 'active'
                  WHEN subscription_status = 'trialing' THEN 'trialing' ELSE 'other' END AS state
      FROM users
      WHERE subscription_id IS NOT NULL AND deleted_at IS NULL AND subscription_status IN ('active', 'past_due', 'trialing')
    ), native_subs AS (
      SELECT e.clerk_user_id AS user_id, 'native'::text AS provider, e.plan_id,
             CASE WHEN e.status IN ('active', 'grace') THEN 'active' ELSE 'trialing' END AS state
      FROM seller_subscription_entitlements e
      WHERE e.is_sandbox = false AND e.status IN ('active', 'grace', 'trial')
        AND (e.expires_at IS NULL OR e.expires_at > ${now})
        AND NOT EXISTS (SELECT 1 FROM stripe_subs s WHERE s.user_id = e.clerk_user_id)
    )
    SELECT provider, plan_id, state, count(*)::int AS n FROM (
      SELECT * FROM stripe_subs UNION ALL SELECT * FROM native_subs
    ) all_subs GROUP BY provider, plan_id, state`));

  const tiers = new Map<SellerPlanId, MrrReport["byTier"][number]>();
  for (const id of Object.keys(PLAN_CATALOGUE) as SellerPlanId[]) {
    tiers.set(id, { planId: id, name: PLAN_CATALOGUE[id].name, priceCents: PLAN_CATALOGUE[id].amountCents, active: 0, trialing: 0, mrrCents: 0 });
  }
  const byProvider = { stripe: { active: 0, trialing: 0, mrrCents: 0 }, native: { active: 0, trialing: 0, mrrCents: 0 } };
  for (const r of subscribers) {
    const planId = isSellerPlanId(r.plan_id) ? r.plan_id : "starter";
    const tier = tiers.get(planId)!;
    const provider = r.provider === "native" ? byProvider.native : byProvider.stripe;
    const count = n(r.n);
    if (r.state === "active") {
      tier.active += count; tier.mrrCents += count * tier.priceCents;
      provider.active += count; provider.mrrCents += count * tier.priceCents;
    } else if (r.state === "trialing") {
      tier.trialing += count; provider.trialing += count;
    }
  }

  const [movement] = rowsOf(await db.execute(sql`
    SELECT
      (SELECT count(*) FROM users WHERE subscription_trial_ends_at >= ${since} AND subscription_trial_ends_at <= ${now}
         AND subscription_status IN ('active', 'past_due'))::int
      + (SELECT count(*) FROM seller_subscription_entitlements WHERE is_sandbox = false AND trial_ends_at >= ${since}
         AND trial_ends_at <= ${now} AND status IN ('active', 'grace'))::int AS conversions,
      (SELECT count(*) FROM users WHERE subscription_id IS NOT NULL AND subscription_status IN ('canceled', 'unpaid', 'incomplete_expired')
         AND COALESCE(subscription_period_end, updated_at) >= ${since})::int
      + (SELECT count(*) FROM seller_subscription_entitlements WHERE is_sandbox = false AND status = 'expired'
         AND expires_at >= ${since} AND expires_at <= ${now})::int AS churned`));

  const events = rowsOf(await db.execute(sql`
    SELECT COALESCE(event_type, 'UNKNOWN') AS t, count(*)::int AS n FROM revenuecat_webhook_events
    WHERE COALESCE(occurred_at, received_at) >= ${since} GROUP BY 1`));

  const byTier = [...tiers.values()];
  return {
    days,
    mrrCents: byTier.reduce((s, t) => s + t.mrrCents, 0),
    activeSubscribers: byTier.reduce((s, t) => s + t.active, 0),
    trialing: byTier.reduce((s, t) => s + t.trialing, 0),
    trialConversions: n(movement?.conversions),
    churned: n(movement?.churned),
    byTier,
    byProvider,
    nativeEvents: Object.fromEntries(events.map((e) => [String(e.t), n(e.n)])),
  };
}

// ─── Revenue lines + net take ────────────────────────────────────────────────

export interface RevenueLine { id: string; label: string; cents: number; count?: number; estimate?: boolean }

export interface RevenueBreakdown {
  lines: RevenueLine[];
  grossPlatformRevenueCents: number;
  deductions: RevenueLine[];
  netTakeCents: number;
  mrr: MrrReport;
}

export async function computeRevenueBreakdown(days: number, now = new Date()): Promise<RevenueBreakdown> {
  const since = new Date(now.getTime() - days * 86_400_000);
  const [r] = rowsOf(await db.execute(sql`
    SELECT
      (SELECT COALESCE(sum(platform_fee_cents - platform_fee_refunded_cents), 0) FROM orders WHERE paid_at >= ${since}) AS retail_fees,
      (SELECT count(*) FROM orders WHERE paid_at >= ${since}) AS retail_n,
      (SELECT COALESCE(sum(processing_fee_cents - processing_fee_charged_cents), 0) FROM orders
         WHERE paid_at >= ${since} AND processing_fee_charged_cents > 0) AS retail_fee_variance,
      (SELECT COALESCE(sum(thread_cash_applied_cents), 0) FROM orders WHERE paid_at >= ${since}) AS tc_redeemed,

      (SELECT COALESCE(sum(platform_fee_cents) FILTER (WHERE order_type = 'sample'), 0) FROM sample_orders s
         WHERE created_at >= ${since} AND payment_review_state <> 'reversed'
           AND (stripe_charge_id IS NOT NULL OR wallet_payment_state = 'paid')) AS sample_fees,
      (SELECT COALESCE(sum(platform_fee_cents) FILTER (WHERE order_type <> 'sample'), 0) FROM sample_orders s
         WHERE created_at >= ${since} AND payment_review_state <> 'reversed'
           AND (stripe_charge_id IS NOT NULL OR wallet_payment_state = 'paid')) AS bulk_fees,
      (SELECT count(*) FROM sample_orders WHERE created_at >= ${since} AND payment_review_state <> 'reversed'
           AND (stripe_charge_id IS NOT NULL OR wallet_payment_state = 'paid')) AS b2b_n,
      (SELECT COALESCE(sum(price_cents), 0) FROM sample_orders WHERE created_at >= ${since}
           AND payment_review_state <> 'reversed' AND stripe_charge_id IS NOT NULL) AS b2b_card_cents,
      (SELECT count(*) FROM sample_orders WHERE created_at >= ${since}
           AND payment_review_state <> 'reversed' AND stripe_charge_id IS NOT NULL) AS b2b_card_n,

      (SELECT COALESCE(sum(platform_fee_cents), 0) FROM freelancer_jobs WHERE created_at >= ${since} AND payment_status = 'paid') AS freelance_fees,
      (SELECT count(*) FROM freelancer_jobs WHERE created_at >= ${since} AND payment_status = 'paid') AS freelance_n,
      (SELECT COALESCE(sum(agreed_price_cents), 0) FROM freelancer_jobs WHERE created_at >= ${since} AND payment_status = 'paid') AS freelance_charged,

      (SELECT COALESCE(sum(budget_cents), 0) FROM boosts WHERE paid_at >= ${since} AND refund_status <> 'refunded') AS boost_cents,
      (SELECT count(*) FROM boosts WHERE paid_at >= ${since} AND refund_status <> 'refunded') AS boost_n,
      (SELECT COALESCE(sum(budget_cents), 0) FROM ad_campaigns WHERE paid_at >= ${since}) AS ads_cents,
      (SELECT count(*) FROM ad_campaigns WHERE paid_at >= ${since}) AS ads_n,
      (SELECT COALESCE(sum(price_cents), 0) FROM featured_slots WHERE paid_at >= ${since} AND refund_status <> 'refunded') AS featured_cents,
      (SELECT count(*) FROM featured_slots WHERE paid_at >= ${since} AND refund_status <> 'refunded') AS featured_n,
      (SELECT COALESCE(sum(amount_cents), 0) FROM iap_promotion_purchases WHERE created_at >= ${since}) AS iap_promo_cents,
      (SELECT count(*) FROM iap_promotion_purchases WHERE created_at >= ${since}) AS iap_promo_n,

      (SELECT COALESCE(sum(amount_cents), 0) FROM ai_credit_purchases WHERE status = 'paid' AND paid_at >= ${since}) AS ai_cents,
      (SELECT count(*) FROM ai_credit_purchases WHERE status = 'paid' AND paid_at >= ${since}) AS ai_n,

      (SELECT COALESCE(sum(COALESCE(fee.fee, ${STRIPE_DISPUTE_FEE_CENTS})), 0) FROM disputes d
         LEFT JOIN LATERAL (SELECT max((e.payload->>'feeCents')::int) AS fee FROM dispute_events e WHERE e.dispute_id = d.id) fee ON true
         WHERE d.created_at >= ${since}) AS dispute_fees,
      (SELECT count(*) FROM disputes WHERE created_at >= ${since}) AS dispute_n,

      (SELECT COALESCE(sum(amount_cents), 0) FROM thread_cash_entries WHERE created_at >= ${since} AND amount_cents > 0
         AND source IN ('daily_checkin', 'streak_bonus', 'referral')) AS tc_rewards`));

  const mrr = await computeMrr(days, now);
  const periodFactor = days / 30;
  const subsStripe = Math.round(mrr.byProvider.stripe.mrrCents * periodFactor);
  const subsNative = Math.round(mrr.byProvider.native.mrrCents * periodFactor);

  // Promotions bought in-app are already in boosts/ad_campaigns (activation
  // sets paid_at); only the Stripe-paid share pays a Stripe fee.
  const promoCents = n(r?.boost_cents) + n(r?.ads_cents) + n(r?.featured_cents);
  const promoCount = n(r?.boost_n) + n(r?.ads_n) + n(r?.featured_n);
  const stripePromoCents = Math.max(0, promoCents - n(r?.iap_promo_cents));
  const stripePromoCount = Math.max(0, promoCount - n(r?.iap_promo_n));

  const lines: RevenueLine[] = [
    { id: "retail_fees", label: "Retail platform fees", cents: n(r?.retail_fees), count: n(r?.retail_n) },
    { id: "sample_fees", label: "Sample order fees", cents: n(r?.sample_fees) },
    { id: "bulk_fees", label: "Bulk order fees", cents: n(r?.bulk_fees) },
    { id: "freelance_fees", label: "Freelancer fees", cents: n(r?.freelance_fees), count: n(r?.freelance_n) },
    { id: "promotions", label: "Boosts, ads & featured", cents: promoCents, count: promoCount },
    { id: "ai_credits", label: "AI credit packs", cents: n(r?.ai_cents), count: n(r?.ai_n) },
    { id: "subscriptions", label: "Subscriptions", cents: subsStripe + subsNative, count: mrr.activeSubscribers, estimate: days !== 30 },
  ];
  const gross = lines.reduce((s, l) => s + l.cents, 0);

  const platformCharges = [
    { cents: n(r?.b2b_card_cents), count: n(r?.b2b_card_n) },
    { cents: n(r?.freelance_charged), count: n(r?.freelance_n) },
    { cents: stripePromoCents, count: stripePromoCount },
    { cents: n(r?.ai_cents), count: n(r?.ai_n) },
    { cents: subsStripe, count: Math.round(mrr.byProvider.stripe.active * periodFactor) },
  ];
  const deductions: RevenueLine[] = [
    { id: "stripe_fees_retail", label: "Stripe fees absorbed (retail)", cents: n(r?.retail_fee_variance) },
    { id: "stripe_fees_platform", label: "Stripe fees (other charges)", cents: platformCharges.reduce((s, c) => s + estimateCardFeeCents(c.cents, c.count), 0), estimate: true },
    { id: "store_fees", label: "App Store & Google Play fees", cents: Math.round(((subsNative + n(r?.iap_promo_cents)) * STORE_COMMISSION_BPS) / 10_000), estimate: true },
    { id: "dispute_fees", label: "Dispute fees", cents: n(r?.dispute_fees), count: n(r?.dispute_n) },
    { id: "thread_cash_redeemed", label: "Thread Cash redeemed at checkout", cents: n(r?.tc_redeemed) },
    { id: "thread_cash_rewards", label: "Thread Cash rewards issued", cents: n(r?.tc_rewards) },
  ];
  const totalDeductions = deductions.reduce((s, d) => s + d.cents, 0);
  return { lines, grossPlatformRevenueCents: gross, deductions, netTakeCents: gross - totalDeductions, mrr };
}
