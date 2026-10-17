/**
 * Real-DB coverage for person mutes, restrict and the Privacy-screen settings
 * (audit items 97-99), all of which used to live only on the phone:
 *   - mutes hide the muted person's posts (Thread feed, friends feed),
 *     comments and stories from the muter only;
 *   - a restricted person's comments on the restrictor's posts are only
 *     visible to that person, aren't counted for others, don't notify the
 *     owner, and their new DMs land in requests;
 *   - privacy settings round-trip through /api/auth/privacy and are enforced
 *     at follow, search, friends list, read receipts, typing, mentions and
 *     story replies.
 *
 * Only the Clerk boundary and notifications are mocked.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { and, eq, inArray, like, or } from "drizzle-orm";
import {
  conversationParticipants, conversations, db, follows, messages, postComments, posts, stories,
  userMutes, userRestrictions, users,
} from "@workspace/db";

const sent = vi.hoisted(() => ({ notifications: [] as Array<{ userId: string; type: string }> }));

vi.mock("../../middlewares/requireAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../middlewares/requireAuth")>();
  return {
    ...actual,
    requireAuth: (req: any, res: any, next: () => void) => {
      const userId = req.header("x-test-user-id");
      if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
      req.clerkUserId = userId;
      next();
    },
  };
});
vi.mock("@clerk/express", () => ({
  getAuth: (req: any) => ({ userId: req.header?.("x-test-user-id") || null, sessionId: null }),
  clerkMiddleware: () => (_req: any, _res: any, next: () => void) => next(),
  clerkClient: { users: { getUser: async () => ({}), updateUserMetadata: async () => ({}) } },
}));
vi.mock("../notifications-feed", () => ({
  publishNotification: async (n: { userId: string; type: string }) => { sent.notifications.push({ userId: n.userId, type: n.type }); },
}));

const RUN = `smp${crypto.randomBytes(5).toString("hex")}`;
const VIEWER = `${RUN}_viewer`;   // the person who mutes
const FRIEND = `${RUN}_friend`;   // buyer friend who gets muted
const SELLER = `${RUN}_seller`;   // followed seller who gets muted
const OWNER = `${RUN}_owner`;     // post owner who restricts
const RESTRICTED = `${RUN}_restr`;
const PRIV = `${RUN}_priv`;       // privacy-settings account
const ALL = [VIEWER, FRIEND, SELLER, OWNER, RESTRICTED, PRIV];

let server: Server;
let base = "";
let sellerPostId = "";
let ownerPostId = "";
let friendPostId = "";

async function call(path: string, options: { method?: string; user?: string | null; body?: unknown } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.user) headers["x-test-user-id"] = options.user;
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  return { status: response.status, body: await response.json().catch(() => null) as any };
}

function commentBodies(payload: any): string[] {
  const out: string[] = [];
  for (const comment of payload?.comments ?? []) {
    out.push(comment.body);
    for (const reply of comment.replies ?? []) out.push(reply.body);
  }
  return out;
}

beforeAll(async () => {
  const buyer = (id: string, name: string) => ({
    clerkId: id, email: `${id}@example.test`, name, displayName: name, accountType: "buyer", role: "buyer", username: id.replace(/_/g, ""),
  });
  await db.insert(users).values([
    buyer(VIEWER, `Viewer ${RUN}`),
    buyer(FRIEND, `Friend ${RUN}`),
    { clerkId: SELLER, email: `${SELLER}@example.test`, name: "Muted Seller", brandName: `Brand ${RUN}`, accountType: "seller", role: "owner", username: `${RUN}seller` },
    buyer(OWNER, `Owner ${RUN}`),
    buyer(RESTRICTED, `Restricted ${RUN}`),
    buyer(PRIV, `Privy ${RUN}`),
  ]);
  await db.insert(follows).values([
    { followerId: VIEWER, followingId: SELLER },
    { followerId: VIEWER, followingId: FRIEND },
    { followerId: FRIEND, followingId: VIEWER },
    { followerId: OWNER, followingId: RESTRICTED },
  ]);
  const now = new Date();
  const [sp] = await db.insert(posts).values({
    userId: SELLER, mediaUrl: "https://cdn.test/s.jpg", caption: "seller drop", postStatus: "published", publishedAt: now,
  }).returning({ id: posts.id });
  sellerPostId = sp.id;
  const [op] = await db.insert(posts).values({
    userId: OWNER, mediaUrl: "https://cdn.test/o.jpg", caption: "owner fit", postStatus: "published", publishedAt: now,
  }).returning({ id: posts.id });
  ownerPostId = op.id;
  const [fp] = await db.insert(posts).values({
    userId: FRIEND, mediaUrl: "https://cdn.test/f.jpg", caption: "friend fit", postStatus: "published", publishedAt: now,
  }).returning({ id: posts.id });
  friendPostId = fp.id;
  await db.insert(postComments).values({ postId: ownerPostId, authorId: FRIEND, body: `friend comment ${RUN}` });
  await db.insert(stories).values({
    authorId: FRIEND, authorName: "Friend", media: [{ imageUri: "https://cdn.test/st.jpg" }],
    expiresAt: new Date(Date.now() + 3_600_000),
  });

  const { default: postCommentsRouter } = await import("../post-comments");
  const { default: postsRouter } = await import("../posts");
  const { default: socialRouter } = await import("../social");
  const { default: safetyRouter } = await import("../safety");
  const { default: authRouter } = await import("../auth");
  const { default: conversationsRouter } = await import("../conversations");

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).log = { error: () => {}, warn: () => {}, info: () => {} }; next(); });
  app.use("/api/posts", postCommentsRouter);
  app.use("/api/posts", postsRouter);
  app.use("/api/social", socialRouter);
  app.use("/api/safety", safetyRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/conversations", conversationsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  const convRows = await db.select({ id: conversationParticipants.conversationId }).from(conversationParticipants)
    .where(inArray(conversationParticipants.userId, ALL));
  if (convRows.length) await db.delete(conversations).where(inArray(conversations.id, convRows.map((r) => r.id)));
  await db.delete(userMutes).where(or(inArray(userMutes.muterId, ALL), inArray(userMutes.mutedId, ALL)));
  await db.delete(userRestrictions).where(or(inArray(userRestrictions.restrictorId, ALL), inArray(userRestrictions.restrictedId, ALL)));
  await db.delete(follows).where(or(inArray(follows.followerId, ALL), inArray(follows.followingId, ALL)));
  await db.delete(stories).where(inArray(stories.authorId, ALL));
  await db.delete(posts).where(inArray(posts.userId, ALL));
  await db.delete(users).where(like(users.clerkId, `${RUN}%`));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("person mutes (server-side, one-way)", () => {
  it("rejects muting yourself or nobody", async () => {
    expect((await call("/api/safety/mutes", { method: "POST", user: VIEWER, body: { userId: VIEWER } })).status).toBe(400);
    expect((await call("/api/safety/mutes", { method: "POST", user: VIEWER, body: {} })).status).toBe(400);
    expect((await call("/api/safety/mutes", { method: "POST", user: VIEWER, body: { userId: `${RUN}_ghost` } })).status).toBe(404);
  });

  it("hides the muted seller's posts from my Thread feed only", async () => {
    const before = await call("/api/posts/feed", { user: VIEWER });
    expect(before.body.map((p: any) => p.id)).toContain(sellerPostId);

    const muted = await call("/api/safety/mutes", { method: "POST", user: VIEWER, body: { userId: SELLER } });
    expect(muted.status).toBe(201);
    expect(muted.body).toMatchObject({ userId: SELLER, mutePosts: true, muteStories: true });

    const after = await call("/api/posts/feed", { user: VIEWER });
    expect(after.body.map((p: any) => p.id)).not.toContain(sellerPostId);

    const list = await call("/api/safety/mutes", { user: VIEWER });
    expect(list.body.mutes.map((m: any) => m.userId)).toEqual([SELLER]);
    expect(list.body.mutes[0].name).toBeTruthy();
  });

  it("hides a muted friend's posts, comments and stories; unmute restores them", async () => {
    const feedBefore = await call("/api/social/friends/activity", { user: VIEWER });
    expect(feedBefore.body.map((p: any) => p.id)).toContain(friendPostId);
    const trayBefore = await call("/api/social/stories/following", { user: VIEWER });
    expect(trayBefore.body.map((s: any) => s.authorId)).toContain(FRIEND);
    const commentsBefore = await call(`/api/posts/${ownerPostId}/comments`, { user: VIEWER });
    expect(commentBodies(commentsBefore.body)).toContain(`friend comment ${RUN}`);

    expect((await call("/api/safety/mutes", { method: "POST", user: VIEWER, body: { userId: FRIEND } })).status).toBe(201);

    const feed = await call("/api/social/friends/activity", { user: VIEWER });
    expect(feed.body.map((p: any) => p.id)).not.toContain(friendPostId);
    const tray = await call("/api/social/stories/following", { user: VIEWER });
    expect(tray.body.map((s: any) => s.authorId)).not.toContain(FRIEND);
    const comments = await call(`/api/posts/${ownerPostId}/comments`, { user: VIEWER });
    expect(commentBodies(comments.body)).not.toContain(`friend comment ${RUN}`);
    expect(comments.body.total).toBe(commentsBefore.body.total - 1);

    // One-way: the post owner (and the muted person) still see the comment.
    const asOwner = await call(`/api/posts/${ownerPostId}/comments`, { user: OWNER });
    expect(commentBodies(asOwner.body)).toContain(`friend comment ${RUN}`);
    // The muted person still sees my side of things (their own tray has their story).
    const theirTray = await call("/api/social/stories/following", { user: FRIEND });
    expect(theirTray.body.map((s: any) => s.authorId)).toContain(FRIEND);

    // Stories-only mute keeps their posts but drops their stories.
    await call("/api/safety/mutes", { method: "POST", user: VIEWER, body: { userId: FRIEND, mutePosts: false, muteStories: true } });
    expect((await call("/api/social/friends/activity", { user: VIEWER })).body.map((p: any) => p.id)).toContain(friendPostId);
    expect((await call("/api/social/stories/following", { user: VIEWER })).body.map((s: any) => s.authorId)).not.toContain(FRIEND);

    expect((await call(`/api/safety/mutes/${FRIEND}`, { method: "DELETE", user: VIEWER })).status).toBe(200);
    expect((await call("/api/social/stories/following", { user: VIEWER })).body.map((s: any) => s.authorId)).toContain(FRIEND);
    expect(commentBodies((await call(`/api/posts/${ownerPostId}/comments`, { user: VIEWER })).body)).toContain(`friend comment ${RUN}`);
  });
});

describe("restrict", () => {
  it("restricted comments are only visible to their author and don't notify the owner", async () => {
    expect((await call("/api/safety/restrictions", { method: "POST", user: OWNER, body: { userId: RESTRICTED } })).status).toBe(201);
    const listed = await call("/api/safety/restrictions", { user: OWNER });
    expect(listed.body.restrictions.map((r: any) => r.userId)).toEqual([RESTRICTED]);

    sent.notifications.length = 0;
    const created = await call(`/api/posts/${ownerPostId}/comments`, { method: "POST", user: RESTRICTED, body: { body: `restricted says hi ${RUN}` } });
    expect(created.status).toBe(201);
    const control = await call(`/api/posts/${ownerPostId}/comments`, { method: "POST", user: VIEWER, body: { body: `viewer says hi ${RUN}` } });
    expect(control.status).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const ownerNotices = sent.notifications.filter((n) => n.userId === OWNER && n.type === "post_comment");
    expect(ownerNotices).toHaveLength(1); // only the unrestricted viewer's comment

    const asOther = await call(`/api/posts/${ownerPostId}/comments`, { user: VIEWER });
    expect(commentBodies(asOther.body)).not.toContain(`restricted says hi ${RUN}`);
    const asOwner = await call(`/api/posts/${ownerPostId}/comments`, { user: OWNER });
    expect(commentBodies(asOwner.body)).not.toContain(`restricted says hi ${RUN}`);
    const asAuthor = await call(`/api/posts/${ownerPostId}/comments`, { user: RESTRICTED });
    expect(commentBodies(asAuthor.body)).toContain(`restricted says hi ${RUN}`);
    expect(asAuthor.body.total).toBe(asOther.body.total + 1);

    const { visibleCommentCounts } = await import("../../lib/postVisibility");
    const forOthers = (await visibleCommentCounts([ownerPostId], VIEWER)).get(ownerPostId) ?? 0;
    const forAuthor = (await visibleCommentCounts([ownerPostId], RESTRICTED)).get(ownerPostId) ?? 0;
    expect(forAuthor).toBe(forOthers + 1);
  });

  it("routes the restricted person's new DMs to requests even though the owner follows them", async () => {
    const { shouldRouteToRequests } = await import("../../lib/conversationRouting");
    expect(await shouldRouteToRequests(OWNER, RESTRICTED, "buyer")).toBe(true);
    await call(`/api/safety/restrictions/${RESTRICTED}`, { method: "DELETE", user: OWNER });
    expect(await shouldRouteToRequests(OWNER, RESTRICTED, "buyer")).toBe(false);
    const asOther = await call(`/api/posts/${ownerPostId}/comments`, { user: VIEWER });
    expect(commentBodies(asOther.body)).toContain(`restricted says hi ${RUN}`);
  });
});

describe("privacy settings", () => {
  it("defaults preserve current behaviour and PATCH validates + merges", async () => {
    const initial = await call("/api/auth/privacy", { user: PRIV });
    expect(initial.status).toBe(200);
    expect(initial.body.settings).toMatchObject({
      whoCanSendFriendRequests: "everyone", whoCanSeeFriendsList: "everyone", searchable: true, readReceiptsEnabled: true,
    });
    const bad = await call("/api/auth/privacy", { method: "PATCH", user: PRIV, body: { settings: { whoCanSeePosts: "nobody" } } });
    expect(bad.status).toBe(400);
    const unknown = await call("/api/auth/privacy", { method: "PATCH", user: PRIV, body: { settings: { hackerKey: true } } });
    expect(unknown.status).toBe(400);

    const saved = await call("/api/auth/privacy", { method: "PATCH", user: PRIV, body: { settings: { searchable: false } } });
    expect(saved.status).toBe(200);
    const merged = await call("/api/auth/privacy", { method: "PATCH", user: PRIV, body: { settings: { whoCanSendFriendRequests: "nobody" } } });
    expect(merged.body.settings).toMatchObject({ searchable: false, whoCanSendFriendRequests: "nobody" });
  });

  it("rejects follows when friend requests are turned off, allows them from friends of friends", async () => {
    const res = await call("/api/social/follow", { method: "POST", user: VIEWER, body: { userId: PRIV } });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FRIEND_REQUESTS_RESTRICTED");
    expect(res.body.error).toMatch(/friend requests/i);

    await call("/api/auth/privacy", { method: "PATCH", user: PRIV, body: { settings: { whoCanSendFriendRequests: "friends_of_friends" } } });
    expect((await call("/api/social/follow", { method: "POST", user: VIEWER, body: { userId: PRIV } })).status).toBe(403);
    // PRIV follows FRIEND, who follows VIEWER -> VIEWER is a friend of a friend.
    await db.insert(follows).values({ followerId: PRIV, followingId: FRIEND });
    const ok = await call("/api/social/follow", { method: "POST", user: VIEWER, body: { userId: PRIV } });
    expect(ok.status).toBe(200);
  });

  it("excludes non-searchable accounts from people search and suggestions", async () => {
    const hidden = await call(`/api/social/search?q=${encodeURIComponent(`Privy ${RUN}`)}`, { user: OWNER });
    expect(hidden.body.map((u: any) => u.userId)).not.toContain(PRIV);
    await call("/api/auth/privacy", { method: "PATCH", user: PRIV, body: { settings: { searchable: true } } });
    const shown = await call(`/api/social/search?q=${encodeURIComponent(`Privy ${RUN}`)}`, { user: OWNER });
    expect(shown.body.map((u: any) => u.userId)).toContain(PRIV);
  });

  it("hides the friends list from others when set to only me", async () => {
    expect((await call(`/api/social/followers?userId=${PRIV}`, { user: OWNER })).status).toBe(200);
    await call("/api/auth/privacy", { method: "PATCH", user: PRIV, body: { settings: { whoCanSeeFriendsList: "only_me" } } });
    const blocked = await call(`/api/social/followers?userId=${PRIV}`, { user: OWNER });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("FRIENDS_LIST_PRIVATE");
    expect((await call(`/api/social/following?userId=${PRIV}`, { user: OWNER })).status).toBe(403);
    const own = await call("/api/social/followers", { user: PRIV });
    expect(own.status).toBe(200);
    expect(own.body.map((u: any) => u.userId)).toContain(VIEWER);
    // "friends" = people the owner follows: FRIEND passes, OWNER doesn't.
    await call("/api/auth/privacy", { method: "PATCH", user: PRIV, body: { settings: { whoCanSeeFriendsList: "friends" } } });
    expect((await call(`/api/social/followers?userId=${PRIV}`, { user: FRIEND })).status).toBe(200);
    expect((await call(`/api/social/followers?userId=${PRIV}`, { user: OWNER })).status).toBe(403);
  });

  it("read receipts off: the reader's unread clears but the sender never sees 'read'; typing isn't shared with activity status off", async () => {
    const [conv] = await db.insert(conversations).values({ type: "buyer_to_buyer" }).returning();
    await db.insert(conversationParticipants).values([
      { conversationId: conv.id, userId: VIEWER, name: "Viewer" },
      { conversationId: conv.id, userId: PRIV, name: "Privy", unreadCount: 1 },
    ]);
    const [msg] = await db.insert(messages).values({ conversationId: conv.id, senderId: VIEWER, body: "hello" }).returning();
    await call("/api/auth/privacy", {
      method: "PATCH", user: PRIV, body: { settings: { readReceiptsEnabled: false, activityStatusVisible: false } },
    });

    expect((await call(`/api/conversations/${conv.id}/read`, { method: "PATCH", user: PRIV })).status).toBe(200);
    const [after] = await db.select().from(messages).where(eq(messages.id, msg.id));
    expect(after.status).not.toBe("read");
    expect(after.readAt).toBeNull();
    const [me] = await db.select().from(conversationParticipants)
      .where(and(eq(conversationParticipants.conversationId, conv.id), eq(conversationParticipants.userId, PRIV)));
    expect(me.unreadCount).toBe(0);
    expect(me.lastReadAt).not.toBeNull();

    await call(`/api/conversations/${conv.id}/typing`, { method: "PATCH", user: PRIV, body: { typing: true } });
    const [typing] = await db.select().from(conversationParticipants)
      .where(and(eq(conversationParticipants.conversationId, conv.id), eq(conversationParticipants.userId, PRIV)));
    expect(typing.typingUntil).toBeNull();

    // With receipts back on, the same call marks it read.
    await call("/api/auth/privacy", { method: "PATCH", user: PRIV, body: { settings: { readReceiptsEnabled: true } } });
    await call(`/api/conversations/${conv.id}/read`, { method: "PATCH", user: PRIV });
    const [read] = await db.select().from(messages).where(eq(messages.id, msg.id));
    expect(read.status).toBe("read");
  });

  it("drops mentions of people who don't allow them and blocks story replies when turned off", async () => {
    await call("/api/auth/privacy", { method: "PATCH", user: PRIV, body: { settings: { whoCanMention: "nobody", whoCanReplyToStories: "nobody" } } });
    const { resolveCommentMentions } = await import("../../lib/commentMentions");
    const privHandle = PRIV.replace(/_/g, "");
    const friendHandle = FRIEND.replace(/_/g, "");
    const mentions = await resolveCommentMentions(`hey @${privHandle} and @${friendHandle}`, VIEWER);
    expect(mentions.map((m) => m.userId)).toEqual([FRIEND]);

    const [story] = await db.insert(stories).values({
      authorId: PRIV, authorName: "Privy", media: [{ imageUri: "https://cdn.test/p.jpg" }],
      privacyReplyPerm: "off",
      expiresAt: new Date(Date.now() + 3_600_000),
    }).returning({ id: stories.id });
    const { storyReplyDenial } = await import("../../lib/privacySettings");
    const attachment = { type: "story_reply", meta: { storyId: story.id } };
    expect(await storyReplyDenial(VIEWER, [attachment])).toMatch(/story replies/);
    expect(await storyReplyDenial(PRIV, [attachment])).toBeNull();
    await call("/api/auth/privacy", { method: "PATCH", user: PRIV, body: { settings: { whoCanReplyToStories: "everyone" } } });
    // An explicit per-story choice wins over a later account-default change.
    expect(await storyReplyDenial(VIEWER, [attachment])).toMatch(/story replies/);
    await db.update(stories).set({ privacyReplyPerm: "everyone" }).where(eq(stories.id, story.id));
    expect(await storyReplyDenial(VIEWER, [attachment])).toBeNull();
  });
});
