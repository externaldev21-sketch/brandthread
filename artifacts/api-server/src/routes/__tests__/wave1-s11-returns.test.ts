/**
 * Wave 1 / slice s11 — routes/returns.ts defects:
 *   - a malformed orderId hit the uuid column and 500'd with the raw pg error;
 *   - two simultaneous requests for one order could both pass the
 *     "one active return per order" check and create two returns;
 *   - an evidence path with `..` segments passed the buyer-prefix check;
 *   - the seller's deny response returned raw private evidence paths instead
 *     of signed URLs (every other response signs them);
 *   - the evidence upload's size message said 8 MB while the limit is 20 MB.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../notifications-feed", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../notifications-feed")>()),
  publishNotification: async () => {},
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
vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class {
    async getObjectEntityDownloadURL(path: string) { return `https://signed.test${path}`; }
  },
}));

import { eq } from "drizzle-orm";
import { db, orderItems, orders, returns } from "@workspace/db";
import returnsRouter, { evidencePrefix } from "../returns";
import { call, seedBuyer, seedSeller, startApp, uid } from "../../lib/money/__tests__/moneyHarness";

let app: { base: string; close: () => Promise<void> };
beforeAll(async () => {
  app = await startApp((server) => server.use("/api/returns", returnsRouter));
});
afterAll(async () => { await app?.close(); });

async function seedDeliveredOrder(sellerId: string, buyerId: string) {
  const [order] = await db.insert(orders).values({
    ownerId: sellerId, buyerId, orderNumber: uid("BT-W1RET"), status: "delivered",
    subtotalCents: 5_000, totalCents: 5_000,
  }).returning();
  await db.insert(orderItems).values({ orderId: order.id, productName: "Tee", quantity: 1, priceCents: 5_000 });
  return order;
}

describe("returns (wave1 s11)", () => {
  it("answers 404 for a malformed orderId instead of a 500", async () => {
    const buyer = await seedBuyer("w1ret-a");
    const res = await call(app.base, "POST", "/api/returns", buyer, { orderId: "not-a-uuid", reason: "damaged" });
    expect(res.status).toBe(404);
  });

  it("creates exactly one return when the buyer submits twice at once", async () => {
    const seller = await seedSeller("w1ret-b");
    const buyer = await seedBuyer("w1ret-b");
    const order = await seedDeliveredOrder(seller, buyer);
    const results = await Promise.all(Array.from({ length: 20 }, () =>
      call(app.base, "POST", "/api/returns", buyer, { orderId: order.id, reason: "damaged" })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(19);
    const rows = await db.select({ id: returns.id }).from(returns).where(eq(returns.orderId, order.id));
    expect(rows).toHaveLength(1);
  });

  it("refuses evidence paths that climb out of the buyer's prefix", async () => {
    const seller = await seedSeller("w1ret-c");
    const buyer = await seedBuyer("w1ret-c");
    const other = await seedBuyer("w1ret-c-other");
    const order = await seedDeliveredOrder(seller, buyer);
    const sneaky = `${evidencePrefix(buyer)}../${evidencePrefix(other).split("/").filter(Boolean).pop()}/photo`;
    const res = await call(app.base, "POST", "/api/returns", buyer, { orderId: order.id, reason: "damaged", evidenceUrls: [sneaky] });
    expect(res.status).toBe(400);
  });

  it("signs evidence on the seller's deny response", async () => {
    const seller = await seedSeller("w1ret-d");
    const buyer = await seedBuyer("w1ret-d");
    const order = await seedDeliveredOrder(seller, buyer);
    const photo = `${evidencePrefix(buyer)}photo-1`;
    const created = await call(app.base, "POST", "/api/returns", buyer, { orderId: order.id, reason: "damaged", evidenceUrls: [photo] });
    expect(created.status).toBe(201);
    const denied = await call(app.base, "PATCH", `/api/returns/${created.body.id}/status`, seller, { status: "denied" });
    expect(denied.status).toBe(200);
    expect(denied.body.status).toBe("denied");
    expect(denied.body.evidenceUrls).toEqual([`https://signed.test${photo}`]);
  });

  it("states the real 20 MB limit for evidence photos", async () => {
    const buyer = await seedBuyer("w1ret-e");
    const response = await fetch(`${app.base}/api/returns/evidence`, {
      method: "POST", headers: { "content-type": "image/png", "x-test-user": buyer }, body: Buffer.alloc(0),
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain("20 MB");
  });
});
