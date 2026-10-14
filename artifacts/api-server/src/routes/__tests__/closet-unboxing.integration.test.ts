import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, orderItems, orders, productVariants, products, users } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const suffix = crypto.randomBytes(6).toString("hex");
const buyerId = `unbox-buyer-${suffix}`;
const sellerId = `unbox-seller-${suffix}`;
const auth = vi.hoisted(() => ({ user: "" }));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => { req.clerkUserId = auth.user; next(); },
}));

let server: Server;
let base = "";
const orderIds: string[] = [];
const DAY = 24 * 60 * 60 * 1000;

async function call(path: string, method = "GET") {
  const response = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, body: method === "POST" ? "{}" : undefined });
  return { status: response.status, body: await response.json() as any };
}

async function delivered(daysAgo: number, status = "delivered") {
  const [p] = await db.insert(products).values({ ownerId: sellerId, name: `Box ${daysAgo}`, status: "active", images: ["https://cdn.test/box.jpg"] }).returning({ id: products.id });
  const [v] = await db.insert(productVariants).values({ productId: p.id, size: "M", sku: `unbox-${suffix}-${daysAgo}-${status}`, priceCents: 3_000 }).returning({ id: productVariants.id });
  const [o] = await db.insert(orders).values({
    ownerId: sellerId, buyerId, orderNumber: `BT-UNBOX-${suffix}-${orderIds.length}`, status,
    totalCents: 3_000, subtotalCents: 3_000, deliveredAt: new Date(Date.now() - daysAgo * DAY),
  }).returning({ id: orders.id });
  orderIds.push(o.id);
  await db.insert(orderItems).values({ orderId: o.id, variantId: v.id, productName: `Box ${daysAgo}`, quantity: 1, priceCents: 3_000 });
  return o.id;
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: buyerId, email: `${buyerId}@test.local`, name: "Buyer", role: "buyer", accountType: "buyer" },
    { clerkId: sellerId, email: `${sellerId}@test.local`, name: "Seller", brandName: "Quiet Label", role: "seller", accountType: "seller" },
  ]);
  const { default: closetRouter } = await import("../closet");
  const app = express();
  app.use(express.json());
  app.use("/api/buyer/closet", closetRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(orders).where(inArray(orders.id, orderIds));
  await db.delete(products).where(eq(products.ownerId, sellerId));
  await db.delete(users).where(inArray(users.clerkId, [buyerId, sellerId]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("unboxing moment", () => {
  it("offers the newest recent delivery once, then never again", async () => {
    await delivered(30); // too old: shipped before the moment existed
    await delivered(3, "cancelled"); // not in the closet
    const older = await delivered(2);
    const newest = await delivered(0);
    auth.user = buyerId;

    const first = await call("/api/buyer/closet/unboxing");
    expect(first.body.unboxing.orderId).toBe(newest);
    expect(first.body.unboxing.pieces[0]).toEqual(expect.objectContaining({ name: "Box 0", brand: "Quiet Label" }));

    // One moment covers everything waiting.
    const seen = await call("/api/buyer/closet/unboxing/seen", "POST");
    expect(seen.body.marked).toBe(2); // the two recent live deliveries; cancelled never counts
    expect((await call("/api/buyer/closet/unboxing")).body.unboxing).toBeNull();
    const [row] = await db.select({ seen: orders.unboxingSeenAt }).from(orders).where(eq(orders.id, older));
    expect(row.seen).not.toBeNull();
  });

  it("is nothing for someone else", async () => {
    auth.user = `someone-${suffix}`;
    expect((await call("/api/buyer/closet/unboxing")).body.unboxing).toBeNull();
    expect((await call("/api/buyer/closet/unboxing/seen", "POST")).body.marked).toBe(0);
  });
});
