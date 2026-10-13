import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { inArray, or } from "drizzle-orm";
import { blocks, db, reviews, users } from "@workspace/db";

const suffix = crypto.randomBytes(6).toString("hex");
const id = (n: string) => `rv-block-${n}-${suffix}`;
const seller = id("seller");
const viewer = id("viewer");
const blockedBuyer = id("blocked");
const okBuyer = id("ok");
const userIds = [seller, viewer, blockedBuyer, okBuyer];

let server: Server;
let base = "";

async function sellerReviews(asUser?: string) {
  const response = await fetch(`${base}/api/reviews/seller/${seller}`, { headers: asUser ? { "x-test-user": asUser } : {} });
  expect(response.status).toBe(200);
  return (await response.json()) as { reviews: Array<{ body: string | null }>; totalCount: number };
}

beforeAll(async () => {
  await db.insert(users).values(userIds.map((u) => ({
    clerkId: u, email: `${u}@t.local`, name: u, username: u.replace(/-/g, "_"),
    role: u === seller ? "seller" : "buyer", accountType: u === seller ? "seller" : "buyer",
  })));
  await db.insert(reviews).values([
    { buyerId: blockedBuyer, sellerId: seller, rating: 1, body: "from blocked" },
    { buyerId: okBuyer, sellerId: seller, rating: 5, body: "from ok" },
  ]);
  await db.insert(blocks).values({ blockerId: blockedBuyer, blockedId: viewer });
  const { default: router } = await import("../reviews");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const user = req.header("x-test-user");
    if (user) (req as any).clerkUserId = user;
    next();
  });
  app.use("/api/reviews", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(reviews).where(inArray(reviews.sellerId, [seller]));
  await db.delete(blocks).where(or(inArray(blocks.blockerId, userIds), inArray(blocks.blockedId, userIds)));
  await db.delete(users).where(inArray(users.clerkId, userIds));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /api/reviews/seller/:sellerId with blocks", () => {
  it("hides reviews from someone in a block relation with the viewer", async () => {
    const bodies = (await sellerReviews(viewer)).reviews.map((r) => r.body);
    expect(bodies).toContain("from ok");
    expect(bodies).not.toContain("from blocked");
  });

  it("shows every review to signed-out visitors and unrelated viewers", async () => {
    expect((await sellerReviews()).reviews).toHaveLength(2);
    expect((await sellerReviews(okBuyer)).reviews).toHaveLength(2);
  });
});
