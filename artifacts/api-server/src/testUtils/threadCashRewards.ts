/**
 * Test helpers for Thread Cash rewards. Rewards are OFF by default
 * (lib/threadCash/rewardsConfig.ts) and draw on a GMV-based monthly budget,
 * so a test that awards credit opens the gate and seeds some GMV first.
 */
import crypto from "node:crypto";
import { db, orders } from "@workspace/db";

const REWARDS_ON: Record<string, string> = {
  THREAD_CASH_EARN_ENABLED: "true",
  THREAD_CASH_EARN_WITHOUT_CHECKOUT_SPEND: "true",
  THREAD_CASH_REWARDS_BUDGET_BPS_OF_GMV: "10000",
  THREAD_CASH_REWARDS_MONTHLY_CAP_CENTS: "100000000",
  THREAD_CASH_DEVICE_MAX_ACCOUNTS_PER_DAY: "8",
  THREAD_CASH_STREAK_BONUS_MAX_CENTS: "10000",
};

/** Opens the rewards gate (env); returns a function that restores the previous env. */
export function allowThreadCashRewards(overrides: Record<string, string> = {}): () => void {
  const vars = { ...REWARDS_ON, ...overrides };
  const previous = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  return () => {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

/** One paid order for a throwaway seller so the trailing-30-day GMV (and so the budget) is non-zero. */
export async function seedRewardsGmv(totalCents = 100_000_000): Promise<void> {
  const ownerId = `tc-gmv-seller-${crypto.randomUUID()}`;
  await db.insert(orders).values({
    ownerId,
    orderNumber: `TCGMV-${crypto.randomUUID().slice(0, 8)}`,
    status: "processing",
    totalCents,
    subtotalCents: totalCents,
    paidAt: new Date(),
  });
}

/** A device install id in the shape the app sends. */
export function testDeviceId(): string {
  return crypto.randomUUID();
}
