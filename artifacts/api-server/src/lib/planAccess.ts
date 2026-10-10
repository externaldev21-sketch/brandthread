import type { Request, Response } from "express";
import { getEffectiveEntitlement } from "./nativeEntitlements";
import { NO_PLAN_LIMITS, PLAN_CATALOGUE, PLAN_IDS, type SellerPlanId, type SellerPlanLimits } from "./planCatalogue";

export type VerifiedPlanAccess = {
  planId: SellerPlanId;
  limits: SellerPlanLimits;
  /** False when the seller has no live trial or paid plan (NO_PLAN_LIMITS apply: nothing can be published or sold). */
  paid: boolean;
};

/**
 * Plan limits for a seller. With no live trial or paid plan (never
 * subscribed, cancelled after access ended, expired, or past_due beyond the
 * grace period) NO_PLAN_LIMITS apply: "pick a plan to keep selling".
 */
export async function getVerifiedPlanAccess(ownerId: string): Promise<VerifiedPlanAccess> {
  const entitlement = await getEffectiveEntitlement(ownerId);
  const paid = entitlement.provider !== "none";
  return {
    planId: entitlement.planId,
    limits: paid ? PLAN_CATALOGUE[entitlement.planId].limits : NO_PLAN_LIMITS,
    paid,
  };
}

type LimitedResource = keyof SellerPlanLimits;

function roomFor(planId: SellerPlanId, resource: LimitedResource): number {
  const value = PLAN_CATALOGUE[planId].limits[resource];
  return value === null ? Infinity : value;
}

/**
 * The cheapest plan above the seller's that raises the limit on `resource`:
 * Starter for a seller with no plan, then the next tier with more room.
 * null when no plan offers more.
 */
export function nextPlanFor(
  access: Pick<VerifiedPlanAccess, "planId" | "paid">,
  resource: LimitedResource = "products",
): SellerPlanId | null {
  if (!access.paid) return "starter";
  const current = roomFor(access.planId, resource);
  return PLAN_IDS.find((id) => PLAN_CATALOGUE[id].rank > PLAN_CATALOGUE[access.planId].rank && roomFor(id, resource) > current) ?? null;
}

export function sendPlanLookupUnavailable(req: Request, res: Response, error: unknown): void {
  req.log?.error({ err: error }, "Subscription plan lookup failed");
  res.status(503).json({
    error: "Unable to verify subscription plan",
    code: "PLAN_CHECK_UNAVAILABLE",
    message: "Subscription access could not be verified. Please try again.",
  });
}

/**
 * The upgrade copy for a hit limit (Dev's wording):
 * "You've listed 10 of 10 products on Starter. Upgrade to Growth to list up to 50."
 */
export function planLimitMessage(input: {
  resource: LimitedResource;
  planId: SellerPlanId;
  paid: boolean;
  used: number;
  limit: number;
  nextPlan: SellerPlanId | null;
}): string {
  if (!input.paid) return "Pick a plan to start selling.";
  const current = PLAN_CATALOGUE[input.planId].label;
  const next = input.nextPlan ? PLAN_CATALOGUE[input.nextPlan] : null;
  const nextLimit = next ? next.limits[input.resource] : undefined;
  if (input.resource === "products") {
    const head = `You've listed ${input.used} of ${input.limit} product${input.limit === 1 ? "" : "s"} on ${current}.`;
    if (!next) return head;
    return `${head} Upgrade to ${next.label} to list ${nextLimit === null ? "unlimited products" : `up to ${nextLimit}`}.`;
  }
  const head = `${current} includes ${input.limit} staff seat${input.limit === 1 ? "" : "s"}.`;
  if (!next) return head;
  return `${head} Upgrade to ${next.label} for ${nextLimit === null ? "unlimited seats" : `${nextLimit} seats`}.`;
}

export function sendPlanLimitReached(
  res: Response,
  options: {
    resource: LimitedResource;
    currentPlan: SellerPlanId;
    limit: number;
    /** Kept for existing callers; the response names the plan that actually raises this limit. */
    requiredPlan?: SellerPlanId;
    /** false: the seller has no live trial or paid plan. */
    paid?: boolean;
    /** How many are in use now (defaults to the limit: the seller is at the cap). */
    used?: number;
  },
): void {
  const paid = options.paid !== false;
  const nextPlan = nextPlanFor({ planId: options.currentPlan, paid }, options.resource);
  const used = options.used ?? options.limit;
  res.status(403).json({
    error: "Plan limit reached",
    code: "PLAN_LIMIT_REACHED",
    resource: options.resource,
    currentPlan: paid ? options.currentPlan : "none",
    requiredPlan: nextPlan,
    used,
    limit: options.limit,
    nextLimit: nextPlan ? PLAN_CATALOGUE[nextPlan].limits[options.resource] : null,
    message: planLimitMessage({ resource: options.resource, planId: options.currentPlan, paid, used, limit: options.limit, nextPlan }),
  });
}
