/**
 * Which plan unlocks each seller growth tool, and the monthly allowances —
 * the one server-side source for plan gates. Routes enforce it
 * (middlewares/featureGate.ts, the email sender, push broadcasts) and the app
 * reads it from GET /api/config/plan-features so the plan screen's copy and
 * lock icons match what the server allows.
 *
 * Gates only block *starting* something new (a drop, a giveaway, a live, a
 * domain, a Shopify connection). Managing, ending or cancelling what a
 * seller already has always works, so a downgrade never strands buyers.
 *
 * Paid promotions (boosts, ads, featured slots) are open to every plan:
 * they are paid per use.
 */
import type { SellerPlanId } from "./planCatalogue";
import { PLAN_CATALOGUE } from "./planCatalogue";

export type PlanFeature =
  | "live_hosting"
  | "drops"
  | "giveaways"
  | "custom_domain"
  | "shopify_sync"
  | "advanced_analytics";

function envPlan(name: string, fallback: SellerPlanId): SellerPlanId {
  const value = process.env[name];
  return value === "starter" || value === "growth" || value === "pro" ? value : fallback;
}

function envInt(name: string, fallback: number | null): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  if (raw.trim().toLowerCase() === "unlimited") return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : fallback;
}

export function featureMinPlans(): Record<PlanFeature, SellerPlanId> {
  return {
    // Live on Growth so the live feed has hosts at launch (LIVE_HOST_MIN_PLAN=pro reverts to Pro-only).
    live_hosting: envPlan("LIVE_HOST_MIN_PLAN", "growth"),
    drops: "growth",
    giveaways: "growth",
    custom_domain: "growth",
    shopify_sync: "growth",
    advanced_analytics: "pro",
  };
}

export type PlanAllowance = "marketing_emails_per_month" | "push_broadcasts_per_week" | "live_minutes_per_month";

/** null = unlimited. */
export function planAllowances(): Record<PlanAllowance, Record<SellerPlanId, number | null>> {
  return {
    marketing_emails_per_month: {
      starter: envInt("EMAIL_MONTHLY_CAP_STARTER", 500),
      growth: envInt("EMAIL_MONTHLY_CAP_GROWTH", 10_000),
      pro: envInt("EMAIL_MONTHLY_CAP_PRO", 50_000),
    },
    push_broadcasts_per_week: { starter: 1, growth: 3, pro: 7 },
    live_minutes_per_month: {
      starter: 0,
      growth: envInt("LIVE_GROWTH_MINUTES_PER_MONTH", 240),
      pro: null,
    },
  };
}

export function hasPlan(current: SellerPlanId, required: SellerPlanId): boolean {
  return (PLAN_CATALOGUE[current]?.rank ?? 0) >= PLAN_CATALOGUE[required].rank;
}

/** The cheapest plan whose allowance is above `used` (for the upgrade prompt). */
export function planForMore(allowance: PlanAllowance, current: SellerPlanId, used: number): SellerPlanId | null {
  const caps = planAllowances()[allowance];
  for (const plan of ["growth", "pro"] as const) {
    if (hasPlan(plan, current) && plan !== current) {
      const cap = caps[plan];
      if (cap === null || cap > used) return plan;
    }
  }
  return null;
}

export function publicPlanFeatures() {
  return { minPlan: featureMinPlans(), allowances: planAllowances() };
}

const LABEL: Record<PlanFeature, string> = {
  live_hosting: "Live selling",
  drops: "Drops and pre-orders",
  giveaways: "Giveaways",
  custom_domain: "A custom domain",
  shopify_sync: "Shopify sync",
  advanced_analytics: "Advanced analytics",
};

export function featureLabel(feature: PlanFeature): string {
  return LABEL[feature];
}
