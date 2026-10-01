import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { inArray } from "drizzle-orm";
import { blocks, db, follows, notificationsFeed, users } from "@workspace/db";

const pushes = vi.hoisted(() => ({ calls: [] as Array<{ userId: string; category?: string; data?: any }> }));

vi.mock("../../lib/push", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/push")>();
  return {
    ...actual,
    sendPushToUser: async (userId: string, payload: any, category?: string) => {
      pushes.calls.push({ userId, category, data: payload.data });
      return true;
    },
  };
});

const suffix = crypto.randomBytes(6).toString("hex");
const seller = `live-seller-${suffix}`;
const fan = `live-fan-${suffix}`;
const blockedFan = `live-blocked-${suffix}`;
const quietFan = `live-inapp-off-${suffix}`;
const all = [seller, fan, blockedFan, quietFan];
const streamId = crypto.randomUUID();

beforeAll(async () => {
  await db.insert(users).values(all.map((clerkId) => ({
    clerkId, email: `${clerkId}@test.local`, name: clerkId, role: "buyer", accountType: clerkId === seller ? "seller" : "buyer",
    brandName: clerkId === seller ? "Live Brand" : null,
    notificationPreferences: clerkId === quietFan ? { "inapp:new_drops": false } : undefined,
  })));
  await db.insert(follows).values([fan, blockedFan, quietFan].map((followerId) => ({ followerId, followingId: seller })));
  await db.insert(blocks).values({ blockerId: blockedFan, blockedId: seller });
});

afterAll(async () => {
  await db.delete(notificationsFeed).where(inArray(notificationsFeed.userId, all));
  await db.delete(blocks).where(inArray(blocks.blockerId, all));
  await db.delete(follows).where(inArray(follows.followingId, [seller]));
  await db.delete(users).where(inArray(users.clerkId, all));
});

describe("notifyFollowersLiveStarted", () => {
  it("alerts followers once, skips blocked pairs, and honours the in-app switch", async () => {
    const { notifyFollowersLiveStarted } = await import("../../lib/liveNotifications");
    const first = await notifyFollowersLiveStarted({ streamId, sellerId: seller, title: "Fall drop preview" });
    await notifyFollowersLiveStarted({ streamId, sellerId: seller, title: "Fall drop preview" });
    expect(first.followers).toBe(2);

    const rows = await db.select().from(notificationsFeed).where(inArray(notificationsFeed.userId, all));
    expect(rows.map((r) => r.userId)).toEqual([fan]);
    expect(rows[0]).toMatchObject({ type: "live_started", title: "Live Brand is live", body: "Fall drop preview", targetType: "live", targetId: streamId });

    const pushed = new Set(pushes.calls.map((c) => c.userId));
    expect(pushed.has(fan)).toBe(true);
    expect(pushed.has(quietFan)).toBe(true);
    expect(pushed.has(blockedFan)).toBe(false);
    expect(pushes.calls.every((c) => c.category === "live")).toBe(true);
    // the duplicate run must not push the same fan twice
    expect(pushes.calls.filter((c) => c.userId === fan)).toHaveLength(1);
  });
});
