/**
 * Item 108 — buyer return requests against real Postgres:
 *   - evidence photos must be the buyer's own uploads (their /objects/returns/<buyer>/ prefix);
 *   - the stored items come from the order's own order_items (never client-sent prices);
 *   - the seller gets a "return requested" row (buyer as actor, opens /return-detail);
 *   - a second active request for the same order is refused;
 *   - both sides can read it back, with names, and outsiders cannot.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const published = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("../notifications-feed", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../notifications-feed")>()),
  publishNotification: async (input: Record<string, unknown>) => { published.push(input); },
}));
vi.mock("../../lib/brandthreadEmail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/brandthreadEmail")>()),
  sendReturnStatusEmail: async () => true,
}));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = req.headers["x-test-user"];
    next();
  },
}));

import { db, orderItems, orders } from "@workspace/db";
import returnsRouter, { evidencePrefix } from "../returns";
import { call, seedBuyer, seedSeller, startApp, uid, waitFor } from "../../lib/money/__tests__/moneyHarness";

let app: { base: string; close: () => Promise<void> };
beforeAll(async () => {
  app = await startApp((server) => server.use("/api/returns", returnsRouter));
});
afterAll(async () => { await app?.close(); });
beforeEach(() => { published.length = 0; });

async function seedDeliveredOrder(sellerId: string, buyerId: string) {
  const [order] = await db.insert(orders).values({
    ownerId: sellerId,
    buyerId,
    orderNumber: uid("BT-RET"),
    status: "delivered",
    subtotalCents: 14_800,
    shippingCents: 1_200,
    totalCents: 16_000,
  }).returning();
  const [line] = await db.insert(orderItems).values({
    orderId: order.id, productName: "Ember Heavyweight Hoodie", variantLabel: "Charcoal / M", quantity: 1, priceCents: 14_800,
  }).returning();
  return { order, line };
}

describe("POST /api/returns (buyer return request)", () => {
  it("stores the order's real items, keeps only the buyer's uploaded photos, and tells the seller", async () => {
    const seller = await seedSeller("ret-a");
    const buyer = await seedBuyer("ret-a");
    const { order, line } = await seedDeliveredOrder(seller, buyer);
    const photo = `${evidencePrefix(buyer)}photo-1`;

    const created = await call(app.base, "POST", "/api/returns", buyer, {
      orderId: order.id,
      reason: "damaged",
      notes: "Seam split on the left sleeve.",
      evidenceUrls: [photo],
      // A client-sent price is ignored: the order's own line is the truth.
      requestedItems: [{ lineItemId: "item_0", productName: "Hoodie", unitPriceCents: 1, quantity: 9 }],
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: "pending", reason: "damaged", resolutionRequested: "refund" });
    expect(created.body.requestedItems).toEqual([{
      lineItemId: line.id, productName: "Ember Heavyweight Hoodie", variantTitle: "Charcoal / M", quantity: 1, unitPriceCents: 14_800,
    }]);

    const sellerRow = await waitFor(async () => published.find((n) => n.userId === seller));
    expect(sellerRow).toMatchObject({
      category: "returns",
      type: "return_request_received",
      targetType: "return",
      targetId: created.body.id,
      body: `Order #${order.orderNumber}. Review the request and approve or decline it.`,
    });
    expect(String(sellerRow.title)).toMatch(/requested a return$/);
    expect(published.find((n) => n.userId === buyer)).toMatchObject({ type: "return_requested", targetType: "return" });

    // Both sides can read it back with names; nobody else can.
    const asSeller = await call(app.base, "GET", `/api/returns/${created.body.id}`, seller);
    expect(asSeller.status).toBe(200);
    expect(asSeller.body).toMatchObject({ orderNumber: order.orderNumber, sellerName: "Seller ret-a", status: "pending" });
    expect(typeof asSeller.body.buyerName).toBe("string");
    expect((await call(app.base, "GET", `/api/returns/${created.body.id}`, buyer)).status).toBe(200);
    const stranger = await seedBuyer("ret-a-stranger");
    expect((await call(app.base, "GET", `/api/returns/${created.body.id}`, stranger)).status).toBe(403);

    const sellerList = await call(app.base, "GET", "/api/returns", seller);
    expect(sellerList.body.map((r: any) => r.id)).toContain(created.body.id);

    // One active request per order.
    const again = await call(app.base, "POST", "/api/returns", buyer, { orderId: order.id, reason: "damaged" });
    expect(again.status).toBe(409);
  });

  it("refuses evidence that is not the buyer's own upload", async () => {
    const seller = await seedSeller("ret-b");
    const buyer = await seedBuyer("ret-b");
    const other = await seedBuyer("ret-b-other");
    const { order } = await seedDeliveredOrder(seller, buyer);
    for (const evidenceUrls of [
      ["file:///var/mobile/photo.jpg"],
      ["blob:http://localhost/abc"],
      [`${evidencePrefix(other)}theirs`],
      ["/objects/uploads/someone-elses-file"],
      Array.from({ length: 6 }, (_, i) => `${evidencePrefix(buyer)}p${i}`),
    ]) {
      const res = await call(app.base, "POST", "/api/returns", buyer, { orderId: order.id, reason: "damaged", evidenceUrls });
      expect(res.status).toBe(400);
    }
    expect(published).toHaveLength(0);
  });

  it("only the buyer of a shipped/delivered order can request a return", async () => {
    const seller = await seedSeller("ret-c");
    const buyer = await seedBuyer("ret-c");
    const { order } = await seedDeliveredOrder(seller, buyer);
    expect((await call(app.base, "POST", "/api/returns", seller, { orderId: order.id, reason: "damaged" })).status).toBe(403);
    const [pending] = await db.insert(orders).values({
      ownerId: seller, buyerId: buyer, orderNumber: uid("BT-RET"), status: "pending", subtotalCents: 1_000, totalCents: 1_000,
    }).returning();
    expect((await call(app.base, "POST", "/api/returns", buyer, { orderId: pending.id, reason: "damaged" })).status).toBe(400);
  });
});
