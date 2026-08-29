import { getAuth } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { users } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getEffectiveEntitlement } from "../lib/nativeEntitlements";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  (req as any).clerkUserId = userId;
  next();
}

/**
 * Platform moderation is distinct from seller team ownership. A store owner
 * must not automatically gain access to reports made across the marketplace.
 * Apply after requireAuth.
 */
export async function requireModerator(req: Request, res: Response, next: NextFunction) {
  const userId = (req as any).clerkUserId as string | undefined;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const [account] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.clerkId, userId))
      .limit(1);
    if (account?.role !== "admin") {
      res.status(403).json({ error: "Moderator access required" });
      return;
    }
    next();
  } catch (error) {
    req.log.error({ err: error }, "Moderator access lookup failed");
    res.status(503).json({ error: "Unable to verify moderator access" });
  }
}

// ─── Plan hierarchy ────────────────────────────────────────────────────────────

const PLAN_ORDER: Record<string, number> = {
  starter: 0,
  growth: 1,
  scale: 2,
  // Compatibility for Stripe subscribers created under the prior name.
  pro: 2,
};

/**
 * Development-only subscription override.
 *
 * This remains disabled by default, cannot run in production, and is gated by
 * a server environment variable so client code can never unlock paid endpoints.
 */
const ALLOW_TEST_SUBSCRIPTION_BYPASS =
  process.env.NODE_ENV !== "production" &&
  process.env.ENABLE_TEST_SUBSCRIPTION_BYPASS === "true";

/**
 * Middleware factory that enforces a minimum subscription plan.
 * Apply AFTER requireAuth (or standalone — it re-reads Clerk auth internally).
 *
 * Returns 403 with `{ error, code, requiredPlan, currentPlan, message }` when
 * the authenticated seller's plan is below `minPlan`.
 */
export function requirePlan(minPlan: "growth" | "scale" | "pro") {
  return async (req: Request, res: Response, next: NextFunction) => {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (ALLOW_TEST_SUBSCRIPTION_BYPASS) {
      next();
      return;
    }

    try {
      // This reads the server-verified native entitlement cache alongside the
      // existing Stripe fields. It deliberately retains the historical
      // fail-open catch below; task #248 owns any broader policy change.
      const entitlement = await getEffectiveEntitlement(userId);
      const plan = entitlement.planId;
      const currentLevel = PLAN_ORDER[plan] ?? 0;
      const normalizedRequiredPlan = minPlan === "pro" ? "scale" : minPlan;
      const requiredLevel = PLAN_ORDER[normalizedRequiredPlan] ?? 1;

      if (currentLevel < requiredLevel) {
        const planLabel = normalizedRequiredPlan.charAt(0).toUpperCase() + normalizedRequiredPlan.slice(1);
        res.status(403).json({
          error: "Plan required",
          code: "PLAN_REQUIRED",
          requiredPlan: normalizedRequiredPlan,
          currentPlan: plan,
          message: `This feature requires the ${planLabel} plan or higher. Upgrade to unlock it.`,
        });
        return;
      }

      next();
    } catch (err) {
      req.log.error({ err, requiredPlan: minPlan }, "Subscription plan lookup failed");
      // Fail open — don't block the user if we can't check the plan
      next();
    }
  };
}
