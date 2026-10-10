/**
 * Plan gate on real Postgres: a seller with no live trial or plan can't sell
 * (NO_PLAN_LIMITS); a trialing/active seller sells up to the plan's active
 * product cap; past_due keeps the plan only during the grace period; App
 * Review demo accounts keep full access.
 */
import { afterAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { inArray } from "drizzle-orm";
import { db, products, users } from "@workspace/db";
import { productsBeyondSellerPlan } from "../planGate";
import { getVerifiedPlanAccess, nextPlanFor } from "../planAccess";
import { NO_PLAN_LIMITS, PAST_DUE_GRACE_DAYS, PLAN_CATALOGUE } from "../planCatalogue";

const suffix = crypto.randomBytes(5).toString("hex");
const sellers: string[] = [];

async function seller(tag: string, subscription: Partial<typeof users.$inferInsert> = {}) {
  const clerkId = `plan-gate-${tag}-${suffix}`;
  sellers.push(clerkId);
  await db.insert(users).values({
    clerkId, email: `${clerkId}@plan-gate.invalid`, name: tag, role: "seller", ...subscription,
  });
  return clerkId;
}

async function listings(ownerId: string, count: number) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const [row] = await db.insert(products).values({
      ownerId, name: `Item ${i}`, status: "active", createdAt: new Date(Date.UTC(2026, 0, 1 + i)),
    }).returning({ id: products.id });
    rows.push(row.id);
  }
  return rows;
}

afterAll(async () => {
  await db.delete(products).where(inArray(products.ownerId, sellers));
  await db.delete(users).where(inArray(users.clerkId, sellers));
});

describe("plan gate", () => {
  it("a seller with no live trial or plan can't sell anything and needs Starter", async () => {
    const id = await seller("none");
    const ids = await listings(id, 2);
    const access = await getVerifiedPlanAccess(id);
    expect(access).toMatchObject({ paid: false, limits: NO_PLAN_LIMITS });
    expect(nextPlanFor(access)).toBe("starter");
    expect(await productsBeyondSellerPlan(id, ids)).toEqual(ids);
  });

  it("a trialing Starter seller sells their first 10 live listings; the newest over the cap waits", async () => {
    const id = await seller("trial", { subscriptionStatus: "trialing", subscriptionPlanId: "starter" });
    const cap = PLAN_CATALOGUE.starter.limits.products!;
    const ids = await listings(id, cap + 1);
    expect(await getVerifiedPlanAccess(id)).toMatchObject({ paid: true, limits: PLAN_CATALOGUE.starter.limits });
    expect(await productsBeyondSellerPlan(id, ids)).toEqual([ids[ids.length - 1]]);
  });

  it("past_due keeps the plan during the grace period, then selling stops", async () => {
    const day = 24 * 60 * 60 * 1000;
    const inGrace = await seller("grace", {
      subscriptionStatus: "past_due", subscriptionPlanId: "growth",
      subscriptionPastDueSince: new Date(Date.now() - (PAST_DUE_GRACE_DAYS - 1) * day),
    });
    const lapsed = await seller("lapsed", {
      subscriptionStatus: "past_due", subscriptionPlanId: "growth",
      subscriptionPastDueSince: new Date(Date.now() - (PAST_DUE_GRACE_DAYS + 1) * day),
    });
    expect(await getVerifiedPlanAccess(inGrace)).toMatchObject({ paid: true, planId: "growth" });
    expect(await getVerifiedPlanAccess(lapsed)).toMatchObject({ paid: false, limits: NO_PLAN_LIMITS });
  });

  it("App Review demo accounts keep full seller access without a purchase", async () => {
    const id = await seller("review", { isReviewAccount: true });
    expect(await getVerifiedPlanAccess(id)).toMatchObject({ paid: true, planId: "pro" });
  });
});
