import type { Request, Response } from "express";
import { getEffectiveEntitlement } from "./nativeEntitlements";
import { PLAN_CATALOGUE, type SellerPlanId, type SellerPlanLimits } from "./planCatalogue";

export type VerifiedPlanAccess = {
  planId: SellerPlanId;
  limits: SellerPlanLimits;
};

export async function getVerifiedPlanAccess(ownerId: string): Promise<VerifiedPlanAccess> {
  const entitlement = await getEffectiveEntitlement(ownerId);
  return {
    planId: entitlement.planId,
    limits: PLAN_CATALOGUE[entitlement.planId].limits,
  };
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
  },
): void {
  const resourceLabel = options.resource === "products" ? "product" : "team seat";
  res.status(403).json({
    error: "Plan limit reached",
    code: "PLAN_LIMIT_REACHED",
    resource: options.resource,
    currentPlan: options.currentPlan,
    requiredPlan: options.requiredPlan,
    limit: options.limit,
    message: `Your ${options.currentPlan.charAt(0).toUpperCase() + options.currentPlan.slice(1)} plan includes ${options.limit} ${resourceLabel}${options.limit === 1 ? "" : "s"}. Upgrade to add more.`,
  });
}
