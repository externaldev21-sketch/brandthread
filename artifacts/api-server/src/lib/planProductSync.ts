/**
 * Keeps a seller's live listings inside their plan's product cap (Dev's
 * plan-tier spec):
 *  - Downgrade, cancelled or lapsed plan: live products over the new cap are
 *    moved to drafts newest-first (the oldest stay live), never deleted, and
 *    marked plan_hidden_at. The seller gets a clear notice.
 *  - Upgrade or re-subscribe: products the plan hid come back oldest-first
 *    until the cap is full.
 * Products the seller drafted or archived themselves are never touched; a
 * seller changing a hidden product's status clears its mark.
 *
 * Runs after every subscription change (Stripe and RevenueCat webhooks) and
 * from an hourly sweep (jobs/planProductSync.ts) that catches trials and
 * grace periods ending without a webhook.
 */
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db, products } from "@workspace/db";
import { getVerifiedPlanAccess } from "./planAccess";
import { PLAN_CATALOGUE } from "./planCatalogue";
import { activeProductsWhere } from "./productCapacity";
import { logger } from "./logger";

export type PlanProductSyncResult = { hidden: string[]; restored: string[] };

/** Which products to hide or restore for a cap. Pure, so the ordering rules are unit tested. */
export function planProductChanges(input: {
  cap: number | null;
  /** Live products, newest first. */
  activeNewestFirst: string[];
  /** Plan-hidden drafts, oldest first. */
  hiddenOldestFirst: string[];
}): PlanProductSyncResult {
  const { cap, activeNewestFirst, hiddenOldestFirst } = input;
  if (cap !== null && activeNewestFirst.length > cap) {
    return { hidden: activeNewestFirst.slice(0, activeNewestFirst.length - cap), restored: [] };
  }
  const room = cap === null ? hiddenOldestFirst.length : cap - activeNewestFirst.length;
  return { hidden: [], restored: hiddenOldestFirst.slice(0, Math.max(0, room)) };
}

function noticeFor(change: PlanProductSyncResult, planLabel: string | null): { title: string; body: string } | null {
  if (change.hidden.length > 0) {
    const n = change.hidden.length;
    return {
      title: `${n} product${n === 1 ? "" : "s"} moved to drafts`,
      body: planLabel
        ? `${planLabel} lists fewer products, so your newest ${n === 1 ? "listing was" : `${n} listings were`} moved to drafts. Nothing was deleted. Upgrade to bring ${n === 1 ? "it" : "them"} back.`
        : `Your plan ended, so your listings were moved to drafts. Nothing was deleted. Pick a plan to keep selling.`,
    };
  }
  if (change.restored.length > 0) {
    const n = change.restored.length;
    return {
      title: `${n} product${n === 1 ? " is" : "s are"} live again`,
      body: `Your plan has room again, so ${n === 1 ? "a listing" : `${n} listings`} moved to drafts earlier ${n === 1 ? "is" : "are"} back on your shop.`,
    };
  }
  return null;
}

/** Brings the seller's live listings in line with their current plan. Idempotent. */
export async function syncProductsToPlan(ownerId: string, now = new Date()): Promise<PlanProductSyncResult> {
  const access = await getVerifiedPlanAccess(ownerId);
  const cap = access.limits.products;

  const change = await db.transaction(async (tx) => {
    // Same lock as publishing (lib/productCapacity.ts), so a publish can't
    // race the sync past the cap.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"product-limit:" + ownerId}))`);
    const active = await tx.select({ id: products.id }).from(products)
      .where(activeProductsWhere(ownerId))
      .orderBy(desc(products.createdAt), desc(products.id));
    const hidden = await tx.select({ id: products.id }).from(products)
      .where(and(
        eq(products.ownerId, ownerId),
        isNotNull(products.planHiddenAt),
        eq(products.status, "draft"),
        isNull(products.deletedAt),
      ))
      .orderBy(asc(products.createdAt), asc(products.id));
    const next = planProductChanges({
      cap,
      activeNewestFirst: active.map((row) => row.id),
      hiddenOldestFirst: hidden.map((row) => row.id),
    });
    if (next.hidden.length > 0) {
      await tx.update(products).set({ status: "draft", planHiddenAt: now, updatedAt: now })
        .where(and(inArray(products.id, next.hidden), eq(products.status, "active")));
    }
    if (next.restored.length > 0) {
      await tx.update(products).set({ status: "active", planHiddenAt: null, updatedAt: now })
        .where(and(inArray(products.id, next.restored), isNotNull(products.planHiddenAt)));
    }
    return next;
  });

  const notice = noticeFor(change, access.paid ? PLAN_CATALOGUE[access.planId].label : null);
  if (notice) {
    logger.info({ ownerId, hidden: change.hidden.length, restored: change.restored.length, cap }, "Synced products to plan");
    try {
      const { publishNotification } = await import("../routes/notifications-feed");
      await publishNotification({
        userId: ownerId,
        category: "system",
        type: change.hidden.length > 0 ? "plan_products_hidden" : "plan_products_restored",
        title: notice.title,
        body: notice.body,
        targetType: "subscription",
        cta: change.hidden.length > 0 ? (access.paid ? "Upgrade" : "Pick a plan") : "View products",
      });
    } catch (err) {
      logger.warn({ err, ownerId }, "Plan product notice failed");
    }
  }
  return change;
}

/** Fire-and-forget form for webhook handlers: a failure is logged and the hourly sweep retries. */
export function syncProductsToPlanSoon(ownerId: string | null | undefined): void {
  if (!ownerId) return;
  void syncProductsToPlan(ownerId).catch((err) => {
    logger.error({ err, ownerId }, "Plan product sync failed; the hourly sweep will retry");
  });
}
