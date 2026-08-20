import { getAuth } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { users } from "@workspace/db";
import { eq } from "drizzle-orm";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  (req as any).clerkUserId = userId;
  next();
}

// ─── Plan hierarchy ────────────────────────────────────────────────────────────

const PLAN_ORDER: Record<string, number> = {
  starter: 0,
  growth: 1,
  pro: 2,
};

/**
 * TEMPORARY TESTING SWITCH
 *
 * Allows authenticated sellers to explore plan-gated product areas without a
 * paid subscription. It deliberately does not bypass Clerk authentication,
 * role checks, or any non-subscription authorization. Set false before release.
 */
const TEMPORARILY_UNLOCK_ALL_SUBSCRIPTION_FEATURES_FOR_TESTING = true;

/**
 * Middleware factory that enforces a minimum subscription plan.
 * Apply AFTER requireAuth (or standalone — it re-reads Clerk auth internally).
 *
 * Returns 403 with `{ error, code, requiredPlan, currentPlan, message }` when
 * the authenticated seller's plan is below `minPlan`.
 */
export function requirePlan(minPlan: "growth" | "pro") {
  return async (req: Request, res: Response, next: NextFunction) => {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (TEMPORARILY_UNLOCK_ALL_SUBSCRIPTION_FEATURES_FOR_TESTING) {
      next();
      return;
    }

    try {
      const rows = await db
        .select({ subscriptionPlanId: users.subscriptionPlanId })
        .from(users)
        .where(eq(users.clerkId, userId))
        .limit(1);

      const plan = rows[0]?.subscriptionPlanId ?? "starter";
      const currentLevel = PLAN_ORDER[plan] ?? 0;
      const requiredLevel = PLAN_ORDER[minPlan] ?? 1;

      if (currentLevel < requiredLevel) {
        const planLabel = minPlan.charAt(0).toUpperCase() + minPlan.slice(1);
        res.status(403).json({
          error: "Plan required",
          code: "PLAN_REQUIRED",
          requiredPlan: minPlan,
          currentPlan: plan,
          message: `This feature requires the ${planLabel} plan or higher. Upgrade to unlock it.`,
        });
        return;
      }

      next();
    } catch (err) {
      console.error("[requirePlan] DB lookup failed:", err);
      // Fail open — don't block the user if we can't check the plan
      next();
    }
  };
}
