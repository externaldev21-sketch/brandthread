import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, orders, returns, shippingLabels } from "@workspace/db";
import { handleReturnLabelTracking } from "../returnLabels";

// Audit: returns.first_scan_at must record the carrier's FIRST scan, not be
// overwritten by every later scan event.
const sfx = crypto.randomBytes(6).toString("hex");
const buyer = `rl-audit-buyer-${sfx}`;
const seller = `rl-audit-seller-${sfx}`;
let orderId = "";
let returnId = "";
let labelId = "";

beforeAll(async () => {
  const [order] = await db.insert(orders).values({
    buyerId: buyer, ownerId: seller, orderNumber: `RLA-${sfx}`, totalCents: 5000, subtotalCents: 5000, status: "delivered",
  }).returning({ id: orders.id });
  orderId = order!.id;
  const [ret] = await db.insert(returns).values({
    id: crypto.randomUUID(), orderId, buyerId: buyer, sellerId: seller, reason: "too small", status: "approved", refundOnScan: false,
  }).returning({ id: returns.id });
  returnId = ret!.id;
  const [label] = await db.insert(shippingLabels).values({
    orderId, ownerId: seller, idempotencyKey: `return-label/${returnId}`, providerRateId: "rate_x",
    priceCents: 500, status: "active", direction: "return", returnId,
  }).returning({ id: shippingLabels.id });
  labelId = label!.id;
});

afterAll(async () => {
  await db.delete(returns).where(eq(returns.id, returnId));
  await db.delete(orders).where(eq(orders.id, orderId));
});

describe("handleReturnLabelTracking first scan (audit)", () => {
  it("keeps the first scan time when later scans arrive", async () => {
    await handleReturnLabelTracking(labelId, "pre_transit");
    let [row] = await db.select({ firstScanAt: returns.firstScanAt }).from(returns).where(eq(returns.id, returnId));
    expect(row!.firstScanAt).toBeNull();

    await handleReturnLabelTracking(labelId, "in_transit");
    [row] = await db.select({ firstScanAt: returns.firstScanAt }).from(returns).where(eq(returns.id, returnId));
    const first = row!.firstScanAt;
    expect(first).not.toBeNull();

    await new Promise((r) => setTimeout(r, 30));
    await handleReturnLabelTracking(labelId, "delivered");
    const [after] = await db.select({ firstScanAt: returns.firstScanAt, status: returns.returnTrackingStatus })
      .from(returns).where(eq(returns.id, returnId));
    expect(after!.status).toBe("delivered");
    expect(after!.firstScanAt?.getTime()).toBe(first!.getTime());
  });
});
