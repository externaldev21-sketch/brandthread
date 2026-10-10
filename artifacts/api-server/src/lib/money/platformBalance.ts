/**
 * BT-062: Brandthread's own Stripe balance must always cover the seller money
 * it holds.
 *
 * With PAYOUT_MODE=hold (the default) every in-stock order is charged on the
 * platform balance and transferred to the seller after delivery + a buffer
 * (lib/delivery/payoutGate.ts); preorder money sits there for up to 60 days.
 * If the platform account is on Stripe's default automatic payout schedule,
 * Stripe sweeps that seller money to Brandthread's bank every few days, and
 * the later seller transfers (and Thread Cash / gift-card top-ups, which have
 * no source_transaction) fail with balance_insufficient.
 *
 * Two checks, both read-only, run at boot and hourly (jobs/platformBalance.ts)
 * and are exposed to admins at GET /api/admin/platform-balance:
 *   1. the platform account's payout schedule must be "manual" in hold mode;
 *   2. platform available + pending USD balance must be >= total seller_held.
 * Neither check ever moves money or changes Stripe settings.
 */
import type Stripe from "stripe";
import { db } from "@workspace/db";
import { logger } from "../logger";
import { payoutMode, type PayoutMode } from "../delivery/policy";
import { accountBalanceCents, type DbExecutor } from "./ledger";

export type PayoutScheduleCheck = {
  ok: boolean;
  payoutMode: PayoutMode;
  /** Stripe's settings.payouts.schedule.interval, or null when unreadable. */
  interval: string | null;
  problem: "automatic_payouts_in_hold_mode" | "schedule_unreadable" | null;
};

/** Pure: is this platform payout schedule safe for the configured payout mode? */
export function payoutScheduleVerdict(interval: string | null | undefined, mode: PayoutMode): PayoutScheduleCheck {
  const normalized = typeof interval === "string" && interval.trim() ? interval.trim().toLowerCase() : null;
  if (mode !== "hold") return { ok: true, payoutMode: mode, interval: normalized, problem: null };
  if (!normalized) return { ok: false, payoutMode: mode, interval: null, problem: "schedule_unreadable" };
  if (normalized !== "manual") return { ok: false, payoutMode: mode, interval: normalized, problem: "automatic_payouts_in_hold_mode" };
  return { ok: true, payoutMode: mode, interval: normalized, problem: null };
}

export type BalanceCoverage = {
  ok: boolean;
  availableCents: number;
  pendingCents: number;
  sellerHeldCents: number;
  /** sellerHeld − (available + pending); > 0 means seller money is missing. */
  shortfallCents: number;
};

type BalanceAmount = { amount: number; currency: string };

/** Sums one currency's entries (Stripe returns one per currency and source). */
export function sumCurrency(entries: BalanceAmount[] | null | undefined, currency = "usd"): number {
  return (entries ?? []).filter((e) => e.currency?.toLowerCase() === currency).reduce((s, e) => s + (Number(e.amount) || 0), 0);
}

/** Pure: does the platform balance cover what Brandthread holds for sellers? */
export function balanceCoverage(input: { availableCents: number; pendingCents: number; sellerHeldCents: number }): BalanceCoverage {
  const held = Math.max(0, input.sellerHeldCents);
  const onHand = input.availableCents + input.pendingCents;
  const shortfall = held - onHand;
  return {
    ok: shortfall <= 0,
    availableCents: input.availableCents,
    pendingCents: input.pendingCents,
    sellerHeldCents: held,
    shortfallCents: Math.max(0, shortfall),
  };
}

type StripeReads = {
  accounts: { retrieve: (...args: any[]) => Promise<Pick<Stripe.Account, "settings">> };
  balance: { retrieve: (...args: any[]) => Promise<Pick<Stripe.Balance, "available" | "pending">> };
};

export type PlatformBalanceReport = {
  checkedAt: string;
  stripeConfigured: boolean;
  schedule: PayoutScheduleCheck | null;
  coverage: BalanceCoverage | null;
  errors: string[];
};

let lastReport: PlatformBalanceReport | null = null;

export function lastPlatformBalanceReport(): PlatformBalanceReport | null {
  return lastReport;
}

/**
 * Reads the platform account's payout schedule and balance, compares them
 * with the ledger, logs an error (forwarded to Sentry) for every problem, and
 * remembers the report for the admin endpoint.
 */
export async function checkPlatformBalance(options: {
  stripe: StripeReads | null;
  executor?: DbExecutor;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}): Promise<PlatformBalanceReport> {
  const env = options.env ?? process.env;
  const mode = payoutMode(env);
  const report: PlatformBalanceReport = {
    checkedAt: (options.now ?? new Date()).toISOString(),
    stripeConfigured: Boolean(options.stripe),
    schedule: null,
    coverage: null,
    errors: [],
  };
  if (!options.stripe) {
    lastReport = report;
    return report;
  }

  try {
    // No id: the platform's own account.
    const account = await options.stripe.accounts.retrieve();
    report.schedule = payoutScheduleVerdict(account.settings?.payouts?.schedule?.interval ?? null, mode);
  } catch (err) {
    report.schedule = payoutScheduleVerdict(null, mode);
    report.errors.push("Could not read the platform payout schedule from Stripe");
    logger.warn({ err }, "Platform payout schedule check could not reach Stripe");
  }
  if (report.schedule && !report.schedule.ok) {
    logger.error(
      { check: "platform_payout_schedule", ...report.schedule },
      report.schedule.problem === "automatic_payouts_in_hold_mode"
        ? "Platform Stripe account is on automatic payouts while PAYOUT_MODE=hold: held seller money can be swept to the bank. Set payouts to manual in the Stripe Dashboard."
        : "Platform payout schedule could not be confirmed as manual while PAYOUT_MODE=hold",
    );
  }

  try {
    const [balance, sellerHeldCents] = await Promise.all([
      options.stripe.balance.retrieve(),
      accountBalanceCents(options.executor ?? db, { account: "seller_held" }),
    ]);
    report.coverage = balanceCoverage({
      availableCents: sumCurrency(balance.available),
      pendingCents: sumCurrency(balance.pending),
      sellerHeldCents,
    });
    if (!report.coverage.ok) {
      logger.error(
        { check: "platform_balance_coverage", ...report.coverage },
        "Platform Stripe balance is below the seller money Brandthread holds (seller_held). Seller transfers may fail.",
      );
    }
  } catch (err) {
    report.errors.push("Could not compare the platform balance with seller_held");
    logger.warn({ err }, "Platform balance reconciliation could not run");
  }

  lastReport = report;
  return report;
}
