import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import { db, reviews, users } from "@workspace/db";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const userId = req.header("x-test-user");
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = userId;
    next();
  },
}));

const suffix = crypto.randomBytes(6).toString("hex");
const id = (n: string) => `rv-reply-${n}-${suffix}`;
const seller = id("seller");
const otherSeller = id("other");
const buyer = id("buyer");
const userIds = [seller, otherSeller, buyer];

let server: Server;
let base = "";
let reviewId = "";

function call(method: string, path: string, asUser: string, body?: unknown) {
  return fetch(`${base}/api/reviews${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-user": asUser },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function storedReply() {
  const [row] = await db.select({ reply: reviews.sellerReply, at: reviews.sellerRepliedAt })
    .from(reviews).where(eq(reviews.id, reviewId));
  return row;
}

beforeAll(async () => {
  await db.insert(users).values(userIds.map((u) => ({
    clerkId: u, email: `${u}@t.local`, name: u, username: u.replace(/-/g, "_"),
    role: u === buyer ? "buyer" : "seller", accountType: u === buyer ? "buyer" : "seller",
  })));
  const [row] = await db.insert(reviews).values({ buyerId: buyer, sellerId: seller, rating: 4, body: "Nice tee" })
    .returning({ id: reviews.id });
  reviewId = row.id;
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
  await db.delete(users).where(inArray(users.clerkId, userIds));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("seller reply edit / delete on /api/reviews/:reviewId/reply", () => {
  it("can't edit or delete a reply that was never posted", async () => {
    expect((await call("PATCH", `/${reviewId}/reply`, seller, { replyText: "Edited" })).status).toBe(404);
    expect((await call("DELETE", `/${reviewId}/reply`, seller)).status).toBe(404);
  });

  it("lets the review's seller post, edit and delete their reply", async () => {
    expect((await call("POST", `/${reviewId}/reply`, seller, { replyText: "Thanks!" })).status).toBe(200);
    expect((await storedReply()).reply).toBe("Thanks!");

    const edited = await call("PATCH", `/${reviewId}/reply`, seller, { replyText: "  Thanks so much!  " });
    expect(edited.status).toBe(200);
    expect(((await edited.json()) as { seller_reply?: string }).seller_reply).toBe("Thanks so much!");

    expect((await call("DELETE", `/${reviewId}/reply`, seller)).status).toBe(200);
    expect(await storedReply()).toEqual({ reply: null, at: null });
  });

  it("forbids other sellers and buyers, and rejects an empty edit", async () => {
    await call("POST", `/${reviewId}/reply`, seller, { replyText: "Thanks!" });
    expect((await call("PATCH", `/${reviewId}/reply`, otherSeller, { replyText: "Mine now" })).status).toBe(403);
    expect((await call("DELETE", `/${reviewId}/reply`, buyer)).status).toBe(403);
    expect((await call("PATCH", `/${reviewId}/reply`, seller, { replyText: "   " })).status).toBe(400);
    expect((await storedReply()).reply).toBe("Thanks!");
  });
});
