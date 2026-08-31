import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, interactions, orders, posts, users } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const suffix = crypto.randomBytes(6).toString("hex");
const sellerA = `seller-profile-a-${suffix}`;
const sellerB = `seller-profile-b-${suffix}`;
const sellerWithoutLikes = `seller-profile-no-likes-${suffix}`;
const postIds: string[] = [];
const authState = vi.hoisted(() => ({
  clerkUserId: "",
}));

const storageState = vi.hoisted(() => ({
  objectPath: "/objects/uploads/avatar-normalized",
  signedUrlPrefix: "https://storage.test",
  created: [] as Array<{ bytes: Buffer; contentType: string }>,
  acl: [] as Array<{ path: string; owner: string; visibility: string }>,
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    if (!authState.clerkUserId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.clerkUserId = authState.clerkUserId;
    next();
  },
}));

vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class {
    async createObjectEntityFromBuffer(bytes: Buffer, contentType: string) {
      storageState.created.push({ bytes, contentType });
      return storageState.objectPath;
    }
    async trySetObjectEntityAclPolicy(
      path: string,
      policy: { owner: string; visibility: string },
    ) {
      storageState.acl.push({ path, owner: policy.owner, visibility: policy.visibility });
      return path;
    }
    async getObjectEntityDownloadURL(path: string) {
      return `${storageState.signedUrlPrefix}${path}`;
    }
    async deleteObjectEntity() {}
  },
}));

let server: Server;
let base = "";
const orderIds: string[] = [];

beforeAll(async () => {
  await db.insert(users).values([
    {
      clerkId: sellerA,
      email: `${sellerA}@test.local`,
      name: "Seller Profile A",
      displayName: "Seller A",
      role: "seller",
      accountType: "seller",
      storefrontVisitCount: 4,
      avatarUrl: "https://images.clerk.test/seller-a.jpg",
    },
    {
      clerkId: sellerB,
      email: `${sellerB}@test.local`,
      name: "Seller Profile B",
      displayName: "Seller B",
      role: "seller",
      accountType: "seller",
    },
    {
      clerkId: sellerWithoutLikes,
      email: `${sellerWithoutLikes}@test.local`,
      name: "Seller Profile Without Likes",
      displayName: "Seller Without Likes",
      role: "seller",
      accountType: "seller",
    },
  ]);

  const metricOrders = await db.insert(orders).values([
    {
      ownerId: sellerA,
      buyerId: "buyer-paid",
      orderNumber: `${suffix}-paid`,
      status: "fulfilled",
      totalCents: 12_345,
      subtotalCents: 12_345,
      stripeCheckoutSessionId: `${suffix}-paid-session`,
    },
    {
      ownerId: sellerA,
      buyerId: "buyer-cancelled",
      orderNumber: `${suffix}-cancelled`,
      status: "cancelled",
      totalCents: 2_000,
      subtotalCents: 2_000,
      stripeCheckoutSessionId: `${suffix}-cancelled-session`,
    },
    {
      ownerId: sellerA,
      buyerId: "buyer-refund-pending",
      orderNumber: `${suffix}-refund-pending`,
      status: "refund_pending",
      totalCents: 3_000,
      subtotalCents: 3_000,
      stripeCheckoutSessionId: `${suffix}-refund-pending-session`,
    },
    {
      ownerId: sellerA,
      buyerId: "buyer-refunded",
      orderNumber: `${suffix}-refunded`,
      status: "refunded",
      totalCents: 4_000,
      subtotalCents: 4_000,
      stripeCheckoutSessionId: `${suffix}-refunded-session`,
    },
  ]).returning({ id: orders.id });
  orderIds.push(...metricOrders.map((order) => order.id));

  const [sellerAPost, sellerASecondPost, sellerBPost] = await db
    .insert(posts)
    .values([
      { userId: sellerA, mediaUrl: "https://example.com/seller-a-1.jpg" },
      { userId: sellerA, mediaUrl: "https://example.com/seller-a-2.jpg" },
      { userId: sellerB, mediaUrl: "https://example.com/seller-b-1.jpg" },
    ])
    .returning({ id: posts.id });
  postIds.push(sellerAPost.id, sellerASecondPost.id, sellerBPost.id);

  await db.insert(interactions).values([
    { userId: "buyer-1", postId: sellerAPost.id, type: "like" },
    { userId: "buyer-2", postId: sellerASecondPost.id, type: "like" },
    { userId: "buyer-3", postId: sellerAPost.id, type: "comment", value: "Nice look!" },
    { userId: "buyer-4", postId: sellerBPost.id, type: "like" },
  ]);

  authState.clerkUserId = sellerA;
  const [{ default: sellerProfileRouter }, { default: postsRouter }] = await Promise.all([
    import("../seller-profile"),
    import("../posts"),
  ]);
  const app = express();
  app.use(express.json());
  app.use("/api/seller", sellerProfileRouter);
  app.use("/api/posts", postsRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(orders).where(inArray(orders.id, orderIds));
  await db.delete(interactions).where(inArray(interactions.postId, postIds));
  await db.delete(posts).where(inArray(posts.id, postIds));
  await db.delete(users).where(
    inArray(users.clerkId, [sellerA, sellerB, sellerWithoutLikes]),
  );
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function getProfile() {
  const response = await fetch(`${base}/api/seller/profile`);
  return {
    status: response.status,
    body: await response.json() as {
      totalLikes: number;
      profileImageUrl: string | null;
      avatarUrl: string | null;
      metrics: {
        revenueCents: number;
        visitors: number;
        orders: number;
        conversionRate: number;
      };
    },
  };
}

describe("seller profile likes metric", () => {
  it("counts only likes on the authenticated seller's posts", async () => {
    authState.clerkUserId = sellerA;

    const result = await getProfile();

    expect(result.status).toBe(200);
    expect(result.body.totalLikes).toBe(2);
  });

  it("returns zero when the authenticated seller has no likes", async () => {
    authState.clerkUserId = sellerWithoutLikes;

    const result = await getProfile();

    expect(result.status).toBe(200);
    expect(result.body.totalLikes).toBe(0);
  });

  it("keeps repeated and concurrent likes idempotent in the seller total", async () => {
    const repeatedActor = `buyer-repeated-like-${suffix}`;
    const concurrentActor = `buyer-concurrent-like-${suffix}`;
    const postId = postIds[0];

    authState.clerkUserId = repeatedActor;
    const repeatedResponses = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      repeatedResponses.push(await fetch(`${base}/api/posts/${postId}/interact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "like" }),
      }));
    }
    expect(repeatedResponses.every((response) => response.status === 200)).toBe(true);

    authState.clerkUserId = concurrentActor;
    const concurrentResponses = await Promise.all(
      Array.from({ length: 8 }, () =>
        fetch(`${base}/api/posts/${postId}/interact`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "like" }),
        }),
      ),
    );
    expect(concurrentResponses.every((response) => response.status === 200)).toBe(true);

    const likeRows = await db
      .select({ userId: interactions.userId })
      .from(interactions)
      .where(eq(interactions.postId, postId));
    expect(likeRows.filter((row) => row.userId === repeatedActor)).toHaveLength(1);
    expect(likeRows.filter((row) => row.userId === concurrentActor)).toHaveLength(1);

    authState.clerkUserId = sellerA;
    const result = await getProfile();
    expect(result.status).toBe(200);
    expect(result.body.totalLikes).toBe(4);
  });
});

describe("seller profile identity and performance regressions", () => {
  it("rejects an avatar upload when there is no authenticated seller", async () => {
    authState.clerkUserId = "";
    const response = await fetch(`${base}/api/seller/profile/avatar/upload`, {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    });

    expect(response.status).toBe(401);
    expect(storageState.created).toHaveLength(0);
  });

  it("rejects an image whose bytes do not match the declared avatar type", async () => {
    authState.clerkUserId = sellerA;
    const response = await fetch(`${base}/api/seller/profile/avatar/upload`, {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: Buffer.from("not a png"),
    });

    expect(response.status).toBe(400);
    expect(storageState.created).toHaveLength(0);
  });

  it("persists only the normalized private object path after a valid upload", async () => {
    authState.clerkUserId = sellerA;
    storageState.created = [];
    storageState.acl = [];
    storageState.objectPath = "/objects/uploads/avatar-normalized";
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);

    const response = await fetch(`${base}/api/seller/profile/avatar/upload`, {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: png,
    });
    const body = await response.json() as { profileImageUrl: string };
    const [saved] = await db
      .select({ profileImageUrl: users.profileImageUrl })
      .from(users)
      .where(eq(users.clerkId, sellerA));

    expect(response.status).toBe(201);
    expect(body.profileImageUrl).toBe("https://storage.test/objects/uploads/avatar-normalized");
    expect(saved.profileImageUrl).toBe("/objects/uploads/avatar-normalized");
    expect(storageState.created).toEqual([{ bytes: png, contentType: "image/png" }]);
    expect(storageState.acl).toEqual([{
      path: "/objects/uploads/avatar-normalized",
      owner: sellerA,
      visibility: "private",
    }]);
  });

  it("prefers the custom avatar, then Clerk's avatar, and leaves the UI to show initials otherwise", async () => {
    authState.clerkUserId = sellerA;

    await db.update(users)
      .set({ profileImageUrl: "/objects/uploads/custom-avatar", avatarUrl: "https://images.clerk.test/fallback.jpg" })
      .where(eq(users.clerkId, sellerA));
    const custom = await getProfile();
    expect(custom.body.profileImageUrl).toBe("https://storage.test/objects/uploads/custom-avatar");

    await db.update(users)
      .set({ profileImageUrl: null })
      .where(eq(users.clerkId, sellerA));
    const clerk = await getProfile();
    expect(clerk.body.profileImageUrl).toBe("https://images.clerk.test/fallback.jpg");

    await db.update(users)
      .set({ avatarUrl: null })
      .where(eq(users.clerkId, sellerA));
    const initials = await getProfile();
    expect(initials.body.profileImageUrl).toBeNull();
    expect(initials.body.avatarUrl).toBeNull();
  });

  it("counts only paid checkout orders that are not cancelled or refunded", async () => {
    authState.clerkUserId = sellerA;
    const result = await getProfile();

    expect(result.status).toBe(200);
    expect(result.body.metrics).toEqual({
      revenueCents: 12_345,
      visitors: 4,
      orders: 1,
      conversionRate: 25,
    });
  });
});
