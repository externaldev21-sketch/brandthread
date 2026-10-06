/**
 * END-TO-END SOCIAL — stories, Activity and push, driven from BOTH sides
 * through the real routers against real Postgres:
 *   - a story view counts once per viewer and never for the author;
 *   - a story reply is ONE call that honours the author's reply settings,
 *     reaches the author's Inbox/Requests (buyer or seller) with the slide
 *     attached, and notifies them as "replied to your story";
 *   - "@handle" in a published caption notifies the person mentioned;
 *   - sellers can turn social pushes off (used to 400);
 *   - opening a push marks its Activity row read; pushes carry the badge.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, inArray, or } from "drizzle-orm";
import {
  db, users, follows, stories, storyViews, conversations, conversationParticipants, messages, notificationsFeed, posts,
} from "@workspace/db";

const suffix = `${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
const S = `soc-act-seller-${suffix}`;
const A = `soc-act-buyer-${suffix}`;
const ALL = [S, A];
const A_HANDLE = `actbuyer${crypto.randomBytes(3).toString("hex")}`;

const pushes = vi.hoisted(() => ({ calls: [] as Array<{ userId: string; payload: any }> }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const header = req.header("x-test-user-id");
    if (!header) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = header;
    next();
  },
}));
vi.mock("../../lib/push", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/push")>();
  return {
    ...actual,
    sendPushToUser: vi.fn(async (userId: string, payload: any) => { pushes.calls.push({ userId, payload }); return true; }),
  };
});

let server: Server;
let base = "";
const storyIds: string[] = [];

async function call(method: string, path: string, userId: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method, headers: { "content-type": "application/json", "x-test-user-id": userId },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (text.startsWith("<")) throw new Error(`${method} ${path} -> ${res.status}: ${text.replace(/<[^>]+>/g, " ").slice(0, 400)}`);
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function newStory(values: Partial<typeof stories.$inferInsert> = {}) {
  const [row] = await db.insert(stories).values({
    authorId: S, authorName: "Act Seller", authorAccountType: "seller",
    media: [{ type: "image", uri: "https://example.test/story.jpg" }],
    expiresAt: new Date(Date.now() + 3_600_000),
    ...values,
  } as any).returning({ id: stories.id });
  storyIds.push(row.id);
  return row.id;
}

async function rowsFor(userId: string, type: string) {
  return db.select().from(notificationsFeed).where(and(eq(notificationsFeed.userId, userId), eq(notificationsFeed.type, type)));
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: S, email: `${S}@example.test`, name: "Act Seller", displayName: "Act Seller", brandName: "Act Seller", accountType: "seller", onboardingComplete: true },
    { clerkId: A, email: `${A}@example.test`, name: "Act Buyer", displayName: "Act Buyer", username: A_HANDLE, accountType: "buyer", onboardingComplete: true },
  ]);
  await db.insert(follows).values({ followerId: A, followingId: S });

  const [
    { default: socialRouter }, { default: storyMentionsRouter }, { default: postsRouter },
    { default: prefsRouter }, { default: eventsRouter }, { default: feedRouter },
  ] = await Promise.all([
    import("../social"), import("../story-mentions"), import("../posts"),
    import("../notification-prefs"), import("../notification-events"), import("../notifications-feed"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).log = { error() {}, warn() {}, info() {} };
    const header = req.header("x-test-user-id");
    if (header) (req as any).clerkUserId = header;
    next();
  });
  app.use("/api/social", socialRouter);
  app.use("/api/social", storyMentionsRouter);
  app.use("/api/posts", postsRouter);
  app.use("/api/seller/notification-prefs", prefsRouter);
  app.use("/api/notifications", eventsRouter);
  app.use("/api/buyer/notifications", feedRouter);
  app.use((err: any, _req: any, res: any, _next: any) => { res.status(500).json({ error: String(err?.message ?? err), cause: String(err?.cause?.message ?? "") }); });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  const convIds = (await db.select({ id: conversationParticipants.conversationId }).from(conversationParticipants)
    .where(inArray(conversationParticipants.userId, ALL))).map((r) => r.id);
  if (convIds.length) await db.delete(conversations).where(inArray(conversations.id, convIds));
  await db.delete(storyViews).where(inArray(storyViews.userId, ALL));
  await db.delete(stories).where(inArray(stories.authorId, ALL));
  await db.delete(posts).where(inArray(posts.userId, ALL));
  await db.delete(notificationsFeed).where(inArray(notificationsFeed.userId, ALL));
  await db.delete(follows).where(or(inArray(follows.followerId, ALL), inArray(follows.followingId, ALL)));
  await db.delete(users).where(inArray(users.clerkId, ALL));
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

describe("Stories", () => {
  it("a view counts once per viewer, never for the author", async () => {
    const storyId = await newStory();
    await call("POST", `/api/social/stories/${storyId}/view`, S); // author opens own story
    await call("POST", `/api/social/stories/${storyId}/view`, A);
    await call("POST", `/api/social/stories/${storyId}/view`, A); // re-open
    const [row] = await db.select({ viewsCount: stories.viewsCount }).from(stories).where(eq(stories.id, storyId));
    expect(row.viewsCount).toBe(1);
    const viewers = await call("GET", `/api/social/stories/${storyId}/viewers`, S);
    const ids = (Array.isArray(viewers.body) ? viewers.body : viewers.body.viewers ?? []).map((v: any) => v.userId ?? v.id);
    expect(ids).toContain(A);
    expect(ids).not.toContain(S);
  });

  it("a story reply reaches the seller's DMs with the slide, as 'replied to your story' (one notification)", async () => {
    const storyId = await newStory();
    const res = await call("POST", `/api/social/stories/${storyId}/reply`, A, { text: "love this coat", slideUri: "https://example.test/slide.jpg" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const convId = res.body.conversationId;
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, convId));
    expect(conv.type).toBe("buyer_to_seller"); // was hardcoded buyer_to_buyer
    const msgs = await db.select().from(messages).where(eq(messages.conversationId, convId));
    expect(msgs.at(-1)).toMatchObject({ senderId: A, body: "love this coat" });
    expect((msgs.at(-1)!.attachment as any)).toMatchObject({ type: "story_reply", meta: { storyId } });
    // The seller's inbox (or Requests) lists it.
    const [sellerPart] = await db.select().from(conversationParticipants)
      .where(and(eq(conversationParticipants.conversationId, convId), eq(conversationParticipants.userId, S)));
    expect(sellerPart.unreadCount).toBe(1);
    await expect.poll(async () => (await rowsFor(S, "story_reply")).length).toBe(1);
    const [notif] = await rowsFor(S, "story_reply");
    expect(notif).toMatchObject({ actorId: A, targetType: "conversation", targetId: convId, title: "Act Buyer replied to your story" });
    expect(await rowsFor(S, "new_order_message")).toHaveLength(0);
  });

  it("the author's reply settings are enforced on the server", async () => {
    const off = await newStory({ repliesDisabled: true } as any);
    expect((await call("POST", `/api/social/stories/${off}/reply`, A, { text: "hi" })).body).toMatchObject({ code: "REPLIES_DISABLED" });
    const followingOnly = await newStory({ privacyReplyPerm: "following" } as any);
    const blocked = await call("POST", `/api/social/stories/${followingOnly}/reply`, A, { text: "hi" });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("REPLIES_LIMITED");
    await db.insert(follows).values({ followerId: S, followingId: A });
    expect((await call("POST", `/api/social/stories/${followingOnly}/reply`, A, { text: "hi" })).status).toBe(201);
    expect((await call("POST", `/api/social/stories/${followingOnly}/reply`, S, { text: "self" })).status).toBe(400);
  });
});

describe("Mentions, prefs, push", () => {
  it("'@handle' in a published caption notifies the person mentioned, once", async () => {
    const created = await call("POST", "/api/posts", S, {
      mediaUrl: "https://example.test/mention.jpg", mediaType: "photo", caption: `Styled by @${A_HANDLE} 🖤`,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    await expect.poll(async () => (await rowsFor(A, "post_mention")).length).toBe(1);
    const [row] = await rowsFor(A, "post_mention");
    expect(row).toMatchObject({ actorId: S, targetType: "post", targetId: created.body.id });
  });

  it("a seller can switch social pushes off", async () => {
    const put = await call("PUT", "/api/seller/notification-prefs", S, { categories: { friend_activity: false } });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const get = await call("GET", "/api/seller/notification-prefs", S);
    expect(JSON.stringify(get.body)).toContain('"friend_activity":false');
  });

  it("pushes carry the unread badge, and opening a push marks its Activity row read", async () => {
    pushes.calls.length = 0;
    const storyId = await newStory();
    await call("POST", `/api/social/stories/${storyId}/reply`, A, { text: "badge check" });
    await expect.poll(() => pushes.calls.filter((c) => c.userId === S && c.payload.data?.type === "story_reply").length).toBe(1);
    const push = pushes.calls.find((c) => c.userId === S && c.payload.data?.type === "story_reply")!;
    const unread = (await call("GET", "/api/buyer/notifications/unread-count", S)).body.count;
    expect(push.payload.badge).toBe(unread);

    const notificationId = push.payload.data.notificationId as string;
    expect((await call("POST", "/api/notifications/events", S, { notificationId, eventType: "open" })).status).toBe(200);
    const [row] = await db.select({ isRead: notificationsFeed.isRead }).from(notificationsFeed).where(eq(notificationsFeed.id, notificationId));
    expect(row.isRead).toBe(true);
    expect((await call("GET", "/api/buyer/notifications/unread-count", S)).body.count).toBe(unread - 1);
  });
});
