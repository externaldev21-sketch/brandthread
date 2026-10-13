/**
 * Item 112: the seller order detail's fee breakdown reads stored order
 * columns. The seller's GET /api/orders/:id must carry them; the buyer's
 * order endpoints must never expose Brandthread's or Stripe's fee columns.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, orders } from "@workspace/db";
import { eq } from "drizzle-orm";

const suffix = crypto.randomBytes(6).toString("hex");
const sellerId = `fee-breakdown-seller-${suffix}`;
const buyerId = `fee-breakdown-buyer-${suffix}`;
let orderId = "";
let server: Server;
let base = "";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = req.headers["x-test-user"];
    next();
  },
}));

vi.mock("../../middlewares/requireRole", () => ({
  teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const FEE_COLUMNS = [
  "platformFeeCents", "processingFeeCents", "processingFeeChargedCents", "sellerNetCents",
  "platformFeeRefundedCents", "stripeApplicationFeeId",
];

async function get(path: string, user: string) {
  const response = await fetch(`${base}${path}`, { headers: { "x-test-user": user } });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  const [order] = await db.insert(orders).values({
    ownerId: sellerId,
    buyerId,
    orderNumber: `FEES-${suffix}`,
    status: "processing",
    totalCents: 10_000,
    subtotalCents: 10_000,
    fundsState: "settled_direct",
    platformFeeCents: 500,
    processingFeeCents: 318,
    processingFeeChargedCents: 320,
    sellerNetCents: 9_180,
    platformFeeRefundedCents: 125,
    threadCashAppliedCents: 1_000,
    stripeApplicationFeeId: `fee_${suffix}`,
  }).returning({ id: orders.id });
  orderId = order.id;

  const [{ default: ordersRouter }, { default: buyerRouter }] = await Promise.all([import("../orders"), import("../buyer")]);
  const app = express();
  app.use(express.json());
  app.use("/api/orders", ordersRouter);
  app.use("/api/buyer", buyerRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(orders).where(eq(orders.id, orderId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("order fee breakdown fields", () => {
  it("returns every stored fee column to the seller", async () => {
    const r = await get(`/api/orders/${orderId}`, sellerId);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      totalCents: 10_000,
      fundsState: "settled_direct",
      platformFeeCents: 500,
      processingFeeCents: 318,
      processingFeeChargedCents: 320,
      sellerNetCents: 9_180,
      platformFeeRefundedCents: 125,
      threadCashAppliedCents: 1_000,
    });
  });

  it("does not return the order to another seller", async () => {
    expect((await get(`/api/orders/${orderId}`, `someone-else-${suffix}`)).status).toBe(404);
  });

  it("never exposes platform or processing fee columns on buyer endpoints", async () => {
    const detail = await get(`/api/buyer/orders/${orderId}`, buyerId);
    expect(detail.status).toBe(200);
    expect(detail.body.id).toBe(orderId);
    for (const key of FEE_COLUMNS) expect(detail.body).not.toHaveProperty(key);

    const list = await get(`/api/buyer/orders`, buyerId);
    expect(list.status).toBe(200);
    const row = (list.body as any[]).find((o) => o.id === orderId);
    expect(row).toBeTruthy();
    for (const key of FEE_COLUMNS) expect(row).not.toHaveProperty(key);
  });
});
