import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  db, interactions, notificationsFeed, posts, postUserTags, savedItems, stories, users,
} from "@workspace/db";

/**
 * Items 79-83: caption @mentions become post_user_tags rows (profile
 * "Tagged" tab) and a "tagged you" notification once the post is live;
 * caption edits re-sync tags; GET /api/posts/:id reports the viewer's own
 * like / save; the story archive lists expired stories not yet cleaned up.
 */

vi.mock("../../lib/push", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/push")>();
  return { ...actual, sendPushToUser: async () => true };
});

const suffix = crypto.randomBytes(5).toString("hex");
const author = `tags-author-${suffix}`;
const alice = `tags-alice-${suffix}`;
const bob = `tags-bob-${suffix}`;
const aliceHandle = `alice${suffix}`;
const bobHandle = `bob${suffix}`;
const ids = [author, alice, bob];
const authState = vi.hoisted(() => ({ clerkUserId: "" }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = authState.clerkUserId;
    next();
  },
}));

let server: Server;
let base = "";

async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
  return { status: response.status, body: await response.json() as any };
}

async function tagsOf(postId: string) {
  const rows = await db.select({ taggedUserId: postUserTags.taggedUserId })
    .from(postUserTags).where(eq(postUserTags.postId, postId));
  return rows.map((r) => r.taggedUserId).sort();
}

async function tagNotifications(postId: string) {
  const rows = await db.select({ userId: notificationsFeed.userId }).from(notificationsFeed)
    .where(and(eq(notificationsFeed.type, "post_tag"), eq(notificationsFeed.targetId, postId)));
  return rows.map((r) => r.userId).sort();
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: author, email: `${author}@test.local`, name: "Tag Author", displayName: "Tag Author", username: `author${suffix}`, role: "buyer", accountType: "buyer" },
    { clerkId: alice, email: `${alice}@test.local`, name: "Alice", displayName: "Alice", username: aliceHandle, role: "buyer", accountType: "buyer" },
    { clerkId: bob, email: `${bob}@test.local`, name: "Bob", displayName: "Bob", username: bobHandle, role: "buyer", accountType: "buyer" },
  ]);
  const [{ default: postsRouter }, { default: highlightsRouter }] = await Promise.all([
    import("../posts"),
    import("../story-highlights"),
  ]);
  const app = express();
  app.use(express.json());
  // GET /api/posts/:id has no requireAuth; mimic the global auth middleware.
  app.use((req: any, _res, next) => { if (authState.clerkUserId) req.clerkUserId = authState.clerkUserId; next(); });
  app.use("/api/posts", postsRouter);
  app.use("/api/social", highlightsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(notificationsFeed).where(inArray(notificationsFeed.userId, ids));
  await db.delete(savedItems).where(inArray(savedItems.userId, ids));
  await db.delete(interactions).where(inArray(interactions.userId, ids));
  await db.delete(stories).where(inArray(stories.authorId, ids));
  await db.delete(posts).where(inArray(posts.userId, ids));
  await db.delete(users).where(inArray(users.clerkId, ids));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("post user tags from caption mentions", () => {
  it("tags mentioned people on publish and notifies them once", async () => {
    authState.clerkUserId = author;
    const res = await request("/api/posts", {
      method: "POST",
      body: JSON.stringify({
        mediaType: "photo", mediaUrls: ["https://cdn.test/tag-1.jpg"],
        caption: `fit check with @${aliceHandle} and @nobody${suffix} and @author${suffix}`,
      }),
    });
    expect(res.status).toBe(201);
    const postId = res.body.id as string;
    // Unknown handles and self-mentions are dropped.
    expect(await tagsOf(postId)).toEqual([alice]);
    expect(await tagNotifications(postId)).toEqual([alice]);

    // Editing the caption: Alice untagged, Bob tagged; Alice is never re-notified.
    const patched = await request(`/api/posts/${postId}`, {
      method: "PATCH",
      body: JSON.stringify({ caption: `now with @${bobHandle}` }),
    });
    expect(patched.status).toBe(200);
    expect(await tagsOf(postId)).toEqual([bob]);
    expect(await tagNotifications(postId)).toEqual([alice, bob].sort());

    // A second edit that keeps Bob does not notify him twice.
    await request(`/api/posts/${postId}`, {
      method: "PATCH",
      body: JSON.stringify({ caption: `still @${bobHandle}` }),
    });
    expect(await tagNotifications(postId)).toEqual([alice, bob].sort());
  });

  it("saves tags on a draft but only notifies once it is published", async () => {
    authState.clerkUserId = author;
    const res = await request("/api/posts", {
      method: "POST",
      body: JSON.stringify({
        mediaType: "photo", mediaUrls: ["https://cdn.test/tag-2.jpg"],
        caption: `draft for @${aliceHandle}`, isDraft: true,
      }),
    });
    expect(res.status).toBe(201);
    const postId = res.body.id as string;
    expect(await tagsOf(postId)).toEqual([alice]);
    expect(await tagNotifications(postId)).toEqual([]);

    const published = await request(`/api/posts/${postId}`, {
      method: "PATCH",
      body: JSON.stringify({ isDraft: false }),
    });
    expect(published.status).toBe(200);
    expect(published.body.postStatus).toBe("published");
    expect(await tagNotifications(postId)).toEqual([alice]);
  });

  it("archived posts don't notify newly tagged people until restored", async () => {
    authState.clerkUserId = author;
    const res = await request("/api/posts", {
      method: "POST",
      body: JSON.stringify({ mediaType: "photo", mediaUrls: ["https://cdn.test/tag-3.jpg"], caption: "plain" }),
    });
    const postId = res.body.id as string;
    await request(`/api/posts/${postId}`, { method: "PATCH", body: JSON.stringify({ postStatus: "archived" }) });
    await request(`/api/posts/${postId}`, { method: "PATCH", body: JSON.stringify({ caption: `hi @${bobHandle}` }) });
    expect(await tagsOf(postId)).toEqual([bob]);
    expect(await tagNotifications(postId)).toEqual([]);

    const mine = await request("/api/posts/mine?status=archived");
    expect(mine.body.map((p: any) => p.id)).toContain(postId);

    await request(`/api/posts/${postId}`, { method: "PATCH", body: JSON.stringify({ postStatus: "published" }) });
    expect(await tagNotifications(postId)).toEqual([bob]);
  });
});

describe("GET /api/posts/:id viewer state", () => {
  it("reports likedByMe / savedByMe for the signed-in viewer only", async () => {
    const [post] = await db.insert(posts).values({
      userId: author, mediaUrl: "https://cdn.test/state.jpg", mediaType: "photo", caption: "state",
      postStatus: "published", surface: "thread",
    }).returning({ id: posts.id });

    authState.clerkUserId = alice;
    let res = await request(`/api/posts/${post.id}`);
    expect(res.status).toBe(200);
    expect(res.body.likedByMe).toBe(false);
    expect(res.body.savedByMe).toBe(false);

    await db.insert(interactions).values({ userId: alice, postId: post.id, type: "like" });
    await db.insert(savedItems).values({ userId: alice, itemType: "post", targetId: post.id, title: "state" });
    res = await request(`/api/posts/${post.id}`);
    expect(res.body.likedByMe).toBe(true);
    expect(res.body.savedByMe).toBe(true);
    expect(res.body.likeCount).toBe(1);

    authState.clerkUserId = bob;
    res = await request(`/api/posts/${post.id}`);
    expect(res.body.likedByMe).toBe(false);
    expect(res.body.savedByMe).toBe(false);
  });
});

describe("GET /api/social/highlights/stories", () => {
  it("lists an expired story the cleanup job hasn't archived yet as archived", async () => {
    const now = Date.now();
    const [live] = await db.insert(stories).values({
      authorId: author, authorName: "Tag Author", media: [{ url: "https://cdn.test/live.jpg" }],
      expiresAt: new Date(now + 60 * 60_000),
    }).returning({ id: stories.id });
    const [expired] = await db.insert(stories).values({
      authorId: author, authorName: "Tag Author", media: [{ url: "https://cdn.test/old.jpg" }],
      createdAt: new Date(now - 25 * 60 * 60_000), expiresAt: new Date(now - 60 * 60_000),
    }).returning({ id: stories.id });

    authState.clerkUserId = author;
    const res = await request("/api/social/highlights/stories");
    expect(res.status).toBe(200);
    const byId = new Map(res.body.map((s: any) => [s.storyId, s]));
    expect((byId.get(live.id) as any)?.live).toBe(true);
    expect((byId.get(expired.id) as any)?.live).toBe(false);
    expect((byId.get(expired.id) as any)?.thumbnailUrl).toBe("https://cdn.test/old.jpg");
  });
});
