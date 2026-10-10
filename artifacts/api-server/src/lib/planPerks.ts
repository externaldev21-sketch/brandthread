/**
 * What each seller plan includes beyond its limits: monthly AI credits and
 * advanced analytics. One config so a product decision is a one-line change
 * here. Prices come from planCatalogue, credits from aiCredits/catalogue and
 * the commission from money/fees (PLATFORM_FEE_BPS), so nothing is stated
 * twice.
 *
 * Owner's rule: the commission is a flat 5% on every plan and every
 * subscription status (trial, past due, grace). No plan buys a lower rate.
 */
import { creditPolicyForPlan } from "./aiCredits/catalogue";
import { PLATFORM_FEE_BPS } from "./money/fees";
import { PLAN_CATALOGUE, PLAN_IDS, isSellerPlanId, type SellerPlanId } from "./planCatalogue";

export type PlanPerkConfig = {
  /** Brandthread commission on item + shipping, in basis points. Always PLATFORM_FEE_BPS. */
  platformFeeBps: number;
  advancedAnalytics: boolean;
};

export const PLAN_PERKS: Record<SellerPlanId, PlanPerkConfig> = {
  starter: { platformFeeBps: PLATFORM_FEE_BPS, advancedAnalytics: false },
  growth: { platformFeeBps: PLATFORM_FEE_BPS, advancedAnalytics: false },
  pro: { platformFeeBps: PLATFORM_FEE_BPS, advancedAnalytics: true },
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
 * The commission rate for a seller's next checkout. Flat on every plan, so
 * there is nothing to look up; it keeps the seller id so every checkout path
 * still has one call site if the rule ever changes.
 */
export async function resolveSellerPlatformFeeBps(_sellerId: string): Promise<number> {
  return PLATFORM_FEE_BPS;
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
    advancedAnalytics: PLAN_PERKS[planId].advancedAnalytics,
  }));
}
