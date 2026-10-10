/**
 * What each seller plan includes beyond its limits: the platform commission,
 * monthly AI credits and advanced analytics. One config so a product decision
 * is a one-line change here. Prices come from planCatalogue and credits from
 * aiCredits/catalogue, so nothing is stated twice.
 */
import { getEffectiveEntitlement } from "./nativeEntitlements";
import { creditPolicyForPlan } from "./aiCredits/catalogue";
import { PLATFORM_FEE_BPS } from "./money/fees";
import { PLAN_CATALOGUE, PLAN_IDS, isSellerPlanId, type SellerPlanId } from "./planCatalogue";
import { planIncludes } from "./planFeatures";

export type PlanPerkConfig = {
  /** Brandthread commission on merchandise, in basis points (1 bp = 0.01%). */
  platformFeeBps: number;
  advancedAnalytics: boolean;
};

export const PLAN_PERKS: Record<SellerPlanId, PlanPerkConfig> = {
  // Starter keeps the standard rate every seller had before plan-based fees.
  starter: { platformFeeBps: PLATFORM_FEE_BPS, advancedAnalytics: false },
  growth: { platformFeeBps: 400, advancedAnalytics: false },
  pro: { platformFeeBps: 300, advancedAnalytics: true },
};

/** Rate used whenever the plan is unknown or cannot be looked up. */
export const DEFAULT_PLATFORM_FEE_BPS = PLATFORM_FEE_BPS;

export function platformFeeBpsForPlan(planId: string | null | undefined): number {
  return isSellerPlanId(planId) ? PLAN_PERKS[planId].platformFeeBps : DEFAULT_PLATFORM_FEE_BPS;
}

export function hasAdvancedAnalytics(planId: string | null | undefined): boolean {
  // The analytics level per plan lives in planCatalogue.ts (features.analytics).
  return isSellerPlanId(planId) && planIncludes(planId, "advanced_analytics");
}

/**
 * The commission rate for a seller's next checkout, from their server-verified
 * plan. Fails safe: any lookup error charges the standard rate, it never
 * blocks a sale.
 */
export async function resolveSellerPlatformFeeBps(sellerId: string): Promise<number> {
  try {
    const entitlement = await getEffectiveEntitlement(sellerId);
    return platformFeeBpsForPlan(entitlement.planId);
  } catch {
    return DEFAULT_PLATFORM_FEE_BPS;
  }
}

/** Monthly AI credits for a plan from the credit policy; `null` means unlimited (never show a count). */
export function monthlyAiCreditsForPlan(planId: SellerPlanId): number | null {
  return creditPolicyForPlan(planId).monthlyAllowance;
}

export type PlanPerksPayload = {
  planId: SellerPlanId;
  name: string;
  amountCents: number;
  platformFeeBps: number;
  /** null when unlimited. */
  monthlyAiCredits: number | null;
  unlimitedAiCredits: boolean;
  advancedAnalytics: boolean;
};

export function buildPlanPerks(): PlanPerksPayload[] {
  return PLAN_IDS.map((planId) => ({
    planId,
    name: PLAN_CATALOGUE[planId].name,
    amountCents: PLAN_CATALOGUE[planId].amountCents,
    platformFeeBps: PLAN_PERKS[planId].platformFeeBps,
    monthlyAiCredits: monthlyAiCreditsForPlan(planId),
    unlimitedAiCredits: monthlyAiCreditsForPlan(planId) === null,
    advancedAnalytics: hasAdvancedAnalytics(planId),
  }));
}
