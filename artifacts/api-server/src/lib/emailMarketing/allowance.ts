/**
 * Monthly marketing-email allowance per plan (lib/planFeatures.ts →
 * marketing_emails_per_month: Starter 500, Growth 10,000, Pro 50,000 by
 * default). Counted from email_campaign_sends this calendar month (UTC);
 * queued and in-flight sends count, so two campaigns can't both squeeze under
 * the cap. The daily cap in sender.ts still applies on top.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { getEffectiveEntitlement } from "../nativeEntitlements";
import { planAllowances, planForMore } from "../planFeatures";
import type { SellerPlanId } from "../planCatalogue";

export function startOfUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function emailsUsedThisMonth(sellerId: string, now = new Date(), opts: { includeQueued?: boolean } = {}): Promise<number> {
  const r = await db.execute(sql`
    SELECT count(*)::int AS n FROM email_campaign_sends
    WHERE seller_id = ${sellerId}
      AND (
        (status = 'sent' AND sent_at >= ${startOfUtcMonth(now)})
        OR status = 'sending'
        ${opts.includeQueued ? sql`OR status = 'queued'` : sql``}
      )
  `);
  return Number((r.rows[0] as { n: number }).n);
}

export function monthlyEmailCap(plan: SellerPlanId): number | null {
  return planAllowances().marketing_emails_per_month[plan];
}

/** Pure: how many more emails this month (Infinity when unlimited). */
export function emailsLeft(cap: number | null, used: number): number {
  return cap === null ? Number.POSITIVE_INFINITY : Math.max(0, cap - used);
}

export function emailLimitBody(plan: SellerPlanId, cap: number, used: number, recipients: number) {
  const left = Math.max(0, cap - used);
  return {
    error: "Plan limit reached",
    code: "PLAN_LIMIT_REACHED",
    resource: "marketing_emails",
    currentPlan: plan,
    requiredPlan: planForMore("marketing_emails_per_month", plan, used + recipients) ?? "pro",
    limit: cap,
    used,
    message: left === 0
      ? `You've sent this month's ${cap.toLocaleString("en-US")} marketing emails. Upgrade to send more.`
      : `This campaign goes to ${recipients.toLocaleString("en-US")} people and your plan has ${left.toLocaleString("en-US")} emails left this month. Upgrade to send it.`,
  };
}

/** null when the campaign fits this month's allowance, else the 403 body. */
export async function checkMonthlyEmailAllowance(sellerId: string, recipients: number, now = new Date()) {
  const plan = (await getEffectiveEntitlement(sellerId)).planId;
  const cap = monthlyEmailCap(plan);
  if (cap === null) return null;
  const used = await emailsUsedThisMonth(sellerId, now, { includeQueued: true });
  return used + recipients > cap ? emailLimitBody(plan, cap, used, recipients) : null;
}

/** How many more may go out right now (sender.ts batches). */
export async function monthlyEmailsLeft(sellerId: string, now = new Date()): Promise<number> {
  const plan = (await getEffectiveEntitlement(sellerId)).planId;
  return emailsLeft(monthlyEmailCap(plan), await emailsUsedThisMonth(sellerId, now));
}

/** For GET /marketing/email/status: this month's plan allowance. */
export async function monthlyAllowanceView(sellerId: string, now = new Date()) {
  try {
    const plan = (await getEffectiveEntitlement(sellerId)).planId;
    const cap = monthlyEmailCap(plan);
    const used = await emailsUsedThisMonth(sellerId, now, { includeQueued: true });
    return { plan, monthlyCap: cap, sentThisMonth: used, remainingThisMonth: cap === null ? null : Math.max(0, cap - used) };
  } catch {
    return {};
  }
}
