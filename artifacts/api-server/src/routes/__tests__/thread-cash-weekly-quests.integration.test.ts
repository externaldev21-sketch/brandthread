/**
 * Weekly quests: server-side progress counting, claim gating, idempotent
 * (and concurrent) claims, the freeze kill switch, the week streak and the
 * buyer-only guard — through the real /api/thread-cash router.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { eq, inArray, or } from "drizzle-orm";
import {
  db, follows, savedItems, threadCashEntries, threadCashHeartbeats, threadCashStreaks, users,
} from "@workspace/db";
import { getWeeklyQuestsStatus } from "../../lib/threadCash/weeklyQuests";
import { addDays, previousWeekKey, weekWindow } from "../../lib/threadCash/weeklyQuestsWeek";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = req.headers["x-test-user"];
    next();
  },
}));

const suffix = crypto.randomBytes(5).toString("hex");
const id = (name: string) => `wq-${name}-${suffix}`;
const brands = [id("brand-a"), id("brand-b"), id("brand-c")];
const plainBuyer = id("other-buyer");
const sellerOnly = id("seller-only");
const createdUsers: string[] = [...brands, plainBuyer, sellerOnly];
const buyers: string[] = [];
let server: Server;
let base = "";

async function call(method: string, path: string, userId: string) {
  const res = await fetch(`${base}/api/thread-cash${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-user": userId },
  });
  return { status: res.status, body: (await res.json()) as any };
}

async function newBuyer(name: string): Promise<string> {
  const buyerId = id(`${name}-${crypto.randomBytes(3).toString("hex")}`);
  buyers.push(buyerId);
  createdUsers.push(buyerId);
  await db.insert(users).values({ clerkId: buyerId, email: `${buyerId}@example.com`, name: buyerId, accountType: "buyer" });
  return buyerId;
}

/** Heartbeats on 3 local dates of the current (UTC) week, 3 saves and 2 brand follows now. */
async function completeAllQuests(buyerId: string) {
  const week = weekWindow(new Date(), "UTC");
  await db.insert(threadCashHeartbeats).values([0, 1, 2].map((d) => ({
    buyerId, localDate: addDays(week.startDate, d), heartbeatCount: 3,
  })));
  await db.insert(savedItems).values([1, 2, 3].map((n) => ({ userId: buyerId, itemType: "product", targetId: `${buyerId}-p${n}` })));
  await db.insert(follows).values(brands.slice(0, 2).map((followingId) => ({ followerId: buyerId, followingId })));
}

async function entries(buyerId: string) {
  return db.select().from(threadCashEntries).where(eq(threadCashEntries.buyerId, buyerId));
}

beforeAll(async () => {
  for (const clerkId of brands) {
    await db.insert(users).values({ clerkId, email: `${clerkId}@example.com`, name: clerkId, accountType: "seller" });
  }
  await db.insert(users).values({ clerkId: plainBuyer, email: `${plainBuyer}@example.com`, name: plainBuyer, accountType: "buyer" });
  await db.insert(users).values({ clerkId: sellerOnly, email: `${sellerOnly}@example.com`, name: sellerOnly, accountType: "seller" });
  const { default: router } = await import("../thread-cash");
  const app = express();
  app.use(express.json());
  app.use("/api/thread-cash", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (buyers.length) {
    await db.delete(threadCashEntries).where(inArray(threadCashEntries.buyerId, buyers));
    await db.delete(threadCashHeartbeats).where(inArray(threadCashHeartbeats.buyerId, buyers));
    await db.delete(threadCashStreaks).where(inArray(threadCashStreaks.buyerId, buyers));
    await db.delete(savedItems).where(inArray(savedItems.userId, buyers));
    await db.delete(follows).where(or(inArray(follows.followerId, buyers), inArray(follows.followingId, buyers)));
  }
  await db.delete(users).where(inArray(users.clerkId, createdUsers));
});

describe("GET /weekly-quests progress", () => {
  it("starts at zero with the reward, week key and end time", async () => {
    const buyerId = await newBuyer("fresh");
    const { status, body } = await call("GET", "/weekly-quests", buyerId);
    expect(status).toBe(200);
    const week = weekWindow(new Date(), "UTC");
    expect(body.weekKey).toBe(week.weekKey);
    expect(body.endsAt).toBe(week.endsAt.toISOString());
    expect(body.rewardCents).toBe(50);
    expect(body.claimed).toBe(false);
    expect(body.weekStreak).toBe(0);
    expect(body.quests).toEqual([
      { id: "open_days", title: "Open Brandthread on 3 days", progress: 0, target: 3 },
      { id: "save_products", title: "Save 3 pieces", progress: 0, target: 3 },
      { id: "follow_brands", title: "Follow 2 brands", progress: 0, target: 2 },
    ]);
  });

  it("counts only this week's server-recorded activity", async () => {
    const buyerId = await newBuyer("counts");
    const week = weekWindow(new Date(), "UTC");
    const lastWeek = new Date(week.startsAt.getTime() - 3_600_000);
    // Open days: a check-in award and a heartbeat on the same date count once;
    // a heartbeat row with zero beats and last week's date don't count.
    await db.insert(threadCashEntries).values({
      buyerId, amountCents: 10, source: "daily_checkin", referenceId: week.startDate,
    });
    await db.insert(threadCashHeartbeats).values([
      { buyerId, localDate: week.startDate, heartbeatCount: 4 },
      { buyerId, localDate: addDays(week.startDate, 1), heartbeatCount: 0 },
      { buyerId, localDate: addDays(week.startDate, -1), heartbeatCount: 9 },
    ]);
    // Saves: two products now, one saved last week, one non-product.
    await db.insert(savedItems).values([
      { userId: buyerId, itemType: "product", targetId: `${buyerId}-p1` },
      { userId: buyerId, itemType: "product", targetId: `${buyerId}-p2` },
      { userId: buyerId, itemType: "product", targetId: `${buyerId}-old`, createdAt: lastWeek },
      { userId: buyerId, itemType: "post", targetId: `${buyerId}-post` },
    ]);
    // Follows: one brand now, one brand last week, one buyer account now.
    await db.insert(follows).values([
      { followerId: buyerId, followingId: brands[0] },
      { followerId: buyerId, followingId: brands[1], createdAt: lastWeek },
      { followerId: buyerId, followingId: plainBuyer },
    ]);

    const { body } = await call("GET", "/weekly-quests", buyerId);
    const progress = Object.fromEntries(body.quests.map((q: any) => [q.id, q.progress]));
    expect(progress).toEqual({ open_days: 1, save_products: 2, follow_brands: 1 });

    // Unsaving removes the row, so it stops counting.
    await db.delete(savedItems).where(eq(savedItems.targetId, `${buyerId}-p2`));
    const after = await call("GET", "/weekly-quests", buyerId);
    expect(after.body.quests[1].progress).toBe(1);
  });

  it("caps progress at the target", async () => {
    const buyerId = await newBuyer("cap");
    await completeAllQuests(buyerId);
    await db.insert(savedItems).values({ userId: buyerId, itemType: "product", targetId: `${buyerId}-p4` });
    await db.insert(follows).values({ followerId: buyerId, followingId: brands[2] });
    const { body } = await call("GET", "/weekly-quests", buyerId);
    expect(body.quests.map((q: any) => q.progress)).toEqual([3, 3, 2]);
  });

  it("uses the buyer's timezone from their streak row for the week", async () => {
    const buyerId = await newBuyer("tz");
    await db.insert(threadCashStreaks).values({ buyerId, timezone: "America/New_York" });
    // Monday 02:00 UTC is still Sunday in New York: last ISO week there.
    const now = new Date("2026-10-19T02:00:00Z");
    await db.insert(threadCashHeartbeats).values([
      { buyerId, localDate: "2026-10-18", heartbeatCount: 2 },
      { buyerId, localDate: "2026-10-19", heartbeatCount: 2 },
    ]);
    const status = await getWeeklyQuestsStatus(buyerId, now);
    expect(status.weekKey).toBe("2026-W42");
    expect(status.endsAt).toBe("2026-10-19T04:00:00.000Z");
    expect(status.quests[0].progress).toBe(1);
  });
});

describe("POST /weekly-quests/claim", () => {
  it("refuses until every quest is complete", async () => {
    const buyerId = await newBuyer("incomplete");
    const week = weekWindow(new Date(), "UTC");
    await db.insert(threadCashHeartbeats).values([0, 1, 2].map((d) => ({ buyerId, localDate: addDays(week.startDate, d), heartbeatCount: 1 })));
    const res = await call("POST", "/weekly-quests/claim", buyerId);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("WEEKLY_QUESTS_INCOMPLETE");
    expect(await entries(buyerId)).toHaveLength(0);
  });

  it("pays once, and a repeat claim is a no-op that returns the same balance", async () => {
    const buyerId = await newBuyer("claim");
    await completeAllQuests(buyerId);
    const first = await call("POST", "/weekly-quests/claim", buyerId);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ ok: true, created: true, amountCents: 50, balanceCents: 50, claimed: true, weekStreak: 1 });
    const second = await call("POST", "/weekly-quests/claim", buyerId);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ created: false, amountCents: 0, balanceCents: 50, claimed: true });
    const rows = await entries(buyerId);
    expect(rows).toHaveLength(1);
    const week = weekWindow(new Date(), "UTC");
    expect(rows[0]).toMatchObject({
      source: "weekly_quests", amountCents: 50, referenceId: week.weekKey,
      idempotencyKey: `weekly_quests:${buyerId}:${week.weekKey}`,
    });
    const status = await call("GET", "/weekly-quests", buyerId);
    expect(status.body.claimed).toBe(true);
  });

  it("pays exactly once under concurrent claims", async () => {
    const buyerId = await newBuyer("race");
    await completeAllQuests(buyerId);
    const results = await Promise.all(Array.from({ length: 6 }, () => call("POST", "/weekly-quests/claim", buyerId)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.created)).toHaveLength(1);
    expect(await entries(buyerId)).toHaveLength(1);
    expect(results.map((r) => r.body.balanceCents).every((b) => b === 50 || b === 0)).toBe(true);
    const final = await call("POST", "/weekly-quests/claim", buyerId);
    expect(final.body.balanceCents).toBe(50);
  });

  it("refuses a frozen account and credits nothing", async () => {
    const buyerId = await newBuyer("frozen");
    await completeAllQuests(buyerId);
    await db.insert(threadCashStreaks).values({ buyerId, timezone: "UTC", frozen: true, frozenReason: "Under review." });
    const res = await call("POST", "/weekly-quests/claim", buyerId);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("THREAD_CASH_ACCOUNT_FROZEN");
    expect(await entries(buyerId)).toHaveLength(0);
  });

  it("counts consecutive claimed weeks in the week streak", async () => {
    const buyerId = await newBuyer("streak");
    const current = weekWindow(new Date(), "UTC").weekKey;
    const last = previousWeekKey(current);
    const twoAgo = previousWeekKey(last);
    const fourAgo = previousWeekKey(previousWeekKey(twoAgo));
    await db.insert(threadCashEntries).values([last, twoAgo, fourAgo].map((weekKey) => ({
      buyerId, amountCents: 50, source: "weekly_quests", referenceId: weekKey,
      idempotencyKey: `weekly_quests:${buyerId}:${weekKey}`,
    })));
    // Unclaimed current week: last week's run of 2 is still alive.
    expect((await call("GET", "/weekly-quests", buyerId)).body.weekStreak).toBe(2);
    await completeAllQuests(buyerId);
    const claim = await call("POST", "/weekly-quests/claim", buyerId);
    expect(claim.body.weekStreak).toBe(3);
    expect(claim.body.balanceCents).toBe(200);
  });

  it("is buyer-only", async () => {
    expect((await call("GET", "/weekly-quests", sellerOnly)).status).toBe(403);
    const res = await call("POST", "/weekly-quests/claim", sellerOnly);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("WEEKLY_QUESTS_BUYER_ONLY");
  });
});
