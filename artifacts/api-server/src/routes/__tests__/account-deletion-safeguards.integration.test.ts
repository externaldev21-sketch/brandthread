/**
 * Account deletion safeguards (App Store 5.1.1(v)) against the real database:
 * sellers cannot strand buyers or held drop money, buyers cannot strand a
 * seller who still needs their address, and once settled the deletion runs
 * fully (including comments, muted words and Clerk).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { eq, inArray, like } from "drizzle-orm";
import {
  db, drops, dropWallets, mutedWords, orders, postComments, posts, reports, users,
} from "@workspace/db";

const clerk = vi.hoisted(() => ({ deleted: [] as string[] }));

vi.mock("../../middlewares/requireAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../middlewares/requireAuth")>();
  return {
    ...actual,
    requireAuth: (req: any, _res: any, next: () => void) => {
      req.clerkUserId = req.header("x-test-user-id");
      next();
    },
  };
});

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: null, sessionId: null }),
  clerkClient: { users: { deleteUser: async (id: string) => { clerk.deleted.push(id); } } },
}));

const RUN = `del${crypto.randomBytes(5).toString("hex")}`;
const SELLER = `${RUN}_seller`;
const DROP_SELLER = `${RUN}_dropseller`;
const BUYER = `${RUN}_buyer`;
let server: Server;
let base = "";
let sellerOrderId = "";
let buyerOrderId = "";
let dropId = "";
let commentedPostId = "";

async function call(path: string, user: string, method = "GET", body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-user-id": user },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json().catch(() => null) as any };
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: SELLER, email: `${SELLER}@example.test`, name: "Deleting Seller", accountType: "seller", role: "owner" },
    { clerkId: DROP_SELLER, email: `${DROP_SELLER}@example.test`, name: "Drop Seller", accountType: "seller", role: "owner" },
    { clerkId: BUYER, email: `${BUYER}@example.test`, name: "Deleting Buyer", accountType: "buyer", role: "buyer" },
  ]);
  const [sellerOrder] = await db.insert(orders).values({
    ownerId: SELLER, buyerId: `${RUN}_someone`, orderNumber: `${RUN}-1`, status: "processing",
    totalCents: 4500, subtotalCents: 4500, paidAt: new Date(),
  }).returning({ id: orders.id });
  sellerOrderId = sellerOrder.id;
  const [buyerOrder] = await db.insert(orders).values({
    ownerId: `${RUN}_merchant`, buyerId: BUYER, orderNumber: `${RUN}-2`, status: "pending",
    totalCents: 3000, subtotalCents: 3000, paidAt: new Date(),
    shippingAddress: { street: "1 Test St", city: "Testville", state: "TS", zip: "00000", country: "US" },
  }).returning({ id: orders.id });
  buyerOrderId = buyerOrder.id;
  const [drop] = await db.insert(drops).values({ ownerId: DROP_SELLER, name: "Held drop", type: "pre-order" })
    .returning({ id: drops.id });
  dropId = drop.id;
  await db.insert(dropWallets).values({ dropId, sellerId: DROP_SELLER, balanceCents: 12000, releasedCents: 2000 });

  const { default: authRouter } = await import("../auth");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).log = { error: () => {}, warn: () => {}, info: () => {} }; next(); });
  app.use("/api/auth", authRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(dropWallets).where(eq(dropWallets.dropId, dropId));
  await db.delete(drops).where(eq(drops.id, dropId));
  await db.delete(orders).where(inArray(orders.id, [sellerOrderId, buyerOrderId]));
  await db.delete(posts).where(like(posts.userId, `${RUN}%`));
  if (commentedPostId) await db.delete(reports).where(eq(reports.targetId, commentedPostId));
  await db.delete(users).where(like(users.clerkId, `${RUN}%`));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("account deletion safeguards", () => {
  it("blocks a seller with a paid, unfulfilled order and explains how to fix it", async () => {
    const check = await call("/api/auth/account/deletion-check", SELLER);
    expect(check.status).toBe(200);
    expect(check.body.canDelete).toBe(false);
    expect(check.body.blockers).toEqual([
      expect.objectContaining({ code: "seller_open_orders", count: 1, actionRoute: "/(tabs)/orders" }),
    ]);
    expect(check.body.willDelete.length).toBeGreaterThan(0);
    expect(check.body.willRetain.join(" ")).toMatch(/tax records/);

    const attempt = await call("/api/auth/account", SELLER, "DELETE", { confirmation: "DELETE" });
    expect(attempt.status).toBe(409);
    expect(attempt.body.code).toBe("DELETION_BLOCKED");
    const [account] = await db.select({ deletedAt: users.deletedAt }).from(users).where(eq(users.clerkId, SELLER));
    expect(account.deletedAt).toBeNull();
    expect(clerk.deleted).not.toContain(SELLER);
  });

  it("blocks a seller whose drop still holds buyer funds, with the amount", async () => {
    const check = await call("/api/auth/account/deletion-check", DROP_SELLER);
    expect(check.body.canDelete).toBe(false);
    expect(check.body.blockers).toEqual([
      expect.objectContaining({ code: "seller_held_funds", amountCents: 10000 }),
    ]);
    expect(check.body.blockers[0].title).toContain("$100.00");
  });

  it("blocks a buyer whose paid order has not shipped, then allows deletion once it ships", async () => {
    const blocked = await call("/api/auth/account/deletion-check", BUYER);
    expect(blocked.body.blockers.map((b: any) => b.code)).toEqual(["buyer_orders_awaiting_shipment"]);

    await db.update(orders).set({ status: "shipped", shippedAt: new Date() }).where(eq(orders.id, buyerOrderId));
    expect((await call("/api/auth/account/deletion-check", BUYER)).body.canDelete).toBe(true);
  });

  it("deletes a settled seller everywhere, including comments and muted words", async () => {
    await db.update(orders).set({ status: "delivered" }).where(eq(orders.id, sellerOrderId));
    const [post] = await db.insert(posts).values({ userId: `${RUN}_poster`, mediaUrl: "https://cdn.test/p.jpg" })
      .returning({ id: posts.id });
    commentedPostId = post.id;
    await db.insert(postComments).values({ postId: post.id, authorId: SELLER, body: "my comment" });
    await db.insert(mutedWords).values({ userId: SELLER, phrase: "spoilers" });
    await db.insert(reports).values({ reporterId: SELLER, targetType: "post", targetId: post.id, reason: "spam" });

    expect((await call("/api/auth/account/deletion-check", SELLER)).body.canDelete).toBe(true);
    const deleted = await call("/api/auth/account", SELLER, "DELETE", { confirmation: "DELETE" });
    expect(deleted.status).toBe(200);
    expect(clerk.deleted).toContain(SELLER);

    expect(await db.select().from(postComments).where(eq(postComments.authorId, SELLER))).toEqual([]);
    expect(await db.select().from(mutedWords).where(eq(mutedWords.userId, SELLER))).toEqual([]);
    const [report] = await db.select().from(reports).where(eq(reports.targetId, post.id));
    expect(report.reporterId).toMatch(/^deleted:/);
    const [order] = await db.select({ ownerId: orders.ownerId }).from(orders).where(eq(orders.id, sellerOrderId));
    expect(order.ownerId).toMatch(/^deleted:/);
  });
});
