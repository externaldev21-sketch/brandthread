/**
 * Seller-to-seller referral program (BT-313), driven by env vars so Dev can
 * switch it on and tune it without a release:
 *
 *   SELLER_REFERRAL_ENABLED=true            off unless exactly "true"
 *   SELLER_REFERRAL_FREE_MONTHS=1           months credited to EACH brand (1-3)
 *   SELLER_REFERRAL_MAX_REWARDS_PER_SELLER=12   referring brand's lifetime cap
 *   SELLER_REFERRAL_MAX_CREDIT_CENTS=50000  ceiling on one credit (yearly plans are /12 first)
 *   SELLER_REFERRAL_APPLY_WINDOW_DAYS=30    how long a new brand may still enter a code
 *
 * Reward: when the new brand's first PAID month goes through (not the free
 * trial), both brands get their plan's monthly price as Stripe customer
 * credit, which Stripe takes off the next invoice automatically. Brands billed
 * through the App Store / Google Play can't be credited by the server; those
 * rewards are recorded as "app_store_manual" for Dev to send an offer code.
 */
export type SellerReferralConfig = {
  enabled: boolean;
  freeMonths: number;
  maxRewardsPerSeller: number;
  maxCreditCents: number;
  applyWindowDays: number;
};

function int(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export function sellerReferralConfig(env: NodeJS.ProcessEnv = process.env): SellerReferralConfig {
  return {
    enabled: (env.SELLER_REFERRAL_ENABLED ?? "").trim().toLowerCase() === "true",
    freeMonths: int(env.SELLER_REFERRAL_FREE_MONTHS, 1, 1, 3),
    maxRewardsPerSeller: int(env.SELLER_REFERRAL_MAX_REWARDS_PER_SELLER, 12, 0, 1000),
    maxCreditCents: int(env.SELLER_REFERRAL_MAX_CREDIT_CENTS, 50_000, 0, 1_000_000),
    applyWindowDays: int(env.SELLER_REFERRAL_APPLY_WINDOW_DAYS, 30, 1, 365),
  };
}

/** Monthly price of a Stripe recurring price, in its smallest currency unit. */
export function monthlyEquivalentCents(price: { unit_amount: number | null; recurring: { interval: string; interval_count?: number | null } | null } | null | undefined): number {
  if (!price || typeof price.unit_amount !== "number" || price.unit_amount <= 0 || !price.recurring) return 0;
  const count = Math.max(1, price.recurring.interval_count ?? 1);
  switch (price.recurring.interval) {
    case "month": return Math.round(price.unit_amount / count);
    case "year": return Math.round(price.unit_amount / (12 * count));
    case "week": return Math.round((price.unit_amount * 52) / (12 * count));
    case "day": return Math.round((price.unit_amount * 365) / (12 * count));
    default: return 0;
  }
}

/** The credit for one side: N months of the plan, never above the ceiling. */
export function creditCents(monthlyCents: number, cfg: Pick<SellerReferralConfig, "freeMonths" | "maxCreditCents">): number {
  if (!(monthlyCents > 0)) return 0;
  return Math.min(Math.round(monthlyCents * cfg.freeMonths), cfg.maxCreditCents);
}

export const isSellerAccount = (accountType: string | null | undefined) => accountType === "seller" || accountType === "both";
