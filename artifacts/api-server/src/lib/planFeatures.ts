/**
 * Which plan unlocks each seller tool, and the monthly allowances. The values
 * come from the one plan config (planCatalogue.ts → PLAN_CATALOGUE[plan].features);
 * this file only turns them into gates. Routes enforce them
 * (middlewares/featureGate.ts, the email sender, push broadcasts) and the app
 * reads them from GET /api/config/plan-features so the plan screen's copy and
 * lock icons match what the server allows.
 *
 * Gates only block *starting* something new (a drop, a live, a boost, a
 * domain, an RFQ). Managing, ending or cancelling what a seller already has
 * always works, so a downgrade never strands buyers.
 */
import type { SellerPlanFeatures, SellerPlanId } from "./planCatalogue";
import { PLAN_CATALOGUE, PLAN_IDS } from "./planCatalogue";

export type PlanFeature =
  | "live_hosting"
  | "drops"
  | "boosts"
  | "custom_domain"
  | "manufacturer_hub"
  | "advanced_analytics"
  | "analytics_export";

const UNLOCKS: Record<PlanFeature, (t: SellerPlanFeatures) => boolean> = {
  live_hosting: (t) => t.liveSelling,
  drops: (t) => t.dropsEscrow,
  boosts: (t) => t.boostFeatured,
  custom_domain: (t) => t.customDomain,
  manufacturer_hub: (t) => t.manufacturerHub,
  advanced_analytics: (t) => t.analytics !== "basic",
  analytics_export: (t) => t.analyticsExport,
};

const tierFeatures = (plan: SellerPlanId) => PLAN_CATALOGUE[plan].features;

function envInt(name: string, fallback: number | null): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  if (raw.trim().toLowerCase() === "unlimited") return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : fallback;
}

function plansByRank(): SellerPlanId[] {
  return [...PLAN_IDS].sort((a, b) => PLAN_CATALOGUE[a].rank - PLAN_CATALOGUE[b].rank);
}

/** The cheapest plan that includes each feature (Pro when none does, so the gate stays shut). */
export function featureMinPlans(): Record<PlanFeature, SellerPlanId> {
  const order = plansByRank();
  const out = {} as Record<PlanFeature, SellerPlanId>;
  for (const feature of Object.keys(UNLOCKS) as PlanFeature[]) {
    out[feature] = order.find((plan) => UNLOCKS[feature](tierFeatures(plan))) ?? "pro";
  }
  return out;
}

export function planIncludes(plan: SellerPlanId, feature: PlanFeature): boolean {
  return UNLOCKS[feature](tierFeatures(plan));
}

export type PlanAllowance = "marketing_emails_per_month" | "push_broadcasts_per_week" | "live_minutes_per_month";

/** null = unlimited, 0 = not on this plan. */
export function planAllowances(): Record<PlanAllowance, Record<SellerPlanId, number | null>> {
  const tiers = { starter: tierFeatures("starter"), growth: tierFeatures("growth"), pro: tierFeatures("pro") };
  return {
    marketing_emails_per_month: {
      starter: tiers.starter.emailSendsMonthly,
      growth: tiers.growth.emailSendsMonthly,
      pro: tiers.pro.emailSendsMonthly,
    },
    push_broadcasts_per_week: { starter: 1, growth: 3, pro: 7 },
    live_minutes_per_month: {
      starter: tiers.starter.liveSelling ? null : 0,
      // No monthly cap unless Dev sets one (e.g. LIVE_GROWTH_MINUTES_PER_MONTH=240) to keep video costs in check.
      growth: tiers.growth.liveSelling ? envInt("LIVE_GROWTH_MINUTES_PER_MONTH", null) : 0,
      pro: tiers.pro.liveSelling ? null : 0,
    },
  };
}

export function hasPlan(current: SellerPlanId, required: SellerPlanId): boolean {
  return (PLAN_CATALOGUE[current]?.rank ?? 0) >= PLAN_CATALOGUE[required].rank;
}

/** The cheapest plan above `current` whose allowance is above `used` (for the upgrade prompt). */
export function planForMore(allowance: PlanAllowance, current: SellerPlanId, used: number): SellerPlanId | null {
  const caps = planAllowances()[allowance];
  for (const plan of plansByRank()) {
    if (hasPlan(plan, current) && plan !== current) {
      const cap = caps[plan];
      if (cap === null || cap > used) return plan;
    }
  }
  return null;
}

/** Lock icons and allowances for the app. Each tier's own values come from GET /api/config/seller-plans. */
export function publicPlanFeatures() {
  return { minPlan: featureMinPlans(), allowances: planAllowances() };
}

const LABEL: Record<PlanFeature, string> = {
  live_hosting: "Live selling",
  drops: "Drops and pre-orders",
  boosts: "Boosts and Featured slots",
  custom_domain: "A custom domain",
  manufacturer_hub: "RFQs and bulk orders",
  advanced_analytics: "Advanced analytics",
  analytics_export: "Analytics export",
};

export function featureLabel(feature: PlanFeature): string {
  return LABEL[feature];
}
