/**
 * BT-002: a seller without paid access sells and publishes within the free
 * limits (planCatalogue FREE_TIER_LIMITS); a trialing/active seller gets the
 * plan's limits; past_due keeps the plan only during the grace period.
 */
import { afterAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { inArray } from "drizzle-orm";
import { db, products, users } from "@workspace/db";
import { productsBeyondSellerPlan } from "../planGate";
import { getVerifiedPlanAccess, nextPlanFor } from "../planAccess";
import { FREE_TIER_LIMITS, PAST_DUE_GRACE_DAYS, PLAN_CATALOGUE } from "../planCatalogue";

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

describe("free tier (BT-002)", () => {
  it("an unpaid seller gets the free limits and needs Starter next", async () => {
    const id = await seller("free");
    const access = await getVerifiedPlanAccess(id);
    expect(access).toMatchObject({ paid: false, limits: FREE_TIER_LIMITS });
    expect(nextPlanFor(access)).toBe("starter");
  });

  it("only the first free-limit listings can be bought; the newest wait for a plan", async () => {
    const id = await seller("over");
    const ids = await listings(id, FREE_TIER_LIMITS.products! + 1);
    const newest = ids[ids.length - 1];
    expect(await productsBeyondSellerPlan(id, ids)).toEqual([newest]);
    expect(await productsBeyondSellerPlan(id, ids.slice(0, 2))).toEqual([]);
  });

  it("a trialing seller sells everything Starter includes", async () => {
    const id = await seller("trial", { subscriptionStatus: "trialing", subscriptionPlanId: "starter" });
    const ids = await listings(id, FREE_TIER_LIMITS.products! + 1);
    const access = await getVerifiedPlanAccess(id);
    expect(access).toMatchObject({ paid: true, limits: PLAN_CATALOGUE.starter.limits });
    expect(await productsBeyondSellerPlan(id, ids)).toEqual([]);
  });

  it("past_due keeps the plan during the grace period, then drops to the free limits", async () => {
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
    expect(await getVerifiedPlanAccess(lapsed)).toMatchObject({ paid: false, limits: FREE_TIER_LIMITS });
  });
});
