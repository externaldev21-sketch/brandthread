/**
 * What each seller plan includes beyond its limits: the platform commission,
 * monthly AI credits and advanced analytics. One config so a product decision
 * is a one-line change here. Prices come from planCatalogue and credits from
 * aiCredits/catalogue, so nothing is stated twice.
 */
import { getEffectiveEntitlement } from "./nativeEntitlements";
import { MONTHLY_ALLOWANCE } from "./aiCredits/catalogue";
import { PLATFORM_FEE_BPS } from "./money/fees";
import { PLAN_CATALOGUE, PLAN_IDS, isSellerPlanId, type SellerPlanId } from "./planCatalogue";

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
  return isSellerPlanId(planId) && PLAN_PERKS[planId].advancedAnalytics;
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

export type PlanPerksPayload = {
  planId: SellerPlanId;
  name: string;
  amountCents: number;
  platformFeeBps: number;
  monthlyAiCredits: number;
  advancedAnalytics: boolean;
};

export function buildPlanPerks(): PlanPerksPayload[] {
  return PLAN_IDS.map((planId) => ({
    planId,
    name: PLAN_CATALOGUE[planId].name,
    amountCents: PLAN_CATALOGUE[planId].amountCents,
    platformFeeBps: PLAN_PERKS[planId].platformFeeBps,
    monthlyAiCredits: MONTHLY_ALLOWANCE[planId],
    advancedAnalytics: PLAN_PERKS[planId].advancedAnalytics,
  }));
}
