/**
 * Monthly live-hosting minutes (lib/planFeatures.ts → live_minutes_per_month):
 * Growth includes a monthly allowance to keep video costs in check, Pro is
 * unlimited. Checked when a live starts; a live in progress is never cut off.
 */
import type { Request, Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { planAllowances } from "./planFeatures";
import type { SellerPlanId } from "./planCatalogue";

export function monthStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function liveMinutesThisMonth(sellerId: string, now = new Date()): Promise<number> {
  const result = await db.execute(sql`
    SELECT coalesce(sum(extract(epoch FROM (least(coalesce(ended_at, ${now}), ${now}) - greatest(started_at, ${monthStartUtc(now)})))), 0)::float AS seconds
    FROM live_streams
    WHERE seller_id = ${sellerId} AND coalesce(ended_at, ${now}) > ${monthStartUtc(now)}
  `);
  const seconds = Number(((result as any).rows?.[0]?.seconds) ?? 0);
  return Math.max(0, Math.floor(seconds / 60));
}

export function liveAllowanceBlock(plan: SellerPlanId, usedMinutes: number) {
  const cap = planAllowances().live_minutes_per_month[plan];
  if (cap === null || usedMinutes < cap) return null;
  const hours = Math.round((cap / 60) * 10) / 10;
  return {
    error: "Plan limit reached",
    code: "PLAN_LIMIT_REACHED",
    resource: "live_minutes",
    currentPlan: plan,
    requiredPlan: "pro" as const,
    limit: cap,
    used: usedMinutes,
    message: `You've used this month's ${hours} hours of live selling. Upgrade to Pro for unlimited lives.`,
  };
}

/** featureGate `extra`: only POST /start spends minutes. */
export async function checkLiveAllowance(req: Request, res: Response, ctx: { ownerId: string; plan: SellerPlanId }): Promise<boolean> {
  if (req.method !== "POST" || req.path !== "/start") return true;
  const block = liveAllowanceBlock(ctx.plan, await liveMinutesThisMonth(ctx.ownerId));
  if (!block) return true;
  res.status(403).json(block);
  return false;
}
