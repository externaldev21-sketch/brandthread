/**
 * Downgrade / upgrade (Dev's plan-tier spec) on real Postgres: live
 * listings over the new cap move to drafts newest-first, never deleted, with
 * a notice; the seller's own drafts are never touched; upgrading restores
 * the hidden ones oldest-first; a lapsed plan hides everything and
 * re-subscribing brings it back.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, products, users } from "@workspace/db";

const published = vi.hoisted(() => [] as Array<{ userId: string; type: string; title: string; body?: string }>);
vi.mock("../../routes/notifications-feed", () => ({
  publishNotification: async (n: { userId: string; type: string; title: string; body?: string }) => { published.push(n); },
}));

import { planProductChanges, syncProductsToPlan } from "../planProductSync";
import { planProductSyncCandidates } from "../../jobs/planProductSync";

const suffix = crypto.randomBytes(5).toString("hex");
const sellers: string[] = [];

async function seller(tag: string, subscription: Partial<typeof users.$inferInsert>) {
  const clerkId = `plan-sync-${tag}-${suffix}`;
  sellers.push(clerkId);
  await db.insert(users).values({ clerkId, email: `${clerkId}@plan-sync.invalid`, name: tag, role: "seller", ...subscription });
  return clerkId;
}

async function listings(ownerId: string, count: number, status = "active") {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const [row] = await db.insert(products).values({
      ownerId, name: `${status} ${i}`, status, createdAt: new Date(Date.UTC(2026, 0, 1 + i)),
    }).returning({ id: products.id });
    ids.push(row.id);
  }
  return ids;
}

async function statusOf(ownerId: string) {
  return db.select({ id: products.id, status: products.status, planHiddenAt: products.planHiddenAt, deletedAt: products.deletedAt })
    .from(products).where(eq(products.ownerId, ownerId)).orderBy(asc(products.createdAt));
}

async function setPlan(clerkId: string, values: Partial<typeof users.$inferInsert>) {
  await db.update(users).set(values).where(eq(users.clerkId, clerkId));
}

afterAll(async () => {
  await db.delete(products).where(inArray(products.ownerId, sellers));
  await db.delete(users).where(inArray(users.clerkId, sellers));
});

describe("planProductChanges", () => {
  it("hides the newest over the cap and restores the oldest hidden into free room", () => {
    expect(planProductChanges({ cap: 2, activeNewestFirst: ["e", "d", "c", "b", "a"], hiddenOldestFirst: [] }))
      .toEqual({ hidden: ["e", "d", "c"], restored: [] });
    expect(planProductChanges({ cap: 4, activeNewestFirst: ["b", "a"], hiddenOldestFirst: ["c", "d", "e"] }))
      .toEqual({ hidden: [], restored: ["c", "d"] });
    expect(planProductChanges({ cap: null, activeNewestFirst: ["a"], hiddenOldestFirst: ["b", "c"] }))
      .toEqual({ hidden: [], restored: ["b", "c"] });
    expect(planProductChanges({ cap: 0, activeNewestFirst: ["b", "a"], hiddenOldestFirst: [] }))
      .toEqual({ hidden: ["b", "a"], restored: [] });
  });
});

describe("syncProductsToPlan", () => {
  it("Growth → Starter hides the newest listings over 10, keeps drafts, deletes nothing, and says so", async () => {
    const id = await seller("down", { subscriptionStatus: "active", subscriptionPlanId: "growth" });
    const live = await listings(id, 12);
    const [ownDraft] = await listings(id, 1, "draft");
    expect((await syncProductsToPlan(id)).hidden).toEqual([]);

    await setPlan(id, { subscriptionPlanId: "starter" });
    const change = await syncProductsToPlan(id);
    expect(change.hidden.sort()).toEqual(live.slice(10).sort());

    const rows = await statusOf(id);
    expect(rows.filter((r) => r.status === "active").map((r) => r.id).sort()).toEqual(live.slice(0, 10).sort());
    expect(rows.every((r) => r.deletedAt === null)).toBe(true);
    expect(rows.find((r) => r.id === ownDraft)).toMatchObject({ status: "draft", planHiddenAt: null });
    expect(published.find((n) => n.userId === id)).toMatchObject({
      type: "plan_products_hidden", title: "2 products moved to drafts",
    });

    // Idempotent: nothing more to do.
    expect(await syncProductsToPlan(id)).toEqual({ hidden: [], restored: [] });

    // Re-upgrade brings the hidden ones back, and only those.
    await setPlan(id, { subscriptionPlanId: "growth" });
    const back = await syncProductsToPlan(id);
    expect(back.restored.sort()).toEqual(live.slice(10).sort());
    const after = await statusOf(id);
    expect(after.filter((r) => r.status === "active")).toHaveLength(12);
    expect(after.find((r) => r.id === ownDraft)?.status).toBe("draft");
    expect(published.filter((n) => n.userId === id).map((n) => n.type)).toContain("plan_products_restored");
  });

  it("a lapsed plan moves every listing to drafts; re-subscribing restores them", async () => {
    const id = await seller("lapse", { subscriptionStatus: "active", subscriptionPlanId: "starter" });
    const live = await listings(id, 3);
    await setPlan(id, { subscriptionStatus: "canceled" });
    expect((await syncProductsToPlan(id)).hidden.sort()).toEqual([...live].sort());
    expect(published.filter((n) => n.userId === id).at(-1)?.body).toContain("Pick a plan to keep selling");
    expect(await planProductSyncCandidates(10_000)).toContain(id);

    await setPlan(id, { subscriptionStatus: "trialing" });
    expect((await syncProductsToPlan(id)).restored.sort()).toEqual([...live].sort());
  });

  it("a seller publishing a hidden product themselves takes it back from the sync", async () => {
    const id = await seller("manual", { subscriptionStatus: "active", subscriptionPlanId: "starter" });
    const [hidden] = await listings(id, 1, "draft");
    await db.update(products).set({ planHiddenAt: new Date() }).where(eq(products.id, hidden));
    // The seller archives it: no longer the plan's to restore.
    await db.update(products).set({ status: "archived", planHiddenAt: null }).where(eq(products.id, hidden));
    expect(await syncProductsToPlan(id)).toEqual({ hidden: [], restored: [] });
    const [row] = await db.select({ status: products.status }).from(products).where(and(eq(products.id, hidden)));
    expect(row.status).toBe("archived");
  });

  it("the sweep skips sellers on a live plan and App Review demo accounts", async () => {
    const paid = await seller("paid", { subscriptionStatus: "trialing", subscriptionPlanId: "growth" });
    const review = await seller("review", { isReviewAccount: true });
    await listings(paid, 1);
    await listings(review, 1);
    const candidates = await planProductSyncCandidates(10_000);
    expect(candidates).not.toContain(paid);
    expect(candidates).not.toContain(review);
  });
});
