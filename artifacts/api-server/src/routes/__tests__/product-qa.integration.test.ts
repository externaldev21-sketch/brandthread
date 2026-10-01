/**
 * Integration tests for product Q&A (migration 114): public read, signed-in
 * ask, limits, seller-only answers, and the two notifications.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, products, productQuestions } from "@workspace/db";
import { eq } from "drizzle-orm";

const suffix = crypto.randomBytes(6).toString("hex");
const SELLER = `qa-seller-${suffix}`;
const OTHER_SELLER = `qa-other-seller-${suffix}`;
const BUYER = `qa-buyer-${suffix}`;
const BUYER_2 = `qa-buyer2-${suffix}`;

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const user = req.headers["x-test-user"];
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    req.clerkUserId = user;
    next();
  },
}));
// Rate limiting is covered by its own suite; keep these tests about Q&A rules.
vi.mock("../../middlewares/rateLimit", () => ({ rateLimit: () => (_q: any, _s: any, next: any) => next() }));

const publishNotification = vi.fn(async (_n: Record<string, unknown>) => {});
vi.mock("../notifications-feed", () => ({ publishNotification: (n: Record<string, unknown>) => publishNotification(n) }));

let server: Server;
let base = "";
let productId = "";
let draftProductId = "";
let questionId = "";

const as = (user?: string) => ({ "Content-Type": "application/json", ...(user ? { "x-test-user": user } : {}) });
const ask = (user: string | undefined, body: unknown, pid = productId) =>
  fetch(`${base}/api/product-qa/product/${pid}`, { method: "POST", headers: as(user), body: JSON.stringify({ body }) });

beforeAll(async () => {
  const { default: router } = await import("../product-qa");
  const app = express();
  app.use(express.json());
  app.use("/api/product-qa", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const [p] = await db.insert(products).values({ ownerId: SELLER, name: `qa-product-${suffix}`, status: "active" }).returning({ id: products.id });
  productId = p.id;
  const [d] = await db.insert(products).values({ ownerId: SELLER, name: `qa-draft-${suffix}`, status: "draft" }).returning({ id: products.id });
  draftProductId = d.id;
});

afterAll(async () => {
  for (const id of [productId, draftProductId]) if (id) await db.delete(products).where(eq(products.id, id)); // cascades Q&A
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("asking", () => {
  it("401 when signed out", async () => {
    expect((await ask(undefined, "Does this come in black?")).status).toBe(401);
  });

  it("400 for too-short, too-long and moderated text", async () => {
    expect((await ask(BUYER, "hi")).status).toBe(400);
    expect((await ask(BUYER, "x".repeat(301))).status).toBe(400);
    expect((await ask(BUYER, 42 as any)).status).toBe(400);
  });

  it("404 for a draft product and an unknown product", async () => {
    expect((await ask(BUYER, "Is this available?", draftProductId)).status).toBe(404);
    expect((await ask(BUYER, "Is this available?", crypto.randomUUID())).status).toBe(404);
  });

  it("the seller can't ask on their own product", async () => {
    expect((await ask(SELLER, "Is this available?")).status).toBe(400);
  });

  it("201 creates a question, derives the seller, and notifies them", async () => {
    const res = await ask(BUYER, "Does this come in black?");
    expect(res.status).toBe(201);
    const q = await res.json() as Record<string, any>;
    questionId = q.id;
    expect(q.body).toBe("Does this come in black?");
    expect(q.mine).toBe(true);
    expect(q.answer).toBeNull();
    const [row] = await db.select().from(productQuestions).where(eq(productQuestions.id, questionId));
    expect(row.sellerId).toBe(SELLER);
    expect(publishNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: SELLER, type: "product_question" }));
  });

  it("caps questions per product per day", async () => {
    expect((await ask(BUYER_2, "First question here")).status).toBe(201);
    expect((await ask(BUYER_2, "Second question here")).status).toBe(201);
    expect((await ask(BUYER_2, "Third question here")).status).toBe(201);
    expect((await ask(BUYER_2, "Fourth question here")).status).toBe(429);
  });
});

describe("public list", () => {
  it("is readable signed out and marks nothing as mine", async () => {
    const res = await fetch(`${base}/api/product-qa/product/${productId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { questions: Array<Record<string, any>>; totalCount: number };
    expect(body.totalCount).toBeGreaterThanOrEqual(1);
    const q = body.questions.find((x) => x.id === questionId)!;
    expect(q.mine).toBe(false);
    expect(q).not.toHaveProperty("askerId");
    expect(q).not.toHaveProperty("sellerId");
  });

  it("returns an empty list for a malformed id", async () => {
    const body = await (await fetch(`${base}/api/product-qa/product/not-a-uuid`)).json();
    expect(body).toEqual({ questions: [], totalCount: 0 });
  });
});

describe("answering", () => {
  const answer = (user: string | undefined, body: unknown) =>
    fetch(`${base}/api/product-qa/questions/${questionId}/answer`, { method: "POST", headers: as(user), body: JSON.stringify({ body }) });

  it("401 signed out; 403 for buyers and for another seller", async () => {
    expect((await answer(undefined, "Yes")).status).toBe(401);
    expect((await answer(BUYER, "Yes")).status).toBe(403);
    expect((await answer(OTHER_SELLER, "Yes")).status).toBe(403);
  });

  it("400 for an empty answer", async () => {
    expect((await answer(SELLER, "   ")).status).toBe(400);
  });

  it("the owning seller answers once; the asker is notified only the first time", async () => {
    publishNotification.mockClear();
    expect((await answer(SELLER, "Yes, in black and white.")).status).toBe(200);
    expect(publishNotification).toHaveBeenCalledTimes(1);
    expect(publishNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: BUYER, type: "product_answer", targetId: productId }));
    expect((await answer(SELLER, "Yes, black, white and grey.")).status).toBe(200);
    expect(publishNotification).toHaveBeenCalledTimes(1);

    const list = await (await fetch(`${base}/api/product-qa/product/${productId}`)).json() as any;
    expect(list.questions.find((x: any) => x.id === questionId).answer.body).toBe("Yes, black, white and grey.");
  });
});

describe("seller inbox and deletion", () => {
  it("lists only the seller's own questions", async () => {
    const mine = await (await fetch(`${base}/api/product-qa/seller`, { headers: as(SELLER) })).json() as any;
    expect(mine.questions.some((q: any) => q.id === questionId)).toBe(true);
    const theirs = await (await fetch(`${base}/api/product-qa/seller`, { headers: as(OTHER_SELLER) })).json() as any;
    expect(theirs.questions).toEqual([]);
    expect((await fetch(`${base}/api/product-qa/seller`)).status).toBe(401);
  });

  it("only the asker can delete their question", async () => {
    const other = await fetch(`${base}/api/product-qa/questions/${questionId}`, { method: "DELETE", headers: as(BUYER_2) });
    expect(other.status).toBe(404);
    const own = await fetch(`${base}/api/product-qa/questions/${questionId}`, { method: "DELETE", headers: as(BUYER) });
    expect(own.status).toBe(200);
  });
});
