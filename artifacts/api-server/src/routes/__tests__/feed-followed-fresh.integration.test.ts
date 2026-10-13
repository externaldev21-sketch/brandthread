import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { inArray, or } from "drizzle-orm";
import { blocks, db, feedNotInterested, follows, interactions, posts, users } from "@workspace/db";

const PREFIX = `followed-fresh-${process.pid}-${crypto.randomUUID()}`;
const createdUsers: string[] = [];

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

const id = (label: string) => `${PREFIX}-${label}`;

async function seedUser(clerkId: string, accountType: "buyer" | "seller") {
  await db.insert(users).values({
    clerkId,
    email: `${clerkId}@example.test`,
    name: clerkId,
    displayName: clerkId,
    brandName: accountType === "seller" ? `Brand ${clerkId.slice(-1)}` : null,
    accountType,
    onboardingComplete: true,
  });
  createdUsers.push(clerkId);
}

async function follow(followerId: string, followingIds: string[]) {
  await db.insert(follows).values(followingIds.map((followingId) => ({ followerId, followingId })));
}

/** One published, public Thread post `hoursAgo` hours old. */
async function post(userId: string, hoursAgo: number, caption = "", surface = "thread") {
  const [row] = await db.insert(posts).values({
    userId,
    mediaUrl: `https://cdn.example.test/${PREFIX}-${crypto.randomUUID()}.mp4`,
    mediaType: "video",
    caption,
    surface,
    postStatus: "published",
    moderationStatus: "visible",
    visibility: { isPublic: true, allowComments: true, allowReposts: true, showLikeCount: true },
    createdAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000),
  }).returning({ id: posts.id });
  return row.id;
}

async function fetchFresh(viewerId: string | null, query = "") {
  const response = await fetch(`${baseUrl}/api/feed/followed-fresh${query}`, {
    headers: viewerId ? { "x-test-viewer": viewerId } : {},
  });
  return { status: response.status, body: response.status === 200 ? await response.json() as any[] : null };
}

beforeAll(async () => {
  const { default: router } = await import("../feed-followed-fresh");
  const app = express();
  app.use("/api/feed", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  if (createdUsers.length === 0) return;
  await db.delete(interactions).where(inArray(interactions.userId, createdUsers));
  await db.delete(feedNotInterested).where(inArray(feedNotInterested.userId, createdUsers));
  await db.delete(posts).where(inArray(posts.userId, createdUsers));
  await db.delete(follows).where(or(inArray(follows.followerId, createdUsers), inArray(follows.followingId, createdUsers)));
  await db.delete(blocks).where(or(inArray(blocks.blockerId, createdUsers), inArray(blocks.blockedId, createdUsers)));
  await db.delete(users).where(inArray(users.clerkId, createdUsers));
  createdUsers.length = 0;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

describe("GET /api/feed/followed-fresh", () => {
  it("requires a signed-in viewer", async () => {
    expect((await fetchFresh(null)).status).toBe(401);
  });

  it("returns only recent posts from followed brand accounts", async () => {
    const viewer = id("viewer");
    const brandA = id("brand-a");
    const brandOther = id("brand-x");
    const buyerFriend = id("buyer-f");
    await seedUser(viewer, "buyer");
    await seedUser(brandA, "seller");
    await seedUser(brandOther, "seller");
    await seedUser(buyerFriend, "buyer");
    await follow(viewer, [brandA, buyerFriend]);

    const fresh = await post(brandA, 1, "fresh");
    const edge = await post(brandA, 71, "inside window");
    await post(brandA, 73, "too old");
    await post(brandA, 2, "profile only", "profile");
    await post(brandOther, 1, "not followed");
    await post(buyerFriend, 1, "buyer post");

    const { status, body } = await fetchFresh(viewer);
    expect(status).toBe(200);
    expect(body!.map((p) => p.id)).toEqual([fresh, edge]);
    expect(body![0]).toMatchObject({
      userId: brandA,
      caption: "fresh",
      mediaType: "video",
      seller: { brandName: "Brand a" },
      taggedProducts: [],
      likesCount: 0,
      commentsCount: 0,
    });

    // A narrower window drops the 71h post.
    const narrow = await fetchFresh(viewer, "?hours=24");
    expect(narrow.body!.map((p) => p.id)).toEqual([fresh]);
  });

  it("skips posts the viewer already watched or marked not interested", async () => {
    const viewer = id("viewer");
    const brandA = id("brand-a");
    await seedUser(viewer, "buyer");
    await seedUser(brandA, "seller");
    await follow(viewer, [brandA]);
    const watched = await post(brandA, 1);
    const hidden = await post(brandA, 2);
    const unseen = await post(brandA, 3);
    await db.insert(interactions).values({ userId: viewer, postId: watched, type: "video_watched" });
    await db.insert(feedNotInterested).values({ userId: viewer, postId: hidden, sellerId: brandA });

    const { body } = await fetchFresh(viewer);
    expect(body!.map((p) => p.id)).toEqual([unseen]);
  });

  it("excludes brands blocked in either direction", async () => {
    const viewer = id("viewer");
    const blockedByViewer = id("brand-b");
    const blockerBrand = id("brand-c");
    const ok = id("brand-a");
    await seedUser(viewer, "buyer");
    await seedUser(blockedByViewer, "seller");
    await seedUser(blockerBrand, "seller");
    await seedUser(ok, "seller");
    await follow(viewer, [blockedByViewer, blockerBrand, ok]);
    await post(blockedByViewer, 1);
    await post(blockerBrand, 1);
    const visible = await post(ok, 2);
    await db.insert(blocks).values([
      { blockerId: viewer, blockedId: blockedByViewer },
      { blockerId: blockerBrand, blockedId: viewer },
    ]);

    const { body } = await fetchFresh(viewer);
    expect(body!.map((p) => p.id)).toEqual([visible]);
  });

  it("orders newest first with at most two posts in a row per brand", async () => {
    const viewer = id("viewer");
    const brandA = id("brand-a");
    const brandB = id("brand-b");
    await seedUser(viewer, "buyer");
    await seedUser(brandA, "seller");
    await seedUser(brandB, "seller");
    await follow(viewer, [brandA, brandB]);
    const a1 = await post(brandA, 1);
    const a2 = await post(brandA, 2);
    const a3 = await post(brandA, 3);
    const a4 = await post(brandA, 4);
    const b1 = await post(brandB, 5);
    const b2 = await post(brandB, 6);

    const { body } = await fetchFresh(viewer);
    expect(body!.map((p) => p.id)).toEqual([a1, a2, b1, a3, a4, b2]);

    const limited = await fetchFresh(viewer, "?limit=3");
    expect(limited.body!.map((p) => p.id)).toEqual([a1, a2, b1]);
  });
});
