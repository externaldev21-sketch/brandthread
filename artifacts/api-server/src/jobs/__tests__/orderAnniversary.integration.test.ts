import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { inArray } from "drizzle-orm";
import { blocks, db, notificationsFeed, orderItems, orders, pushTokens, retentionPushLog, users } from "@workspace/db";

const sent = vi.hoisted(() => ({ pushes: [] as Array<{ userId: string; category?: string; title: string; body: string; data: Record<string, unknown> }> }));

vi.mock("../../lib/push", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/push")>();
  return {
    ...actual,
    sendPushToUser: async (userId: string, payload: { title: string; body: string; data?: Record<string, unknown> }, category?: string) => {
      sent.pushes.push({ userId, category, title: payload.title, body: payload.body, data: payload.data ?? {} });
      return true;
    },
  };
});

const sfx = crypto.randomBytes(5).toString("hex");
const id = (n: string) => `oa-${sfx}-${n}`;
const ACME = id("acme");
const NORI = id("nori");
const GONE = id("gone");       // deleted seller
const BLOCKER = id("blocker"); // seller the buyer blocked
const TWO = id("two");         // two anniversaries today → one push
const REFUNDED = id("refunded");
const CANCELLED = id("cancelled");
const UNDELIVERED = id("undelivered");
const GONEBUYER = id("gone-buyer");
const BLOCKBUYER = id("block-buyer");
const sellers = [ACME, NORI, GONE, BLOCKER];
const buyers = [TWO, REFUNDED, CANCELLED, UNDELIVERED, GONEBUYER, BLOCKBUYER];
const all = [...sellers, ...buyers];

// 2026-10-13 11:30 in New York (EDT) = 15:30Z. One year earlier, local date 2025-10-13.
const NOW = new Date("2026-10-13T15:30:00Z");
const PAID = new Date("2025-10-13T20:00:00Z");
let n = 0;

async function order(buyerId: string, ownerId: string, product: string, extra: Partial<typeof orders.$inferInsert> = {}) {
  const [row] = await db.insert(orders).values({
    buyerId, ownerId, orderNumber: `OA-${sfx}-${++n}`, totalCents: 5000, subtotalCents: 5000,
    status: "delivered", paidAt: PAID, deliveredAt: new Date(PAID.getTime() + 4 * 86_400_000), ...extra,
  }).returning({ id: orders.id });
  await db.insert(orderItems).values({ orderId: row!.id, productName: product, quantity: 1, priceCents: 5000 });
  return row!.id;
}

beforeAll(async () => {
  await db.insert(users).values([
    ...[[ACME, "Acme Studio"], [NORI, "Nori"], [GONE, "Gone Co"], [BLOCKER, "Blocked Co"]].map(([clerkId, brandName]) => ({
      clerkId, email: `${clerkId}@test.local`, name: brandName, brandName, role: "seller", accountType: "seller",
      deletedAt: clerkId === GONE ? new Date() : null,
    })),
    ...buyers.map((clerkId) => ({
      clerkId, email: `${clerkId}@test.local`, name: clerkId, role: "buyer", accountType: "buyer",
      promoPushOptIn: true, timezone: "America/New_York",
    })),
  ]);
  await db.insert(pushTokens).values(buyers.map((u) => ({ userId: u, token: `ExponentPushToken[${u}]`, platform: "ios" })));
  await db.insert(blocks).values({ blockerId: BLOCKBUYER, blockedId: BLOCKER });

  await order(TWO, ACME, "Wool Overshirt", { paidAt: new Date(PAID.getTime() - 3600_000) });
  await order(TWO, NORI, "Linen Cap");
  await order(REFUNDED, ACME, "Refunded Tee", { refundedCents: 5000, status: "refunded" });
  await order(CANCELLED, ACME, "Cancelled Tee", { status: "cancelled" });
  await order(UNDELIVERED, ACME, "Lost Tee", { status: "shipped", deliveredAt: null });
  await order(GONEBUYER, GONE, "Gone Tee");
  await order(BLOCKBUYER, BLOCKER, "Blocked Tee");
});

afterAll(async () => {
  await db.delete(notificationsFeed).where(inArray(notificationsFeed.userId, all));
  await db.delete(retentionPushLog).where(inArray(retentionPushLog.userId, all));
  await db.delete(pushTokens).where(inArray(pushTokens.userId, all));
  await db.delete(blocks).where(inArray(blocks.blockerId, all));
  await db.delete(orders).where(inArray(orders.buyerId, all)); // order_items cascade
  await db.delete(users).where(inArray(users.clerkId, all));
});

const mine = () => sent.pushes.filter((p) => all.includes(p.userId));

describe("runOrderAnniversaries", () => {
  it("sends one push per buyer per day, once, and skips refunded / cancelled / undelivered / gone / blocked", async () => {
    const { runOrderAnniversaries } = await import("../orderAnniversary");
    await runOrderAnniversaries(NOW);
    await runOrderAnniversaries(new Date(NOW.getTime() + 10 * 60_000));

    const pushes = mine();
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({
      userId: TWO,
      category: "drop",
      title: "One year ago today",
      body: "You got Wool Overshirt from Acme Studio. See what's new from Acme Studio.",
    });
    expect(pushes[0]!.data).toMatchObject({ type: "order_anniversary", targetType: "user", targetId: ACME });

    const log = await db.select().from(retentionPushLog).where(inArray(retentionPushLog.userId, all));
    expect(log.map((r) => r.kind).sort()).toEqual(["order_anniversary", "order_anniversary_day"]);
    expect(log.find((r) => r.kind === "order_anniversary_day")!.periodKey).toBe("2026-10-13");
    expect(log.find((r) => r.kind === "order_anniversary")!.periodKey).toMatch(/:2026$/);

    const feed = await db.select().from(notificationsFeed).where(inArray(notificationsFeed.userId, all));
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ type: "order_anniversary", category: "social", actorId: ACME, actorName: "Acme Studio" });
  });

  it("stays quiet outside 11:00 local and on other days", async () => {
    const { runOrderAnniversaries } = await import("../orderAnniversary");
    const before = mine().length;
    await runOrderAnniversaries(new Date("2026-10-13T14:30:00Z")); // 10:30 local
    await runOrderAnniversaries(new Date("2026-10-14T15:30:00Z")); // next day 11:30
    expect(mine().length).toBe(before);
  });
});
