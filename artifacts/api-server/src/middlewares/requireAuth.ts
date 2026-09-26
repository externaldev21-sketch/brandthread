import { getAuth } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { users } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getEffectiveEntitlement } from "../lib/nativeEntitlements";
import { PLAN_CATALOGUE, type SellerPlanId } from "../lib/planCatalogue";

/**
 * QA-crawl-only auth bypass.
 *
 * Real Clerk session verification requires network access to Clerk plus a
 * real publishable/secret key pair, neither of which exists in an offline
 * sandbox used for the automated QA crawl harness (see
 * docs/qa/full-crawl-report.md, "Harness" section). This lets that harness
 * impersonate a seeded buyer/seller by clerkId via a request header, and does
 * nothing unless BOTH conditions hold:
 *   - NODE_ENV !== "production"
 *   - ENABLE_QA_AUTH_BYPASS === "true" (never set in a deployed environment)
 * Mirrors the existing ALLOW_TEST_SUBSCRIPTION_BYPASS pattern below.
 */
const ALLOW_QA_AUTH_BYPASS =
  process.env.NODE_ENV !== "production" && process.env.ENABLE_QA_AUTH_BYPASS === "true";

function qaBypassUserId(req: Request): string | null {
  if (!ALLOW_QA_AUTH_BYPASS) return null;
  const header = req.headers["x-qa-user-id"];
  const value = Array.isArray(header) ? header[0] : header;
  return value || null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const bypassUserId = qaBypassUserId(req);
  const userId = bypassUserId ?? getAuth(req).userId;
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

/**
 * Development-only subscription override.
 *
 * This remains disabled by default, cannot run in production, and is gated by
 * a server environment variable so client code can never unlock paid endpoints.
 */
const ALLOW_TEST_SUBSCRIPTION_BYPASS =
  process.env.NODE_ENV === "development" &&
  process.env.ENABLE_TEST_SUBSCRIPTION_BYPASS === "true";

/**
 * Middleware factory that enforces a minimum subscription plan.
 * Apply AFTER requireAuth (or standalone — it re-reads Clerk auth internally).
 *
 * Returns 403 with `{ error, code, requiredPlan, currentPlan, message }` when
 * the authenticated seller's plan is below `minPlan`. If the server cannot
 * verify the plan, it returns 503 rather than granting paid access.
 */
export function requirePlan(minPlan: SellerPlanId) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const actorUserId = qaBypassUserId(req) ?? getAuth(req).userId;
    if (!actorUserId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (ALLOW_TEST_SUBSCRIPTION_BYPASS) {
      next();
      return;
    }

    try {
      // This reads the server-verified native entitlement cache alongside the
      // existing Stripe fields. Access must remain denied if this verification
      // cannot complete.
      // teamContext rewrites clerkUserId to the authenticated store owner.
      // Paid access belongs to that store, not to an individual team member.
      const ownerId = ((req as any).clerkUserId as string | undefined) ?? actorUserId;
      const entitlement = await getEffectiveEntitlement(ownerId);
      const plan = entitlement.planId;
      const currentLevel = PLAN_CATALOGUE[plan]?.rank ?? PLAN_CATALOGUE.starter.rank;
      const requiredLevel = PLAN_CATALOGUE[minPlan].rank;

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
      (req as Request & { log?: { error: (details: unknown, message: string) => void } })
        .log?.error({ err, requiredPlan: minPlan }, "Subscription plan lookup failed");
      res.status(503).json({
        error: "Unable to verify subscription plan",
        code: "PLAN_CHECK_UNAVAILABLE",
        requiredPlan: minPlan,
        message: "Subscription access could not be verified. Please try again.",
      });
    }
  };
}
