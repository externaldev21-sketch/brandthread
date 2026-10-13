import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, orderItems, orders, productVariants, products, users } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { assignEditionNumbers, validateEditionSize } from "../../lib/editions";

const suffix = crypto.randomBytes(6).toString("hex");
const buyerId = `numbered-buyer-${suffix}`;
const sellerId = `numbered-seller-${suffix}`;
const auth = vi.hoisted(() => ({ user: "" }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => { req.clerkUserId = auth.user; next(); },
}));
vi.mock("../../middlewares/requireRole", () => ({
  teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (req: any, _res: unknown, next: () => void) => { req.clerkUserId = auth.user; next(); },
}));

let server: Server;
let base = "";
const orderIds: string[] = [];

async function call(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json().catch(() => ({}))) as any };
}

async function numberedProduct(size: number | null) {
  const [p] = await db.insert(products).values({
    ownerId: sellerId, name: `Run ${suffix}`, status: "active", images: ["https://cdn.test/run.jpg"], editionSize: size,
  }).returning({ id: products.id });
  const [v] = await db.insert(productVariants).values({
    productId: p.id, size: "M", sku: `run-${suffix}-${crypto.randomBytes(3).toString("hex")}`, priceCents: 5_000, stock: 100,
  }).returning({ id: productVariants.id });
  return { productId: p.id, variantId: v.id };
}

/** One paid order with the given line quantities; numbers assigned the way the payment webhook does. */
async function paidOrder(variantId: string, quantities: number[], delivered = true) {
  const [o] = await db.insert(orders).values({
    ownerId: sellerId, buyerId, orderNumber: `BT-RUN-${suffix}-${orderIds.length}`, status: delivered ? "delivered" : "processing",
    totalCents: 5_000, subtotalCents: 5_000, paidAt: new Date(), deliveredAt: delivered ? new Date() : null,
  }).returning({ id: orders.id });
  orderIds.push(o.id);
  return db.transaction(async (tx) => {
    const items = await tx.insert(orderItems).values(quantities.map((quantity) => ({
      orderId: o.id, variantId, productName: "Run tee", quantity, priceCents: 5_000,
    }))).returning({ id: orderItems.id, variantId: orderItems.variantId, quantity: orderItems.quantity });
    await assignEditionNumbers(tx as any, items);
    return items.map((i) => i.id);
  });
}

async function numberOf(itemId: string) {
  return (await db.select({ n: orderItems.editionNumber }).from(orderItems).where(eq(orderItems.id, itemId)))[0].n;
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: buyerId, email: `${buyerId}@test.local`, name: "Buyer", role: "buyer", accountType: "buyer" },
    { clerkId: sellerId, email: `${sellerId}@test.local`, name: "Seller", brandName: "Quiet Label", role: "seller", accountType: "seller" },
  ]);
  const { default: closetRouter } = await import("../closet");
  const { default: productsRouter } = await import("../products");
  const app = express();
  app.use(express.json());
  app.use("/api/buyer/closet", closetRouter);
  app.use("/api/products", productsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(orders).where(inArray(orders.id, orderIds));
  await db.delete(products).where(eq(products.ownerId, sellerId));
  await db.delete(users).where(inArray(users.clerkId, [buyerId, sellerId]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("assigning numbers", () => {
  it("numbers units in payment order and never past the run size", async () => {
    const run = await numberedProduct(4);
    const [a] = await paidOrder(run.variantId, [1]);
    const [b, c] = await paidOrder(run.variantId, [2, 1]);
    const [d] = await paidOrder(run.variantId, [1]);
    expect(await numberOf(a)).toBe(1);
    expect(await numberOf(b)).toBe(2); // covers 2–3
    expect(await numberOf(c)).toBe(4);
    expect(await numberOf(d)).toBeNull(); // the run is full
    const [row] = await db.select({ issued: products.editionIssued }).from(products).where(eq(products.id, run.productId));
    expect(row.issued).toBe(4);
  });

  it("leaves ordinary products alone", async () => {
    const plain = await numberedProduct(null);
    const [item] = await paidOrder(plain.variantId, [1]);
    expect(await numberOf(item)).toBeNull();
  });
});

describe("closet proof", () => {
  it("shows the number and run size on the delivered piece", async () => {
    const run = await numberedProduct(200);
    const [item] = await paidOrder(run.variantId, [1]);
    auth.user = buyerId;
    const res = await call("/api/buyer/closet/pieces");
    const piece = res.body.pieces.find((p: any) => p.id === item);
    expect(piece.edition).toEqual({ number: 1, quantity: 1, size: 200 });
    const plain = res.body.pieces.find((p: any) => p.edition === null);
    expect(plain).toBeTruthy();
  });
});

describe("seller run size", () => {
  it("validates the size and refuses to shrink below or switch off once numbered", async () => {
    expect(validateEditionSize(1, 0)?.code).toBe("EDITION_SIZE_INVALID");
    expect(validateEditionSize(2.5, 0)?.code).toBe("EDITION_SIZE_INVALID");
    expect(validateEditionSize(200, 0)).toBeNull();
    expect(validateEditionSize(undefined, 9)).toBeNull();
    expect(validateEditionSize(null, 0)).toBeNull();

    const run = await numberedProduct(10);
    await paidOrder(run.variantId, [3]);
    auth.user = sellerId;
    const shrink = await call(`/api/products/${run.productId}`, "PUT", { editionSize: 2 });
    expect(shrink.status).toBe(409);
    expect(shrink.body.code).toBe("EDITION_SIZE_BELOW_ISSUED");
    const off = await call(`/api/products/${run.productId}`, "PUT", { editionSize: null });
    expect(off.body.code).toBe("EDITION_IN_USE");
    const grow = await call(`/api/products/${run.productId}`, "PUT", { editionSize: 50 });
    expect(grow.status).toBe(200);
    const [row] = await db.select({ size: products.editionSize }).from(products).where(eq(products.id, run.productId));
    expect(row.size).toBe(50);
  });
});
