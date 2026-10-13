import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { inArray } from "drizzle-orm";
import {
  blocks, db, drops, follows, notificationsFeed, posts, products, pushTokens, retentionPushLog, threadCashStreaks, users,
} from "@workspace/db";

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
const id = (n: string) => `wd-${sfx}-${n}`;
const ACME = id("acme");
const NORI = id("nori");
const QUIET = id("quiet");
const BLOCKER = id("blocker-seller");
const NY = id("ny");           // users.timezone New York → in window
const TOKYO = id("tokyo");     // users.timezone Tokyo → Monday morning, not in window
const FALLBACK = id("fallback"); // no timezone, quiet hours UTC → New York fallback
const STREAK = id("streak");   // Thread Cash streak timezone Tokyo → not in window
const NOTHING = id("nothing"); // follows only a seller with no activity → skipped
const NOOPT = id("noopt");     // not opted in to promotional pushes → skipped
const BLOCKED = id("blocked"); // follows only a seller they blocked → skipped
const sellers = [ACME, NORI, QUIET, BLOCKER];
const buyers = [NY, TOKYO, FALLBACK, STREAK, NOTHING, NOOPT, BLOCKED];
const all = [...sellers, ...buyers];

// Sunday 2026-10-18 18:30 in New York (EDT) = 22:30Z.
const SUNDAY = new Date("2026-10-18T22:30:00Z");
const daysBefore = (d: Date, days: number) => new Date(d.getTime() - days * 86_400_000);

beforeAll(async () => {
  await db.insert(users).values([
    ...[[ACME, "Acme Studio"], [NORI, "Nori"], [QUIET, "Quiet Co"], [BLOCKER, "Blocked Co"]].map(([clerkId, brandName]) => ({
      clerkId, email: `${clerkId}@test.local`, name: brandName, brandName, role: "seller", accountType: "seller",
    })),
    ...buyers.map((clerkId) => ({
      clerkId, email: `${clerkId}@test.local`, name: clerkId, role: "buyer", accountType: "buyer",
      promoPushOptIn: clerkId !== NOOPT,
      timezone: clerkId === TOKYO ? "Asia/Tokyo" : clerkId === FALLBACK || clerkId === STREAK ? null : "America/New_York",
    })),
  ]);
  await db.insert(threadCashStreaks).values({ buyerId: STREAK, timezone: "Asia/Tokyo" });
  await db.insert(pushTokens).values(buyers.map((u) => ({ userId: u, token: `ExponentPushToken[${u}]`, platform: "ios" })));
  await db.insert(follows).values([
    ...[NY, TOKYO, FALLBACK, STREAK, NOOPT].flatMap((u) => [{ followerId: u, followingId: ACME }, { followerId: u, followingId: NORI }]),
    { followerId: NY, followingId: QUIET },
    { followerId: NOTHING, followingId: QUIET },
    { followerId: BLOCKED, followingId: BLOCKER },
  ]);
  await db.insert(blocks).values({ blockerId: BLOCKED, blockedId: BLOCKER });

  const ago = (days: number) => daysBefore(SUNDAY, days);
  await db.insert(products).values([
    ...Array.from({ length: 3 }, (_, i) => ({ ownerId: ACME, name: `Acme ${i}`, status: "active", createdAt: ago(1 + i) })),
    { ownerId: ACME, name: "Acme draft", status: "draft", createdAt: ago(1) },
    { ownerId: ACME, name: "Acme old", status: "active", createdAt: ago(9) },
    { ownerId: NORI, name: "Nori 1", status: "active", createdAt: ago(2) },
    { ownerId: QUIET, name: "Quiet old", status: "active", createdAt: ago(20) },
    { ownerId: BLOCKER, name: "Blocker new", status: "active", createdAt: ago(1) },
  ]);
  await db.insert(posts).values([
    { userId: NORI, mediaUrl: "https://example.test/a.jpg", createdAt: ago(1) },
    { userId: NORI, mediaUrl: "https://example.test/b.jpg", createdAt: ago(3), postStatus: "draft" },
  ]);
  await db.insert(drops).values({ ownerId: ACME, name: "Fall drop", type: "pre-made", status: "active", releaseAt: ago(2) });
});

afterAll(async () => {
  await db.delete(notificationsFeed).where(inArray(notificationsFeed.userId, all));
  await db.delete(retentionPushLog).where(inArray(retentionPushLog.userId, all));
  await db.delete(pushTokens).where(inArray(pushTokens.userId, all));
  await db.delete(follows).where(inArray(follows.followerId, all));
  await db.delete(blocks).where(inArray(blocks.blockerId, all));
  await db.delete(threadCashStreaks).where(inArray(threadCashStreaks.buyerId, all));
  await db.delete(posts).where(inArray(posts.userId, all));
  await db.delete(drops).where(inArray(drops.ownerId, all));
  await db.delete(products).where(inArray(products.ownerId, all));
  await db.delete(users).where(inArray(users.clerkId, all));
});

const mine = () => sent.pushes.filter((p) => all.includes(p.userId));

describe("runWeeklyDigest", () => {
  it("sends once per local Sunday evening, only with activity, in the buyer's timezone", async () => {
    const { runWeeklyDigest } = await import("../weeklyDigest");
    await runWeeklyDigest(SUNDAY);
    await runWeeklyDigest(new Date(SUNDAY.getTime() + 10 * 60_000)); // next tick, same window
    await runWeeklyDigest(new Date(SUNDAY.getTime() + 20 * 60_000));

    const pushes = mine();
    expect(pushes.map((p) => p.userId).sort()).toEqual([FALLBACK, NY].sort());
    const ny = pushes.find((p) => p.userId === NY)!;
    expect(ny.title).toBe("This week from brands you follow");
    expect(ny.body).toBe("Acme Studio and Nori shared 4 new pieces, 1 drop and 1 post.");
    expect(ny.category).toBe("drop");
    expect(ny.data).toMatchObject({ type: "digest", targetType: "following_feed" });

    const log = await db.select().from(retentionPushLog).where(inArray(retentionPushLog.userId, all));
    expect(log.map((r) => `${r.userId}|${r.kind}|${r.periodKey}`).sort())
      .toEqual([`${FALLBACK}|weekly_digest|2026-W42`, `${NY}|weekly_digest|2026-W42`].sort());

    const feed = await db.select().from(notificationsFeed).where(inArray(notificationsFeed.userId, all));
    expect(feed.map((f) => [f.userId, f.type, f.category])).toEqual(expect.arrayContaining([[NY, "digest", "social"]]));
    expect(feed.filter((f) => f.type === "digest")).toHaveLength(2);
  });

  it("does nothing outside the window and sends to Tokyo buyers on their own Sunday", async () => {
    const { runWeeklyDigest } = await import("../weeklyDigest");
    const before = mine().length;
    await runWeeklyDigest(new Date("2026-10-18T21:30:00Z")); // 17:30 in New York
    expect(mine().length).toBe(before);

    // Sunday 18:30 in Tokyo (UTC+9) = 09:30Z the same Sunday.
    await runWeeklyDigest(new Date("2026-10-18T09:30:00Z"));
    expect(mine().slice(before).map((p) => p.userId).sort()).toEqual([STREAK, TOKYO].sort());
  });

  it("sends again the next week", async () => {
    const { runWeeklyDigest } = await import("../weeklyDigest");
    const nextSunday = new Date(SUNDAY.getTime() + 7 * 86_400_000);
    await db.insert(products).values({ ownerId: NORI, name: "Nori 2", status: "active", createdAt: daysBefore(nextSunday, 1) });
    const before = mine().length;
    await runWeeklyDigest(nextSunday);
    const fresh = mine().slice(before);
    expect(fresh.map((p) => p.userId).sort()).toEqual([FALLBACK, NY].sort());
    expect(fresh[0]!.body).toBe("Nori added 1 new piece.");
  });
});
