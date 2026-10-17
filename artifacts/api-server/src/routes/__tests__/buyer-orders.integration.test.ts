import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, orders, orderItems, products, productVariants, users } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const suffix = crypto.randomBytes(6).toString("hex");
const buyerId = `buyer-orders-test-buyer-${suffix}`;
const sellerId = `buyer-orders-test-seller-${suffix}`;
const orderNumber = `BT-BUYER-CANCEL-${suffix}`;
const cardOrderNumber = `BT-BUYER-CARD-${suffix}`;

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = req.headers["x-test-user"];
    next();
  },
}));

let server: Server;
let base = "";

beforeAll(async () => {
  const { default: buyerRouter } = await import("../buyer");
  const app = express();
  app.use(express.json());
  app.use("/api/buyer", buyerRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(orders).where(inArray(orders.orderNumber, [orderNumber, cardOrderNumber]));
  await db.delete(products).where(eq(products.ownerId, sellerId));
  await db.delete(users).where(eq(users.clerkId, sellerId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /api/buyer/orders", () => {
  it("includes cancellationReason for cancelled buyer orders", async () => {
    const [order] = await db.insert(orders).values({
      ownerId: sellerId,
      buyerId,
      orderNumber,
      status: "cancelled",
      totalCents: 2_400,
      subtotalCents: 2_000,
      shippingCents: 400,
      cancellationReason: "buyer_requested",
      cancellationNotes: "Cancelled by buyer within the cancellation window.",
      shippingAddress: {
        name: "Buyer",
        street: "1 Test Street",
        city: "Austin",
        state: "TX",
        zip: "78701",
        country: "US",
      },
    }).returning({ id: orders.id });

    const response = await fetch(`${base}/api/buyer/orders`, {
      headers: { "x-test-user": buyerId },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: order.id,
        status: "cancelled",
        cancellationReason: "buyer_requested",
      }),
    ]));
  });

  it("carries each order's line items with the product photo, and the seller's logo", async () => {
    await db.insert(users).values({
      clerkId: sellerId, email: `${sellerId}@test.local`, name: "Card Seller", role: "seller", accountType: "seller",
      profileImageUrl: "https://example.test/brand-logo.png",
    });
    const [product] = await db.insert(products).values({
      ownerId: sellerId, name: "Sculpted Coat", category: "apparel", status: "active",
      images: ["https://example.test/coat-front.jpg", "https://example.test/coat-back.jpg"],
    }).returning({ id: products.id });
    const [variant] = await db.insert(productVariants).values({
      productId: product.id, sku: `CARD-${suffix}`, priceCents: 48_000,
    }).returning({ id: productVariants.id });
    const [order] = await db.insert(orders).values({
      ownerId: sellerId, buyerId, orderNumber: cardOrderNumber, status: "processing",
      totalCents: 48_000, subtotalCents: 48_000, shippingCents: 0,
      shippingAddress: { name: "Buyer", street: "1 Test Street", city: "Austin", state: "TX", zip: "78701", country: "US" },
    }).returning({ id: orders.id });
    await db.insert(orderItems).values([
      { orderId: order.id, variantId: variant.id, productName: "Sculpted Coat", variantLabel: "M", quantity: 1, priceCents: 48_000 },
      // A line whose variant was since deleted: still listed, with no photo.
      { orderId: order.id, variantId: null, productName: "Gift wrap", quantity: 1, priceCents: 0 },
    ]);

    const response = await fetch(`${base}/api/buyer/orders`, { headers: { "x-test-user": buyerId } });
    expect(response.status).toBe(200);
    const body = await response.json() as Array<Record<string, unknown> & { id: string; orderNumber: string }>;
    const row = body.find((o) => o.id === order.id)!;
    expect(row.sellerLogoUrl).toBe("https://example.test/brand-logo.png");
    expect(row).not.toHaveProperty("sellerProfileImageUrl");
    expect(row.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ productId: product.id, productName: "Sculpted Coat", variantLabel: "M", quantity: 1, imageUrl: "https://example.test/coat-front.jpg" }),
      expect.objectContaining({ productId: null, productName: "Gift wrap", imageUrl: null }),
    ]));
    // The cancelled order from the first test has no items.
    expect(body.find((o) => o.orderNumber === orderNumber)?.items).toEqual([]);
  });
});
