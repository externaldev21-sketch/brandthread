/**
 * Weekly follower-push allowance per plan (lib/planFeatures.ts →
 * push_broadcasts_per_week: Starter 1, Growth 3, Pro 7), on top of the
 * existing one-per-24h limit in lib/sellerPushBroadcast.ts. Only sending
 * (POST /) is metered; preview and history stay open.
 */
import type { NextFunction, Request, Response } from "express";
import { and, eq, gte, ne, sql } from "drizzle-orm";
import { db, sellerPushBroadcasts } from "@workspace/db";
import { getEffectiveEntitlement } from "../lib/nativeEntitlements";
import { planAllowances, planForMore } from "../lib/planFeatures";
import { sendPlanLookupUnavailable } from "../lib/planAccess";
import type { SellerPlanId } from "../lib/planCatalogue";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function pushLimitBody(plan: SellerPlanId, cap: number, used: number) {
  return {
    error: "Plan limit reached",
    code: "PLAN_LIMIT_REACHED",
    resource: "push_broadcasts",
    currentPlan: plan,
    requiredPlan: planForMore("push_broadcasts_per_week", plan, used) ?? "pro",
    limit: cap,
    used,
    message: `Your plan includes ${cap} follower push${cap === 1 ? "" : "es"} a week. Upgrade to send more.`,
  };
}

export async function pushBroadcastAllowance(req: Request, res: Response, next: NextFunction) {
  if (req.method !== "POST" || req.path !== "/") return next();
  const sellerId = (req as any).clerkUserId as string | undefined;
  if (!sellerId) return void res.status(401).json({ error: "Unauthorized" });
  let plan: SellerPlanId;
  try {
    plan = (await getEffectiveEntitlement(sellerId)).planId;
  } catch (err) {
    return sendPlanLookupUnavailable(req, res, err);
  }
  const cap = planAllowances().push_broadcasts_per_week[plan];
  if (cap === null) return next();
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(sellerPushBroadcasts).where(and(
    eq(sellerPushBroadcasts.sellerId, sellerId),
    gte(sellerPushBroadcasts.createdAt, new Date(Date.now() - WEEK_MS)),
    ne(sellerPushBroadcasts.status, "failed"),
  ));
  const used = Number(row?.n ?? 0);
  if (used >= cap) return void res.status(403).json(pushLimitBody(plan, cap, used));
  next();
}
