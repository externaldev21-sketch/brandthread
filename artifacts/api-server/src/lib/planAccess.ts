import type { Request, Response } from "express";
import { getEffectiveEntitlement } from "./nativeEntitlements";
import { FREE_TIER_LIMITS, PLAN_CATALOGUE, type SellerPlanId, type SellerPlanLimits } from "./planCatalogue";

export type VerifiedPlanAccess = {
  planId: SellerPlanId;
  limits: SellerPlanLimits;
  /** False when the seller has no active, trialing or in-grace subscription (free limits apply). */
  paid: boolean;
};

/**
 * Plan limits for a seller. With no paid access (never subscribed,
 * cancelled, expired, or past_due beyond the grace period) the free-tier
 * limits from planCatalogue apply, not Starter's (BT-002).
 */
export async function getVerifiedPlanAccess(ownerId: string): Promise<VerifiedPlanAccess> {
  const entitlement = await getEffectiveEntitlement(ownerId);
  const paid = entitlement.provider !== "none";
  return {
    planId: entitlement.planId,
    limits: paid ? PLAN_CATALOGUE[entitlement.planId].limits : FREE_TIER_LIMITS,
    paid,
  };
}

/** The plan a seller needs next when they hit a limit: Starter from free, Growth from Starter. */
export function nextPlanFor(access: Pick<VerifiedPlanAccess, "planId" | "paid">): SellerPlanId {
  if (!access.paid) return "starter";
  return access.planId === "starter" ? "growth" : "pro";
}

export function sendPlanLookupUnavailable(req: Request, res: Response, error: unknown): void {
  req.log?.error({ err: error }, "Subscription plan lookup failed");
  res.status(503).json({
    error: "Unable to verify subscription plan",
    code: "PLAN_CHECK_UNAVAILABLE",
    message: "Subscription access could not be verified. Please try again.",
  });
}

export function sendPlanLimitReached(
  res: Response,
  options: {
    resource: "products" | "teamSeats";
    currentPlan: SellerPlanId;
    limit: number;
    requiredPlan: SellerPlanId;
    /** false: the seller is on the free limits (no paid subscription). */
    paid?: boolean;
  },
): void {
  const resourceLabel = options.resource === "products" ? "product" : "team seat";
  const free = options.paid === false;
  const planLabel = free ? "free" : options.currentPlan.charAt(0).toUpperCase() + options.currentPlan.slice(1);
  res.status(403).json({
    error: "Plan limit reached",
    code: "PLAN_LIMIT_REACHED",
    resource: options.resource,
    currentPlan: free ? "free" : options.currentPlan,
    requiredPlan: free ? "starter" : options.requiredPlan,
    limit: options.limit,
    message: `Your ${planLabel} plan includes ${options.limit} ${resourceLabel}${options.limit === 1 ? "" : "s"}. ${free ? "Start a plan" : "Upgrade"} to add more.`,
  });
}
