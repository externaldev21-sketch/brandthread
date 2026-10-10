/**
 * Plan gate for one seller growth tool (lib/planFeatures.ts). Same 403
 * shape as requirePlan — { code: "PLAN_REQUIRED", requiredPlan, currentPlan,
 * message } — so the app's upgrade prompt opens instead of a generic error.
 *
 * `only` limits the gate to the requests that start something new (e.g.
 * POST /), leaving list / manage / cancel open after a downgrade.
 */
import type { NextFunction, Request, Response } from "express";
import { getEffectiveEntitlement } from "../lib/nativeEntitlements";
import { featureLabel, featureMinPlans, hasPlan, type PlanFeature } from "../lib/planFeatures";
import { sendPlanLookupUnavailable } from "../lib/planAccess";
import type { SellerPlanId } from "../lib/planCatalogue";

const ALLOW_TEST_SUBSCRIPTION_BYPASS =
  process.env.NODE_ENV === "development" && process.env.ENABLE_TEST_SUBSCRIPTION_BYPASS === "true";

export type GateMatch = { method: string; path: string | RegExp };

function matches(req: Request, only: GateMatch[] | undefined): boolean {
  if (!only) return true;
  return only.some((m) => m.method === req.method && (typeof m.path === "string" ? req.path === m.path : m.path.test(req.path)));
}

export function planRequiredBody(feature: PlanFeature, requiredPlan: SellerPlanId, currentPlan: SellerPlanId) {
  const planLabel = requiredPlan.charAt(0).toUpperCase() + requiredPlan.slice(1);
  return {
    error: "Plan required",
    code: "PLAN_REQUIRED",
    feature,
    requiredPlan,
    currentPlan,
    message: `${featureLabel(feature)} is on the ${planLabel} plan. Upgrade to use it.`,
  };
}

export type ExtraCheck = (req: Request, res: Response, ctx: { ownerId: string; plan: SellerPlanId }) => Promise<boolean>;

export function featureGate(feature: PlanFeature, options: { only?: GateMatch[]; extra?: ExtraCheck } = {}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!matches(req, options.only) || ALLOW_TEST_SUBSCRIPTION_BYPASS) return next();
    const ownerId = (req as any).clerkUserId as string | undefined;
    if (!ownerId) return void res.status(401).json({ error: "Unauthorized" });
    let plan: SellerPlanId;
    try {
      plan = (await getEffectiveEntitlement(ownerId)).planId;
    } catch (err) {
      return sendPlanLookupUnavailable(req, res, err);
    }
    const required = featureMinPlans()[feature];
    if (!hasPlan(plan, required)) return void res.status(403).json(planRequiredBody(feature, required, plan));
    if (options.extra && !(await options.extra(req, res, { ownerId, plan }))) return;
    next();
  };
}
