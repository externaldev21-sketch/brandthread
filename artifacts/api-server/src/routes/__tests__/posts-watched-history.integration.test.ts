import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { and, eq, inArray, or } from "drizzle-orm";
import {
  blocks,
  db,
  follows,
  interactions,
  posts,
  users,
} from "@workspace/db";

const PREFIX = `watched-history-${process.pid}-${crypto.randomUUID()}`;
const createdUsers: string[] = [];
const createdPostIds: string[] = [];
const createdInteractionUsers: string[] = [];
const createdFollowUserIds: string[] = [];
const createdBlockUserIds: string[] = [];

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const viewerId = req.headers["x-test-viewer"];
    if (typeof viewerId !== "string") {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.clerkUserId = viewerId;
    next();
  },
}));

let server: Server;
let baseUrl = "";

async function seedUsers(ids: string[]) {
  await db.insert(users).values(ids.map((clerkId) => ({
    clerkId,
    email: `${clerkId}@example.test`,
    name: clerkId,
    displayName: clerkId,
    accountType: "buyer",
    onboardingComplete: true,
  })));
  createdUsers.push(...ids);
}

async function seedVideoPosts(authors: string[], captions = authors) {
  const inserted = await db.insert(posts).values(authors.map((userId, index) => ({
    userId,
    mediaUrl: `https://cdn.example.test/${PREFIX}-${createdPostIds.length + index}.mp4`,
    thumbnailUrl: `https://api.example.test/api/posts/media/uploads/${PREFIX}-${createdPostIds.length + index}.jpg`,
    mediaType: "video",
    caption: captions[index] ?? null,
    postStatus: "published",
    moderationStatus: "visible",
    visibility: { isPublic: true, allowComments: true, allowReposts: true, showLikeCount: true },
  }))).returning({ id: posts.id });
  createdPostIds.push(...inserted.map((row) => row.id));
  return inserted.map((row) => row.id);
}

async function recordWatched(viewerId: string, postIds: string[], times: Date[]) {
  await db.insert(interactions).values(postIds.map((postId, index) => ({
    userId: viewerId,
    postId,
    type: "video_watched",
    createdAt: times[index],
  })));
  createdInteractionUsers.push(viewerId);
}

async function actingAs(viewerId: string, path: string, init: RequestInit = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      "x-test-viewer": viewerId,
      "Content-Type": "application/json",
    },
  });
}

function newId(label: string) {
  const id = `${PREFIX}-${label}`;
  return id;
}

beforeAll(async () => {
  const { default: postsRouter } = await import("../posts");
  const app = express();
  app.use(express.json());
  app.use("/api/posts", postsRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  if (createdInteractionUsers.length) {
    await db.delete(interactions).where(inArray(interactions.userId, [...new Set(createdInteractionUsers)]));
    createdInteractionUsers.length = 0;
  }
  if (createdPostIds.length) {
    await db.delete(posts).where(inArray(posts.id, createdPostIds));
    createdPostIds.length = 0;
  }
  if (createdFollowUserIds.length) {
    await db.delete(follows).where(or(
      inArray(follows.followerId, [...new Set(createdFollowUserIds)]),
      inArray(follows.followingId, [...new Set(createdFollowUserIds)]),
    ));
    createdFollowUserIds.length = 0;
  }
  if (createdBlockUserIds.length) {
    await db.delete(blocks).where(or(
      inArray(blocks.blockerId, [...new Set(createdBlockUserIds)]),
      inArray(blocks.blockedId, [...new Set(createdBlockUserIds)]),
    ));
    createdBlockUserIds.length = 0;
  }
  if (createdUsers.length) {
    await db.delete(users).where(inArray(users.clerkId, createdUsers));
    createdUsers.length = 0;
  }
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

describe("POST /api/posts/:id/watched and GET /api/posts/watched-videos", () => {
  it("enforces the rolling 36-hour boundary and returns the normalized media URL", async () => {
    const viewer = newId("viewer");
    const author = newId("friend");
    await seedUsers([viewer, author]);
    await db.insert(follows).values([
      { followerId: viewer, followingId: author },
      { followerId: author, followingId: viewer },
    ]);
    createdFollowUserIds.push(viewer, author);

    const [insideId, outsideId] = await seedVideoPosts([author, author], ["inside", "outside"]);
    const now = Date.now();
    await recordWatched(viewer, [insideId, outsideId], [
      new Date(now - 36 * 60 * 60 * 1000 + 5_000),
      new Date(now - 36 * 60 * 60 * 1000 - 5_000),
    ]);

    const response = await actingAs(viewer, "/api/posts/watched-videos");
    expect(response.status).toBe(200);
    const body = await response.json() as {
      items: Array<{ postId: string; caption: string; thumbnailUrl: string; watchedAt: string }>;
      nextCursor: string | null;
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      postId: insideId,
      caption: "inside",
      thumbnailUrl: `${baseUrl}/api/posts/media/uploads/${PREFIX}-0.jpg`,
    });
    expect(body.items[0].watchedAt).toBeTruthy();
    expect(body.nextCursor).toBeNull();
  });

  it("keyset-paginates a 51-item history in stable newest-first order", async () => {
    const viewer = newId("page-viewer");
    const friend = newId("page-friend");
    await seedUsers([viewer, friend]);
    await db.insert(follows).values([
      { followerId: viewer, followingId: friend },
      { followerId: friend, followingId: viewer },
    ]);
    createdFollowUserIds.push(viewer, friend);

    const postIds = await seedVideoPosts(Array.from({ length: 51 }, () => friend));
    const start = Date.now() - 60_000;
    await recordWatched(viewer, postIds, postIds.map((_, index) => new Date(start + index * 1_000)));

    const firstResponse = await actingAs(viewer, "/api/posts/watched-videos");
    expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json() as {
      items: Array<{ postId: string }>;
      nextCursor: string | null;
    };
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).toBeTruthy();

    const secondResponse = await actingAs(viewer, `/api/posts/watched-videos?cursor=${encodeURIComponent(first.nextCursor!)}`);
    expect(secondResponse.status).toBe(200);
    const second = await secondResponse.json() as {
      items: Array<{ postId: string }>;
      nextCursor: string | null;
    };
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((item) => item.postId)).size).toBe(51);
    expect(first.items[0].postId).toBe(postIds[50]);
    expect(second.items[0].postId).toBe(postIds[0]);

    const malformed = await actingAs(viewer, "/api/posts/watched-videos?cursor=not-a-valid-cursor");
    expect(malformed.status).toBe(400);
  });

  it("shows own and mutual-friend buyer videos, but filters one-way, blocked, and newly hidden posts", async () => {
    const viewer = newId("privacy-viewer");
    const mutual = newId("mutual");
    const oneWay = newId("one-way");
    const blockedByViewer = newId("blocked-by-viewer");
    const blockedViewer = newId("blocked-viewer");
    await seedUsers([viewer, mutual, oneWay, blockedByViewer, blockedViewer]);
    await db.insert(follows).values([
      { followerId: viewer, followingId: mutual },
      { followerId: mutual, followingId: viewer },
      { followerId: viewer, followingId: oneWay },
    ]);
    createdFollowUserIds.push(viewer, mutual, oneWay);
    await db.insert(blocks).values([
      { blockerId: viewer, blockedId: blockedByViewer },
      { blockerId: blockedViewer, blockedId: viewer },
    ]);
    createdBlockUserIds.push(viewer, blockedByViewer, blockedViewer);

    const [ownId, friendId, oneWayId, blockedByViewerId, blockedViewerId, hiddenId] =
      await seedVideoPosts([viewer, mutual, oneWay, blockedByViewer, blockedViewer, mutual]);
    await db.update(posts).set({ moderationStatus: "held" }).where(eq(posts.id, hiddenId));
    await recordWatched(viewer, [ownId, friendId, oneWayId, blockedByViewerId, blockedViewerId, hiddenId],
      Array.from({ length: 6 }, (_, index) => new Date(Date.now() - index * 1_000)));

    const response = await actingAs(viewer, "/api/posts/watched-videos");
    expect(response.status).toBe(200);
    const body = await response.json() as { items: Array<{ postId: string }> };
    expect(new Set(body.items.map((item) => item.postId))).toEqual(new Set([ownId, friendId]));

    const deniedRecord = await actingAs(viewer, `/api/posts/${oneWayId}/watched`, { method: "POST" });
    expect(deniedRecord.status).toBe(404);
    const unauthorized = await fetch(`${baseUrl}/api/posts/watched-videos`);
    expect(unauthorized.status).toBe(401);
  });

  it("upserts a single deterministic watch row and moves it to the latest watch time", async () => {
    const viewer = newId("rewatch-viewer");
    await seedUsers([viewer]);
    const [videoId] = await seedVideoPosts([viewer]);
    const oldWatch = new Date(Date.now() - 60_000);
    await recordWatched(viewer, [videoId], [oldWatch]);
    await db.update(interactions).set({ clientEventId: `video-watched:${videoId}` })
      .where(and(
        eq(interactions.userId, viewer),
        eq(interactions.postId, videoId),
        eq(interactions.type, "video_watched"),
      ));

    const first = await actingAs(viewer, `/api/posts/${videoId}/watched`, { method: "POST" });
    expect(first.status).toBe(200);
    const firstBody = await first.json() as { watchedAt: string };
    const second = await actingAs(viewer, `/api/posts/${videoId}/watched`, { method: "POST" });
    expect(second.status).toBe(200);
    const secondBody = await second.json() as { watchedAt: string };
    expect(new Date(secondBody.watchedAt).getTime()).toBeGreaterThanOrEqual(new Date(firstBody.watchedAt).getTime());

    const rows = await db.select({
      id: interactions.id,
      createdAt: interactions.createdAt,
      clientEventId: interactions.clientEventId,
    }).from(interactions).where(and(
      eq(interactions.userId, viewer),
      eq(interactions.postId, videoId),
      eq(interactions.type, "video_watched"),
    ));
    expect(rows).toHaveLength(1);
    expect(rows[0].clientEventId).toBe(`video-watched:${videoId}`);
    expect(rows[0].createdAt.getTime()).toBeGreaterThan(oldWatch.getTime());
  });
});