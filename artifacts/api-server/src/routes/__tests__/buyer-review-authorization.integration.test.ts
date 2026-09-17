/**
 * Integration tests for POST /api/reviews — buyer post-purchase authorization.
 *
 * Each test case exercises the authoritative predicate end-to-end against the
 * real dev database.  The mock auth middleware injects clerkUserId from the
 * x-test-user header so Clerk is never called.
 *
 * Covered scenarios:
 *   ✓ Valid delivered order → 201 Created
 *   ✓ Repeat submission (unique violation) → 200 idempotent update
 *   ✓ Missing orderId → 400
 *   ✓ Another buyer's order → 403 (no existence leak)
 *   ✓ Wrong seller on the order → 400
 *   ✓ Wrong productId (not on order) → 400
 *   ✓ Undelivered order (processing) → 400
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import {
  db,
  orders,
  orderItems,
  products,
  productVariants,
  reviews,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";

// ── Test-scoped IDs ──────────────────────────────────────────────────────────

const suffix = crypto.randomBytes(6).toString("hex");
const BUYER_A   = `review-auth-buyer-a-${suffix}`;   // primary buyer
const BUYER_B   = `review-auth-buyer-b-${suffix}`;   // another buyer
const SELLER    = `review-auth-seller-${suffix}`;    // correct seller
const SELLER_B  = `review-auth-seller-b-${suffix}`;  // unrelated seller

// ── Mock requireAuth to read x-test-user header ──────────────────────────────

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = req.headers["x-test-user"];
    next();
  },
}));

// ── Server ───────────────────────────────────────────────────────────────────

let server: Server;
let base = "";

beforeAll(async () => {
  const { default: reviewsRouter } = await import("../reviews");
  const app = express();
  app.use(express.json());
  app.use("/api/reviews", reviewsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

// ── Shared fixture state ──────────────────────────────────────────────────────

let deliveredOrderId: string;
let processingOrderId: string;
let otherBuyerOrderId: string;
let inProductId: string;     // a product that IS on the delivered order
let offProductId: string;    // a product that is NOT on the delivered order

beforeAll(async () => {
  // Create a product that will be a line item on the delivered order.
  const [inProd] = await db
    .insert(products)
    .values({
      ownerId: SELLER,
      name: `review-auth-in-product-${suffix}`,
      status: "active",
    })
    .returning({ id: products.id });
  inProductId = inProd.id;

  // Create a second product that is NOT on the order.
  const [offProd] = await db
    .insert(products)
    .values({
      ownerId: SELLER,
      name: `review-auth-off-product-${suffix}`,
      status: "active",
    })
    .returning({ id: products.id });
  offProductId = offProd.id;

  // Create a variant for the in-product.
  const [variant] = await db
    .insert(productVariants)
    .values({
      productId: inProductId,
      sku: `review-auth-sku-${suffix}`,
      priceCents: 1000,
      stock: 10,
    })
    .returning({ id: productVariants.id });

  // Delivered order owned by BUYER_A, sold by SELLER.
  const [deliveredOrder] = await db
    .insert(orders)
    .values({
      ownerId:      SELLER,
      buyerId:      BUYER_A,
      orderNumber:  `BT-REVIEW-AUTH-D-${suffix}`,
      status:       "delivered",
      totalCents:   1000,
      subtotalCents: 1000,
      shippingCents: 0,
    })
    .returning({ id: orders.id });
  deliveredOrderId = deliveredOrder.id;

  // Add the in-product variant as a line item.
  await db.insert(orderItems).values({
    orderId:     deliveredOrderId,
    variantId:   variant.id,
    productName: `review-auth-in-product-${suffix}`,
    quantity:    1,
    priceCents:  1000,
  });

  // Processing (undelivered) order owned by BUYER_A.
  const [processingOrder] = await db
    .insert(orders)
    .values({
      ownerId:      SELLER,
      buyerId:      BUYER_A,
      orderNumber:  `BT-REVIEW-AUTH-P-${suffix}`,
      status:       "processing",
      totalCents:   1000,
      subtotalCents: 1000,
      shippingCents: 0,
    })
    .returning({ id: orders.id });
  processingOrderId = processingOrder.id;

  // Delivered order owned by BUYER_B (foreign order to BUYER_A).
  const [otherOrder] = await db
    .insert(orders)
    .values({
      ownerId:      SELLER,
      buyerId:      BUYER_B,
      orderNumber:  `BT-REVIEW-AUTH-O-${suffix}`,
      status:       "delivered",
      totalCents:   1000,
      subtotalCents: 1000,
      shippingCents: 0,
    })
    .returning({ id: orders.id });
  otherBuyerOrderId = otherOrder.id;
});

// ── Cleanup ───────────────────────────────────────────────────────────────────

afterAll(async () => {
  // Remove reviews first (FK deps on orders / products)
  await db.delete(reviews).where(eq(reviews.buyerId, BUYER_A));
  await db.delete(reviews).where(eq(reviews.buyerId, BUYER_B));

  // Remove order items then orders
  if (deliveredOrderId) {
    await db.delete(orderItems).where(eq(orderItems.orderId, deliveredOrderId));
    await db.delete(orders).where(eq(orders.id, deliveredOrderId));
  }
  if (processingOrderId) {
    await db.delete(orders).where(eq(orders.id, processingOrderId));
  }
  if (otherBuyerOrderId) {
    await db.delete(orders).where(eq(orders.id, otherBuyerOrderId));
  }

  // Remove products (cascades variants)
  if (inProductId)  await db.delete(products).where(eq(products.id, inProductId));
  if (offProductId) await db.delete(products).where(eq(products.id, offProductId));

  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ── Helper ────────────────────────────────────────────────────────────────────

function postReview(body: Record<string, unknown>, userId = BUYER_A) {
  return fetch(`${base}/api/reviews`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-test-user": userId,
    },
    body: JSON.stringify(body),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/reviews — buyer authorization", () => {
  it("201 for a valid delivered order (no productId)", async () => {
    const res = await postReview({
      orderId:  deliveredOrderId,
      sellerId: SELLER,
      rating:   5,
      body:     "Great quality!",
    });
    expect(res.status).toBe(201);
    const row = await res.json() as Record<string, unknown>;
    expect(row.orderId).toBe(deliveredOrderId);
    expect(row.buyerId).toBe(BUYER_A);
    expect(row.sellerId).toBe(SELLER);
    expect(row.rating).toBe(5);
  });

  it("200 idempotent update on repeat submission for the same order", async () => {
    // First submission (may already exist from prior test — that's fine).
    await postReview({
      orderId:  deliveredOrderId,
      sellerId: SELLER,
      rating:   4,
    });

    // Repeat — should update, not 409.
    const res = await postReview({
      orderId:  deliveredOrderId,
      sellerId: SELLER,
      rating:   3,
      body:     "Updated opinion",
    });
    expect(res.status).toBe(200);
    const row = await res.json() as Record<string, unknown>;
    expect(row.rating).toBe(3);
    expect(row.body).toBe("Updated opinion");
    expect(row.orderId).toBe(deliveredOrderId);
  });

  it("201 with a valid productId that is on the order", async () => {
    // Clean up any prior review for this buyer/order so we get a fresh insert.
    await db
      .delete(reviews)
      .where(and(eq(reviews.buyerId, BUYER_A), eq(reviews.orderId, deliveredOrderId)));

    const res = await postReview({
      orderId:   deliveredOrderId,
      sellerId:  SELLER,
      productId: inProductId,
      rating:    5,
    });
    expect(res.status).toBe(201);
    const row = await res.json() as Record<string, unknown>;
    expect(row.productId).toBe(inProductId);
  });

  it("400 when orderId is omitted", async () => {
    const res = await postReview({ sellerId: SELLER, rating: 4 });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toMatch(/orderId/i);
  });

  it("403 when the order belongs to a different buyer (no existence leak)", async () => {
    // BUYER_A tries to review BUYER_B's order.
    const res = await postReview(
      { orderId: otherBuyerOrderId, sellerId: SELLER, rating: 4 },
      BUYER_A,
    );
    expect(res.status).toBe(403);
    const body = await res.json() as Record<string, unknown>;
    // Must not reveal that the order exists or who owns it.
    expect(String(body.error)).not.toMatch(/not found/i);
    expect(String(body.error)).not.toMatch(/buyer/i);
  });

  it("400 when sellerId does not match the order's seller", async () => {
    const res = await postReview({
      orderId:  deliveredOrderId,
      sellerId: SELLER_B,   // wrong seller
      rating:   4,
    });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toMatch(/seller/i);
  });

  it("400 when productId is not a line item on this order", async () => {
    const res = await postReview({
      orderId:   deliveredOrderId,
      sellerId:  SELLER,
      productId: offProductId,   // exists but not on the order
      rating:    4,
    });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toMatch(/product/i);
  });

  it("400 when the order is not delivered/fulfilled", async () => {
    const res = await postReview({
      orderId:  processingOrderId,
      sellerId: SELLER,
      rating:   5,
    });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toMatch(/delivered/i);
  });
});
