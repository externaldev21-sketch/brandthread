/**
 * Audit dead-ends 74, 86–92, end to end against Postgres:
 *  - Friends feed reports savedByMe and drops "Not interested" posts; the
 *    hide is listable and undoable (GET/DELETE /api/feed/not-interested).
 *  - Undoing a repost with value "remove" really removes it.
 *  - Notifications: mute a category (feed + push), clear read deletes only
 *    read rows, mark unread persists.
 *  - Order "Report a problem" is persisted, mirrored to support, notifies
 *    the seller, and is visible to that order's buyer and seller only.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  activityMutes, db, feedNotInterested, follows, interactions, notificationsFeed, orderProblemReports, orders,
  postUserTags, posts, savedItems, users,
} from "@workspace/db";

const pushes = vi.hoisted(() => ({ sent: [] as Array<{ userId: string; category?: string }> }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = req.header("x-test-user-id");
    next();
  },
  requireModerator: (_req: any, res: any) => res.status(403).json({ error: "Not a moderator" }),
}));
vi.mock("../../middlewares/rateLimit", () => ({ rateLimit: () => (_q: any, _r: any, next: () => void) => next() }));

const suffix = crypto.randomBytes(6).toString("hex");
const id = (n: string) => `de-${n}-${suffix}`;
const me = id("me");
const friend = id("friend");
const seller = id("seller");
const stranger = id("stranger");
const userIds = [me, friend, seller, stranger];

let server: Server;
let base = "";
let friendPostA = "";
let friendPostB = "";
let orderId = "";

async function call(method: string, path: string, userId: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-user-id": userId },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json().catch(() => null)) as any };
}

beforeAll(async () => {
  await db.insert(users).values(userIds.map((u) => ({
    clerkId: u, email: `${u}@t.local`, name: u, username: u.replace(/-/g, "_"),
    role: u === seller ? "seller" : "buyer", accountType: u === seller ? "seller" : "buyer",
  })));
  await db.insert(follows).values([
    { followerId: me, followingId: friend },
    { followerId: friend, followingId: me },
  ]);
  const inserted = await db.insert(posts).values([
    { userId: friend, mediaUrl: `https://cdn.test/${suffix}/a.jpg`, mediaType: "photo", caption: "A", postStatus: "published" },
    { userId: friend, mediaUrl: `https://cdn.test/${suffix}/b.jpg`, mediaType: "photo", caption: "B", postStatus: "published" },
  ]).returning({ id: posts.id });
  [friendPostA, friendPostB] = inserted.map((row) => row.id);
  const [order] = await db.insert(orders).values({
    ownerId: seller, buyerId: me, orderNumber: `DE-${suffix}`, status: "delivered", totalCents: 1000, subtotalCents: 1000,
  } as any).returning({ id: orders.id });
  orderId = order.id;

  // Push delivery is observed at sendPushToUser's outer edge: we only spy on
  // the network send, so the preference/mute checks inside still run.
  const push = await import("../../lib/push");
  vi.spyOn(push, "sendPushToUser");

  const [{ default: social }, { default: feed }, { default: postsRouter }, { default: notifs }, { default: problems }] =
    await Promise.all([
      import("../social"), import("../feed"), import("../posts"), import("../notifications-feed"), import("../order-problems"),
    ]);
  const app = express();
  app.use(express.json());
  // Optional-auth routes (GET /api/posts/:id) read the viewer without requireAuth.
  app.use((req: any, _res, next) => { req.clerkUserId = req.header("x-test-user-id"); next(); });
  app.use("/api/social", social);
  app.use("/api/feed", feed);
  app.use("/api/posts", postsRouter);
  app.use("/api/buyer/notifications", notifs);
  app.use("/api/order-problems", problems);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server?.close();
  await db.delete(orderProblemReports).where(inArray(orderProblemReports.buyerId, userIds));
  await db.delete(postUserTags).where(inArray(postUserTags.taggedUserId, userIds));
  await db.execute(sql`DELETE FROM support_tickets WHERE clerk_id = ANY(${userIds})`).catch(() => undefined);
  await db.delete(notificationsFeed).where(inArray(notificationsFeed.userId, userIds));
  await db.delete(activityMutes).where(inArray(activityMutes.userId, userIds));
  await db.delete(savedItems).where(inArray(savedItems.userId, userIds));
  await db.delete(feedNotInterested).where(inArray(feedNotInterested.userId, userIds));
  await db.delete(interactions).where(inArray(interactions.userId, userIds));
  if (orderId) await db.delete(orders).where(eq(orders.id, orderId));
  await db.delete(posts).where(inArray(posts.userId, userIds));
  await db.delete(follows).where(or(inArray(follows.followerId, userIds), inArray(follows.followingId, userIds)));
  await db.delete(users).where(inArray(users.clerkId, userIds));
});

describe("friends feed (86–89)", () => {
  it("86: reports savedByMe from saved_items so the bookmark survives a refresh", async () => {
    await db.insert(savedItems).values({ userId: me, itemType: "post", targetId: friendPostA, title: "A" });
    const feed = await call("GET", "/api/social/friends/activity", me);
    expect(feed.status).toBe(200);
    const byId = new Map((feed.body as any[]).map((p) => [p.id, p]));
    expect(byId.get(friendPostA)?.savedByMe).toBe(true);
    expect(byId.get(friendPostB)?.savedByMe).toBe(false);
  });

  it("87: value 'remove' undoes a repost", async () => {
    expect((await call("POST", `/api/posts/${friendPostA}/interact`, me, { type: "repost", value: "add" })).status).toBeLessThan(300);
    let feed = await call("GET", "/api/social/friends/activity", me);
    expect((feed.body as any[]).find((p) => p.id === friendPostA)?.repostedByMe).toBe(true);
    expect((await call("POST", `/api/posts/${friendPostA}/interact`, me, { type: "repost", value: "remove" })).status).toBeLessThan(300);
    feed = await call("GET", "/api/social/friends/activity", me);
    expect((feed.body as any[]).find((p) => p.id === friendPostA)?.repostedByMe).toBe(false);
  });

  it("88/89: Not interested hides the post from the friends feed until undone", async () => {
    expect((await call("POST", `/api/posts/${friendPostB}/interact`, me, { type: "not_interested" })).status).toBeLessThan(300);
    let feed = await call("GET", "/api/social/friends/activity", me);
    expect((feed.body as any[]).map((p) => p.id)).not.toContain(friendPostB);

    const hidden = await call("GET", "/api/feed/not-interested", me);
    expect(hidden.status).toBe(200);
    expect(hidden.body.items.map((i: any) => i.postId)).toEqual([friendPostB]);
    expect(hidden.body.items[0]).toMatchObject({ caption: "B", authorId: friend });
    // Only the viewer's own hides.
    expect((await call("GET", "/api/feed/not-interested", friend)).body.items).toEqual([]);

    expect((await call("DELETE", `/api/feed/not-interested/${friendPostB}`, me)).body).toMatchObject({ removed: true });
    feed = await call("GET", "/api/social/friends/activity", me);
    expect((feed.body as any[]).map((p) => p.id)).toContain(friendPostB);
    expect((await call("GET", "/api/feed/not-interested", me)).body.items).toEqual([]);
  });

  it("88: a hidden post still shows on the author's profile", async () => {
    await db.insert(feedNotInterested).values({ userId: me, postId: friendPostA, sellerId: friend });
    const profile = await call("GET", `/api/social/profile/${friend}/posts`, me);
    expect((profile.body as any[]).map((p) => p.id)).toContain(friendPostA);
    await db.delete(feedNotInterested).where(eq(feedNotInterested.userId, me));
  });
});

describe("notifications (90–92)", () => {
  async function seed(rows: Array<{ category: string; isRead: boolean; title: string }>) {
    await db.delete(notificationsFeed).where(eq(notificationsFeed.userId, me));
    return db.insert(notificationsFeed).values(rows.map((r) => ({
      userId: me, category: r.category, type: "test", title: r.title, body: "", isRead: r.isRead,
    }))).returning({ id: notificationsFeed.id, title: notificationsFeed.title });
  }

  it("91: clear read deletes only read rows (and only the chosen category)", async () => {
    await seed([
      { category: "social", isRead: true, title: "social-read" },
      { category: "social", isRead: false, title: "social-unread" },
      { category: "orders", isRead: true, title: "orders-read" },
    ]);
    const scoped = await call("DELETE", "/api/buyer/notifications/read?category=social", me);
    expect(scoped.body).toMatchObject({ ok: true, removed: 1 });
    let titles = (await db.select({ t: notificationsFeed.title }).from(notificationsFeed).where(eq(notificationsFeed.userId, me))).map((r) => r.t).sort();
    expect(titles).toEqual(["orders-read", "social-unread"]);

    expect((await call("DELETE", "/api/buyer/notifications/read", me)).body).toMatchObject({ removed: 1 });
    titles = (await db.select({ t: notificationsFeed.title }).from(notificationsFeed).where(eq(notificationsFeed.userId, me))).map((r) => r.t);
    expect(titles).toEqual(["social-unread"]);
  });

  it("92: mark unread is persisted", async () => {
    const [row] = await seed([{ category: "social", isRead: true, title: "x" }]);
    expect((await call("PATCH", `/api/buyer/notifications/${row.id}/unread`, me, {})).status).toBe(200);
    const [after] = await db.select({ isRead: notificationsFeed.isRead }).from(notificationsFeed).where(eq(notificationsFeed.id, row.id));
    expect(after.isRead).toBe(false);
    // Another user cannot flip it.
    await call("PATCH", `/api/buyer/notifications/${row.id}/read`, me, {});
    await call("PATCH", `/api/buyer/notifications/${row.id}/unread`, stranger, {});
    const [still] = await db.select({ isRead: notificationsFeed.isRead }).from(notificationsFeed).where(eq(notificationsFeed.id, row.id));
    expect(still.isRead).toBe(true);
  });

  it("90: muting a category mutes existing + future rows and stops its pushes; unmute restores", async () => {
    await seed([{ category: "social", isRead: false, title: "before" }]);
    const muted = await call("POST", "/api/buyer/notifications/mute-category", me, { category: "social" });
    expect(muted.body).toMatchObject({ ok: true, muted: true });
    const [existing] = await db.select({ isMuted: notificationsFeed.isMuted }).from(notificationsFeed).where(eq(notificationsFeed.userId, me));
    expect(existing.isMuted).toBe(true);

    const { publishNotification } = await import("../notifications-feed");
    await publishNotification({ userId: me, category: "social", type: "post_like", title: "after mute" });
    const [future] = await db.select({ isMuted: notificationsFeed.isMuted }).from(notificationsFeed)
      .where(and(eq(notificationsFeed.userId, me), eq(notificationsFeed.title, "after mute")));
    expect(future.isMuted).toBe(true);

    // Direct pushes (not through publishNotification) are suppressed too.
    const { sendPushToUser } = await import("../../lib/push");
    expect(await sendPushToUser(me, { title: "t", body: "b" }, "social")).toBe(false);

    const unmuted = await call("POST", "/api/buyer/notifications/mute-category", me, { category: "social", muted: false });
    expect(unmuted.body).toMatchObject({ muted: false });
    const keys = await db.select().from(activityMutes).where(eq(activityMutes.userId, me));
    expect(keys).toEqual([]);
    const rows = await db.select({ isMuted: notificationsFeed.isMuted }).from(notificationsFeed).where(eq(notificationsFeed.userId, me));
    expect(rows.every((r) => r.isMuted === false)).toBe(true);
  });

  it("90: rejects a missing category", async () => {
    expect((await call("POST", "/api/buyer/notifications/mute-category", me, {})).status).toBe(400);
  });
});

describe("order problem reports (74)", () => {
  it("persists the report, mirrors it to support and notifies the seller", async () => {
    const created = await call("POST", "/api/order-problems", me, {
      orderId, type: "damaged_product", description: "Arrived torn", contactedSeller: true, email: "me@t.local", name: "Me",
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ orderId, orderNumber: `DE-${suffix}`, type: "damaged_product", status: "open", contactedSeller: true });

    const [row] = await db.select().from(orderProblemReports).where(eq(orderProblemReports.id, created.body.id));
    expect(row).toMatchObject({ buyerId: me, sellerId: seller, description: "Arrived torn" });

    const tickets = await db.execute(sql`SELECT subject FROM support_tickets WHERE clerk_id = ${me}`);
    expect((tickets as any).rows.map((r: any) => r.subject)).toContain(`Order problem: Damaged item (#DE-${suffix})`);

    await vi.waitFor(async () => {
      const notes = await db.select().from(notificationsFeed)
        .where(and(eq(notificationsFeed.userId, seller), eq(notificationsFeed.type, "order_problem_reported")));
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatchObject({ targetId: orderId, targetType: "order" });
    });
  });

  it("is visible to the order's buyer and seller, not to anyone else", async () => {
    expect((await call("GET", `/api/order-problems/order/${orderId}`, me)).body).toHaveLength(1);
    expect((await call("GET", `/api/order-problems/order/${orderId}`, seller)).body).toHaveLength(1);
    expect((await call("GET", `/api/order-problems/order/${orderId}`, stranger)).status).toBe(404);
    expect((await call("GET", "/api/order-problems/mine", me)).body).toHaveLength(1);
  });

  it("rejects someone else's order, unknown types, empty text and foreign evidence", async () => {
    expect((await call("POST", "/api/order-problems", stranger, { orderId, type: "other", description: "x" })).status).toBe(403);
    expect((await call("POST", "/api/order-problems", me, { orderId, type: "nope", description: "x" })).status).toBe(400);
    expect((await call("POST", "/api/order-problems", me, { orderId, type: "other", description: "  " })).status).toBe(400);
    expect((await call("POST", "/api/order-problems", me, {
      orderId, type: "other", description: "x", evidenceUrls: ["/objects/returns/someone_else/1"],
    })).status).toBe(400);
  });

  it("accepts a general (no order) report", async () => {
    const created = await call("POST", "/api/order-problems", me, { type: "other", description: "General issue" });
    expect(created.status).toBe(201);
    expect(created.body.orderId).toBeNull();
  });
});

describe("review follow-ups", () => {
  it("Hidden posts never lists a post that was deleted since", async () => {
    const [gone] = await db.insert(posts).values({
      userId: friend, mediaUrl: `https://cdn.test/${suffix}/gone.jpg`, mediaType: "photo", caption: "gone", postStatus: "deleted",
    }).returning({ id: posts.id });
    await db.insert(feedNotInterested).values({ userId: me, postId: gone.id, sellerId: friend });
    const hidden = await call("GET", "/api/feed/not-interested", me);
    expect(hidden.body.items.map((i: any) => i.postId)).not.toContain(gone.id);
    await db.delete(feedNotInterested).where(eq(feedNotInterested.userId, me));
  });

  it("unmuting one alias keeps the shared push mute of another muted alias", async () => {
    await call("POST", "/api/buyer/notifications/mute-category", me, { category: "payout" });
    await call("POST", "/api/buyer/notifications/mute-category", me, { category: "finance" });
    await call("POST", "/api/buyer/notifications/mute-category", me, { category: "finance", muted: false });
    const keys = (await db.select({ k: activityMutes.muteKey }).from(activityMutes).where(eq(activityMutes.userId, me))).map((r) => r.k).sort();
    expect(keys).toEqual(["category:payout", "push:payout"]);
    await call("POST", "/api/buyer/notifications/mute-category", me, { category: "payout", muted: false });
    expect(await db.select().from(activityMutes).where(eq(activityMutes.userId, me))).toEqual([]);
  });

  it("GET /api/posts/:id honours the author's \"Who can see your posts\"", async () => {
    const [own] = await db.insert(posts).values({
      userId: friend, mediaUrl: `https://cdn.test/${suffix}/p.jpg`, mediaType: "photo", caption: "P",
      postStatus: "published", surface: "profile",
    } as any).returning({ id: posts.id });
    expect((await call("GET", `/api/posts/${own.id}`, me)).status).toBe(200);
    await db.update(users).set({ privacySettings: { whoCanSeePosts: "only_me" } } as any).where(eq(users.clerkId, friend));
    expect((await call("GET", `/api/posts/${own.id}`, me)).status).toBe(404);
    expect((await call("GET", `/api/posts/${own.id}`, friend)).status).toBe(200);
    await db.update(users).set({ privacySettings: {} } as any).where(eq(users.clerkId, friend));
  });

  it("\"tagged you\" is sent once per person, even after they clear it", async () => {
    const { syncPostUserTags, notifyPostTagsIfLive } = await import("../../lib/postUserTags");
    const [tagged] = await db.insert(posts).values({
      userId: friend, mediaUrl: `https://cdn.test/${suffix}/t.jpg`, mediaType: "photo",
      caption: `fit with @${me.replace(/-/g, "_")}`, postStatus: "published",
    }).returning({ id: posts.id, caption: posts.caption });
    expect(await syncPostUserTags(tagged.id, friend, tagged.caption)).toEqual([me]);
    await notifyPostTagsIfLive(tagged.id);
    const tagRows = () => db.select().from(notificationsFeed)
      .where(and(eq(notificationsFeed.userId, me), eq(notificationsFeed.type, "post_tag"), eq(notificationsFeed.targetId, tagged.id)));
    expect(await tagRows()).toHaveLength(1);
    await db.delete(notificationsFeed).where(eq(notificationsFeed.userId, me));
    await notifyPostTagsIfLive(tagged.id);
    expect(await tagRows()).toHaveLength(0);
  });
});
