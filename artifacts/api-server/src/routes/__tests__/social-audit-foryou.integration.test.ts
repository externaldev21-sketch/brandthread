import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";
import {
  blocks, buyerTasteProfiles, db, feedNotInterested, interactions, notificationBatchQueue, notificationsFeed, postCommentLikes,
  postComments, posts, rankingConfig, savedItems, stories, storyLikes, storyViews, users,
} from "@workspace/db";

const auth = vi.hoisted(() => ({ userId: "" }));
const published = vi.hoisted(() => ({ calls: [] as any[] }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = req.header("x-test-user-id") || auth.userId;
    next();
  },
  requireModerator: (req: any, res: any, next: () => void) => {
    if (req.header("x-test-admin") !== "1") { res.status(403).json({ error: "Moderator access required" }); return; }
    next();
  },
}));
vi.mock("../../lib/push", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/push")>();
  return { ...actual, sendPushToUser: async () => undefined };
});
vi.mock("../notifications-feed", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../notifications-feed")>();
  return {
    ...actual,
    // Records every publish but still writes the real feed row, so dedupe is exercised for real.
    publishNotification: async (n: any) => { published.calls.push(n); return actual.publishNotification(n); },
  };
});

const suffix = crypto.randomBytes(6).toString("hex");
const id = (n: string) => `saf-${n}-${suffix}`;
const owner = id("owner");
const viewer = id("viewer");
const blockedViewer = id("blocked");
const third = id("third");
const userIds = [owner, viewer, blockedViewer, third];

let server: Server;
let base = "";
let postId = "";
let hiddenCountPostId = "";
const createdPostIds: string[] = [];
const createdStoryIds: string[] = [];

async function req(path: string, userId: string, options: RequestInit & { admin?: boolean } = {}) {
  const { admin, ...init } = options;
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-test-user-id": userId,
      ...(admin ? { "x-test-admin": "1" } : {}),
      ...(init.headers ?? {}),
    },
  });
  return { status: response.status, body: (await response.json().catch(() => null)) as any };
}
const post = (path: string, userId: string, body: unknown = {}) =>
  req(path, userId, { method: "POST", body: JSON.stringify(body) });
const notesFor = (userId: string, type: string) => published.calls.filter((c) => c.userId === userId && c.type === type);
const until = async (fn: () => Promise<boolean>, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 50)); }
  return false;
};

async function makePost(over: Record<string, unknown> = {}) {
  const [p] = await db.insert(posts).values({
    userId: owner,
    mediaUrl: `https://cdn.example.test/${suffix}/${crypto.randomUUID()}.mp4`,
    mediaType: "video",
    caption: "fit",
    postStatus: "published",
    styleTags: ["streetwear"],
    ...over,
  } as any).returning({ id: posts.id });
  createdPostIds.push(p.id);
  return p.id;
}

beforeAll(async () => {
  await db.insert(users).values(userIds.map((u) => ({
    clerkId: u, email: `${u}@t.local`, name: u, username: u.replace(/-/g, "_"), role: "buyer", accountType: "buyer",
  })));
  await db.insert(blocks).values({ blockerId: owner, blockedId: blockedViewer });
  postId = await makePost();
  hiddenCountPostId = await makePost({ visibility: { isPublic: true, allowComments: true, allowReposts: true, showLikeCount: false } });

  const [{ default: postsRouter }, { default: commentsRouter }, { default: saved }, { default: social }, { default: feed }] =
    await Promise.all([
      import("../posts"), import("../post-comments"), import("../saved"), import("../social"), import("../feed"),
    ]);
  const app = express();
  app.use(express.json());
  // Mirrors Clerk's req auth for routes that only read the optional viewer (comment lists).
  app.use((req: any, _res, next) => { req.clerkUserId = req.header("x-test-user-id") || undefined; next(); });
  app.use("/api/posts", commentsRouter);
  app.use("/api/posts", postsRouter);
  app.use("/api/buyer/saved", saved);
  app.use("/api/social", social);
  app.use("/api/feed", feed);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (createdStoryIds.length) await db.delete(stories).where(inArray(stories.id, createdStoryIds));
  if (createdPostIds.length) {
    await db.delete(postComments).where(inArray(postComments.postId, createdPostIds));
    await db.delete(notificationsFeed).where(inArray(notificationsFeed.userId, userIds));
    await db.delete(savedItems).where(inArray(savedItems.targetId, createdPostIds));
    await db.delete(posts).where(inArray(posts.id, createdPostIds));
  }
  await db.delete(buyerTasteProfiles).where(inArray(buyerTasteProfiles.userId, userIds));
  await db.delete(notificationBatchQueue).where(eq(notificationBatchQueue.userId, owner));
  await db.delete(interactions).where(inArray(interactions.userId, userIds));
  await db.delete(blocks).where(eq(blocks.blockerId, owner));
  await db.delete(rankingConfig).where(eq(rankingConfig.key, "ranking_weights"));
  await db.delete(users).where(inArray(users.clerkId, userIds));
});

describe("POST /posts/:id/interact", () => {
  it("404s for a viewer blocked by the post owner (like, repost, share, view)", async () => {
    for (const type of ["like", "repost", "share", "view", "not_interested"]) {
      const r = await post(`/api/posts/${postId}/interact`, blockedViewer, { type });
      expect(r.status, type).toBe(404);
    }
    const rows = await db.select().from(interactions).where(eq(interactions.userId, blockedViewer));
    expect(rows).toHaveLength(0);
  });

  it("like is idempotent, counts once and notifies once through a single path", async () => {
    const a = await post(`/api/posts/${postId}/interact`, viewer, { type: "like" });
    const b = await post(`/api/posts/${postId}/interact`, viewer, { type: "like" });
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ action: "added", count: 1 });
    expect(b.body.count).toBe(1);
    await new Promise((r) => setTimeout(r, 300));
    expect(notesFor(owner, "post_like")).toHaveLength(1);
    const batched = await db.select().from(notificationBatchQueue).where(eq(notificationBatchQueue.userId, owner));
    expect(batched.filter((row) => row.type === "post_liked")).toHaveLength(0);

    const removed = await post(`/api/posts/${postId}/interact`, viewer, { type: "like", value: "remove" });
    expect(removed.body).toMatchObject({ action: "removed", count: 0 });
  });

  it("feeds the taste profile from a new like", async () => {
    await post(`/api/posts/${postId}/interact`, third, { type: "like" });
    const ok = await until(async () => {
      const [row] = await db.select().from(buyerTasteProfiles).where(eq(buyerTasteProfiles.userId, third));
      return !!row && (row.sellerAffinity as Record<string, number>)[owner] > 0;
    });
    expect(ok).toBe(true);
  });

  it("hides the like count from others when the owner turned it off, but not from the owner", async () => {
    const other = await post(`/api/posts/${hiddenCountPostId}/interact`, viewer, { type: "like" });
    expect(other.body.action).toBe("added");
    expect(other.body.count).toBeUndefined();
    const own = await post(`/api/posts/${hiddenCountPostId}/interact`, owner, { type: "like" });
    expect(own.body.count).toBe(2);
  });
});

describe("not interested", () => {
  it("persists a hide, excludes the post from For You candidates and can be undone", async () => {
    const target = await makePost({ userId: owner });
    const { computeForYouRankingForUser } = await import("../../lib/ranking/forYou");
    const ids = async () => (await computeForYouRankingForUser(third)).map((i) => i.postId);
    expect(await ids()).toContain(target);

    const r = await post(`/api/posts/${target}/interact`, third, { type: "not_interested" });
    expect(r.status).toBe(200);
    await post(`/api/posts/${target}/interact`, third, { type: "not_interested" });
    const rows = await db.select().from(feedNotInterested)
      .where(and(eq(feedNotInterested.userId, third), eq(feedNotInterested.postId, target)));
    expect(rows).toHaveLength(1);
    expect(rows[0].sellerId).toBe(owner);
    expect(await ids()).not.toContain(target);

    const undo = await req(`/api/feed/not-interested/${target}`, third, { method: "DELETE" });
    expect(undo.body).toMatchObject({ ok: true, removed: true });
    expect(await ids()).toContain(target);
  });

  it("downweights the seller affinity only once for repeated hides", async () => {
    const target = await makePost({ userId: owner });
    const before = await db.select().from(buyerTasteProfiles).where(eq(buyerTasteProfiles.userId, viewer));
    await post(`/api/posts/${target}/interact`, viewer, { type: "not_interested" });
    await post(`/api/posts/${target}/interact`, viewer, { type: "not_interested" });
    await until(async () => {
      const [row] = await db.select().from(buyerTasteProfiles).where(eq(buyerTasteProfiles.userId, viewer));
      return !!row && ((row.sellerAffinity as Record<string, number>)[owner] ?? 0) < 0;
    });
    const [after] = await db.select().from(buyerTasteProfiles).where(eq(buyerTasteProfiles.userId, viewer));
    const delta = (after.eventCount ?? 0) - (before[0]?.eventCount ?? 0);
    expect(delta).toBe(1);
  });
});

describe("POST /buyer/saved for posts", () => {
  it("rejects missing posts and blocked authors, accepts visible ones", async () => {
    const missing = await post("/api/buyer/saved", viewer, { type: "post", targetId: crypto.randomUUID(), title: "x" });
    expect(missing.status).toBe(404);
    const notUuid = await post("/api/buyer/saved", viewer, { type: "post", targetId: "nope", title: "x" });
    expect(notUuid.status).toBe(404);
    const blocked = await post("/api/buyer/saved", blockedViewer, { type: "post", targetId: postId, title: "x" });
    expect(blocked.status).toBe(404);
    const ok = await post("/api/buyer/saved", viewer, { type: "post", targetId: postId, title: "Fit" });
    expect(ok.status).toBe(201);
    const again = await post("/api/buyer/saved", viewer, { type: "post", targetId: postId, title: "Fit" });
    expect(again.status).toBe(200);
  });
});

describe("stories", () => {
  async function makeStory() {
    const r = await post("/api/social/stories", owner, { media: [{ type: "photo", imageUri: "https://img.test/a.jpg" }] });
    expect(r.status).toBe(201);
    createdStoryIds.push(r.body.id);
    return r.body.id as string;
  }

  it("caps media items per story", async () => {
    const media = Array.from({ length: 21 }, () => ({ type: "photo", imageUri: "https://img.test/a.jpg" }));
    const r = await post("/api/social/stories", owner, { media });
    expect(r.status).toBe(400);
  });

  it("keeps likes_count equal to story_likes rows under concurrent taps and toggles", async () => {
    const storyId = await makeStory();
    const likers = Array.from({ length: 6 }, (_, i) => id(`liker${i}`));
    await db.insert(users).values(likers.map((u) => ({ clerkId: u, email: `${u}@t.local`, name: u, role: "buyer", accountType: "buyer" })));
    try {
      await Promise.all(likers.map((u) => post(`/api/social/stories/${storyId}/like`, u)));
      // Same users tapping the heart again removes their like.
      await Promise.all(likers.slice(0, 2).map((u) => post(`/api/social/stories/${storyId}/like`, u)));
      const rows = await db.select().from(storyLikes).where(eq(storyLikes.storyId, storyId));
      const [s] = await db.select().from(stories).where(eq(stories.id, storyId));
      expect(rows).toHaveLength(4);
      expect(s.likesCount).toBe(4);

      const explicitRemove = await post(`/api/social/stories/${storyId}/like`, viewer, { liked: false });
      expect(explicitRemove.body).toMatchObject({ liked: false, likesCount: 4 });
    } finally {
      await db.delete(users).where(inArray(users.clerkId, likers));
    }
  });

  it("counts a view once per viewer even when posted concurrently", async () => {
    const storyId = await makeStory();
    await Promise.all([1, 2, 3, 4].map(() => post(`/api/social/stories/${storyId}/view`, viewer)));
    await post(`/api/social/stories/${storyId}/view`, third);
    const rows = await db.select().from(storyViews).where(eq(storyViews.storyId, storyId));
    const [s] = await db.select().from(stories).where(eq(stories.id, storyId));
    expect(rows).toHaveLength(2);
    expect(s.viewsCount).toBe(2);
  });

  it("blocks likes/views from a blocked viewer", async () => {
    const storyId = await makeStory();
    expect((await post(`/api/social/stories/${storyId}/like`, blockedViewer)).status).toBe(404);
    expect((await post(`/api/social/stories/${storyId}/view`, blockedViewer)).status).toBe(404);
  });
});

describe("comments", () => {
  it("total counts only rows the viewer can see and replies are capped with a cursor", async () => {
    const p = await makePost();
    const root = await post(`/api/posts/${p}/comments`, viewer, { body: "first!" });
    expect(root.status).toBe(201);
    const rootId = root.body.comment.id as string;
    const blockedComment = await db.insert(postComments).values({ postId: p, authorId: blockedViewer, body: "from blocked" }).returning();
    expect(blockedComment).toHaveLength(1);

    const now = Date.now();
    await db.insert(postComments).values(Array.from({ length: 55 }, (_, i) => ({
      postId: p, authorId: third, parentId: rootId, body: `reply ${i}`, createdAt: new Date(now + (i + 1) * 1000),
    })));

    // Owner blocked `blockedViewer`, so the owner must not see (or count) that comment.
    const asOwner = await req(`/api/posts/${p}/comments`, owner);
    expect(asOwner.status).toBe(200);
    expect(asOwner.body.total).toBe(1 + 55);
    expect(asOwner.body.comments).toHaveLength(1);
    const shownRoot = asOwner.body.comments[0];
    expect(shownRoot.replies).toHaveLength(50);
    expect(shownRoot.hasMoreReplies).toBe(true);
    expect(shownRoot.repliesNextCursor).toBe(shownRoot.replies[49].createdAt);

    const more = await req(`/api/posts/${p}/comments/${rootId}/replies?after=${encodeURIComponent(shownRoot.repliesNextCursor)}`, owner);
    expect(more.status).toBe(200);
    expect(more.body.replies).toHaveLength(5);
    expect(more.body.repliesNextCursor).toBeNull();
    expect(more.body.replies[0].body).toBe("reply 50");

    const signedOutTotal = await req(`/api/posts/${p}/comments`, blockedViewer);
    expect(signedOutTotal.status).toBe(404); // blocked viewer cannot open the owner's post comments
  });

  it("notifies a comment's author once when it is liked, never for self-likes", async () => {
    const p = await makePost();
    const c = await post(`/api/posts/${p}/comments`, viewer, { body: "nice fit" });
    const commentId = c.body.comment.id as string;

    const first = await post(`/api/posts/${p}/comments/${commentId}/like`, third, { liked: true });
    expect(first.body).toMatchObject({ liked: true, likesCount: 1 });
    await post(`/api/posts/${p}/comments/${commentId}/like`, third, { liked: true });
    await post(`/api/posts/${p}/comments/${commentId}/like`, third, { liked: false });
    await post(`/api/posts/${p}/comments/${commentId}/like`, third, { liked: true });
    await post(`/api/posts/${p}/comments/${commentId}/like`, viewer, { liked: true });
    await new Promise((r) => setTimeout(r, 300));

    const notes = published.calls.filter((n) => n.type === "comment_like" && n.commentId === commentId);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ userId: viewer, actorId: third, targetId: p, targetType: "post" });
    const likes = await db.select().from(postCommentLikes).where(eq(postCommentLikes.commentId, commentId));
    expect(likes).toHaveLength(2);
  });
});

describe("ranking config endpoints", () => {
  it("are moderator-only", async () => {
    expect((await req("/api/feed/ranking-config", viewer)).status).toBe(403);
    expect((await req("/api/feed/ranking-config", viewer, { method: "PUT", body: "{}" })).status).toBe(403);
  });

  it("validates, clamps, ignores unknown keys and persists", async () => {
    const put = await req("/api/feed/ranking-config", viewer, {
      admin: true,
      method: "PUT",
      body: JSON.stringify({
        scoreWeights: { affinity: 99999, engagement: 2.5, bogus: 1 },
        eventWeights: { like: "abc", share: 3, nonsense: 9 },
        explorationEvery: 1,
        junk: true,
      }),
    });
    expect(put.status).toBe(200);
    expect(put.body.config.scoreWeights.affinity).toBe(20);
    expect(put.body.config.scoreWeights.engagement).toBe(2.5);
    expect(put.body.config.scoreWeights.bogus).toBeUndefined();
    expect(put.body.config.eventWeights.like).toBe(1.5);
    expect(put.body.config.eventWeights.share).toBe(3);
    expect(put.body.config.explorationEvery).toBe(2);

    const got = await req("/api/feed/ranking-config", viewer, { admin: true });
    expect(got.status).toBe(200);
    expect(got.body.config.scoreWeights.engagement).toBe(2.5);
    expect(got.body.defaults.scoreWeights.engagement).toBe(1.5);

    const [row] = await db.select().from(rankingConfig).where(eq(rankingConfig.key, "ranking_weights"));
    expect((row.value as any).scoreWeights.engagement).toBe(2.5);

    // A corrupt stored row degrades to defaults instead of throwing.
    await db.update(rankingConfig).set({ value: "garbage" as any }).where(eq(rankingConfig.key, "ranking_weights"));
    const { invalidateRankingConfigCache, getRankingConfig, DEFAULT_RANKING_CONFIG } = await import("../../lib/ranking/config");
    invalidateRankingConfigCache();
    expect(await getRankingConfig()).toEqual(DEFAULT_RANKING_CONFIG);
  });
});
