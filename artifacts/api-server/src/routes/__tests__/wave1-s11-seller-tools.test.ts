/**
 * Wave 1 / slice s11 — seller tool routes:
 *   - seller-locations: deleting the primary location ran
 *     `UPDATE … ORDER BY … LIMIT 1` (not valid PostgreSQL) and always 500'd;
 *     malformed ids / bodies 500'd with the raw database message;
 *   - seller-metafields: a missing body or non-boolean `pinned` 500'd;
 *   - seller-affiliate: a pending application could be paused and then set
 *     active, skipping approval; malformed creator ids 500'd;
 *   - seller-hub: malformed RFQ ids, a missing body and non-string fields 500'd;
 *   - seller-export: a request with no body 500'd; a bare \r wasn't quoted in CSV;
 *   - sample-orders: a seller decision dropped the order's free-text notes
 *     (and 500'd when they parsed to a non-object); tracking accepted any
 *     JSON value; malformed order ids 500'd.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../notifications-feed", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../notifications-feed")>()),
  publishNotification: async () => {},
}));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = req.headers["x-test-user"];
    next();
  },
}));
vi.mock("../../middlewares/requireRole", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../middlewares/requireRole")>()),
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { eq, sql } from "drizzle-orm";
import { affiliateCreators, db, manufacturers, sampleOrders } from "@workspace/db";
import sellerLocationsRouter from "../seller-locations";
import sellerMetafieldsRouter from "../seller-metafields";
import sellerAffiliateRouter from "../seller-affiliate";
import sellerHubRouter from "../seller-hub";
import sellerExportRouter, { toCSV } from "../seller-export";
import sampleOrdersRouter from "../sample-orders";
import { call, seedManufacturer, seedSeller, startApp, uid } from "../../lib/money/__tests__/moneyHarness";

let app: { base: string; close: () => Promise<void> };
beforeAll(async () => {
  app = await startApp((server) => {
    server.use("/api/seller/locations", sellerLocationsRouter);
    server.use("/api/seller/metafields", sellerMetafieldsRouter);
    server.use("/api/seller/affiliate", sellerAffiliateRouter);
    server.use("/api/seller-hub", sellerHubRouter);
    server.use("/api/seller/export", sellerExportRouter);
    server.use("/api/sample-orders", sampleOrdersRouter);
  });
});
afterAll(async () => { await app?.close(); });

async function bare(method: string, path: string, user: string) {
  const response = await fetch(`${app.base}${path}`, { method, headers: { "x-test-user": user } });
  return { status: response.status, body: await response.json().catch(() => null) as any };
}

describe("seller locations", () => {
  it("deletes the primary location and promotes the oldest remaining one", async () => {
    const seller = await seedSeller("w1loc-a");
    const first = await call(app.base, "POST", "/api/seller/locations", seller, { name: "Warehouse" });
    expect(first.status).toBe(201);
    expect(first.body.location.is_primary).toBe(true);
    const second = await call(app.base, "POST", "/api/seller/locations", seller, { name: "Shop" });
    expect(second.body.location.is_primary).toBe(false);
    const removed = await call(app.base, "DELETE", `/api/seller/locations/${first.body.location.id}`, seller);
    expect(removed.status).toBe(200);
    const list = await call(app.base, "GET", "/api/seller/locations", seller);
    expect(list.body.locations).toHaveLength(1);
    expect(list.body.locations[0]).toMatchObject({ id: second.body.location.id, is_primary: true });
  });

  it("rejects malformed ids and bodies without a 500", async () => {
    const seller = await seedSeller("w1loc-b");
    expect((await call(app.base, "PATCH", "/api/seller/locations/not-a-uuid", seller, { name: "X" })).status).toBe(404);
    expect((await call(app.base, "DELETE", "/api/seller/locations/not-a-uuid", seller)).status).toBe(404);
    expect((await call(app.base, "POST", "/api/seller/locations", seller, { name: 5 })).status).toBe(400);
    expect((await call(app.base, "POST", "/api/seller/locations", seller, { name: "Ok", isActive: "yes" })).status).toBe(400);
    const created = await bare("POST", "/api/seller/locations", seller);
    expect(created.status).toBe(201);
    expect(created.body.location.name).toBe("New Location");
  });
});

describe("seller metafields", () => {
  it("rejects a missing body and a non-boolean pinned without a 500", async () => {
    const seller = await seedSeller("w1meta-a");
    expect((await bare("POST", "/api/seller/metafields", seller)).status).toBe(400);
    const bad = await call(app.base, "POST", "/api/seller/metafields", seller, {
      ownerResource: "products", key: "fabric", name: "Fabric", pinned: "yes",
    });
    expect(bad.status).toBe(400);
  });
});

describe("seller affiliate", () => {
  it("won't pause (then activate) a pending application without approval", async () => {
    const seller = await seedSeller("w1aff-a");
    const creator = await seedSeller("w1aff-a-creator");
    const [row] = await db.insert(affiliateCreators).values({
      sellerId: seller, creatorId: creator, status: "pending", origin: "apply", code: uid("W1AFF").toUpperCase(),
    }).returning();
    const paused = await call(app.base, "PATCH", `/api/seller/affiliate/creators/${row.id}`, seller, { status: "paused" });
    expect(paused.status).toBe(409);
    const [after] = await db.select().from(affiliateCreators).where(eq(affiliateCreators.id, row.id));
    expect(after.status).toBe("pending");
  });

  it("answers 404 for a malformed creator id", async () => {
    const seller = await seedSeller("w1aff-b");
    expect((await call(app.base, "PATCH", "/api/seller/affiliate/creators/not-a-uuid", seller, { status: "paused" })).status).toBe(404);
    expect((await call(app.base, "DELETE", "/api/seller/affiliate/creators/not-a-uuid", seller)).status).toBe(404);
  });
});

describe("seller hub", () => {
  it("rejects malformed ids, missing bodies and non-string fields without a 500", async () => {
    const seller = await seedSeller("w1hub-a");
    expect((await call(app.base, "GET", "/api/seller-hub/rfqs/not-a-uuid", seller)).status).toBe(404);
    expect((await call(app.base, "PATCH", "/api/seller-hub/rfqs/not-a-uuid", seller, { status: "cancelled" })).status).toBe(404);
    expect((await bare("POST", "/api/seller-hub/quote-requests", seller)).status).toBe(400);
    expect((await bare("PATCH", "/api/seller-hub/rfqs/00000000-0000-4000-8000-000000000000", seller)).status).toBe(400);
    const mfr = await seedManufacturer();
    await db.update(manufacturers).set({ isPublicDirectory: true }).where(eq(manufacturers.id, mfr.id));
    const bad = await call(app.base, "POST", "/api/seller-hub/quote-requests", seller, {
      manufacturerId: mfr.id, productName: "Hoodie", productType: 5,
    });
    expect(bad.status).toBe(400);
    const badRfq = await call(app.base, "POST", "/api/seller-hub/rfqs", seller, {
      garmentType: "Hoodie", quantity: 10, category: 5, manufacturerIds: [mfr.id],
    });
    expect(badRfq.status).toBe(400);
  });
});

describe("seller export", () => {
  it("quotes CSV values that contain a carriage return", () => {
    expect(toCSV([{ note: "line one\rline two" }], ["note"])).toBe('note\n"line one\rline two"');
  });

  it("uses the defaults when the request has no body", async () => {
    const seller = await seedSeller("w1exp-a");
    const res = await bare("POST", "/api/seller/export", seller);
    expect(res.status).toBe(200);
    expect(res.body.counts).toEqual({ products: 0, orders: 0, customers: 0 });
  });
});

describe("sample orders", () => {
  async function seedOrder(sellerId: string, values: Partial<typeof sampleOrders.$inferInsert>) {
    const mfr = await seedManufacturer();
    const mfrUser = uid("w1so-mfr");
    await db.update(manufacturers).set({ clerkId: mfrUser }).where(eq(manufacturers.id, mfr.id));
    const [order] = await db.insert(sampleOrders).values({
      manufacturerId: mfr.id, sellerId, title: "Sample tee", priceCents: 5_000, ...values,
    }).returning();
    return { order, mfrUser };
  }

  it("keeps free-text notes when the seller records a decision", async () => {
    const seller = await seedSeller("w1so-a");
    const { order } = await seedOrder(seller, { status: "delivered", notes: "Use organic cotton, please" });
    const res = await call(app.base, "PATCH", `/api/sample-orders/${order.id}/sample-detail`, seller, {
      status: "approved", review: { decision: "approved" }, expectedRevision: order.revision,
    });
    expect(res.status).toBe(200);
    const details = JSON.parse(res.body.notes);
    expect(details).toMatchObject({ review: { decision: "approved" }, legacyNotes: "Use organic cotton, please" });
  });

  it("handles notes that parse to a non-object", async () => {
    const seller = await seedSeller("w1so-b");
    const { order } = await seedOrder(seller, { status: "delivered", notes: "42" });
    const res = await call(app.base, "PATCH", `/api/sample-orders/${order.id}/sample-detail`, seller, {
      status: "revision_requested", revision: { note: "Shorter sleeves" }, expectedRevision: order.revision,
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body.notes)).toMatchObject({ legacyNotes: "42", revisions: [{ note: "Shorter sleeves" }] });
  });

  it("requires a text tracking number", async () => {
    const seller = await seedSeller("w1so-c");
    const { order, mfrUser } = await seedOrder(seller, { status: "packing" });
    const res = await call(app.base, "PATCH", `/api/sample-orders/${order.id}/tracking`, mfrUser, { trackingNumber: { n: 1 } });
    expect(res.status).toBe(400);
    const [row] = await db.select({ status: sampleOrders.status }).from(sampleOrders).where(eq(sampleOrders.id, order.id));
    expect(row.status).toBe("packing");
  });

  it("answers 404 for a malformed order id", async () => {
    const seller = await seedSeller("w1so-d");
    expect((await call(app.base, "GET", "/api/sample-orders/not-a-uuid", seller)).status).toBe(404);
    expect((await call(app.base, "POST", "/api/sample-orders/not-a-uuid/pay", seller, {})).status).toBe(404);
  });
});

void sql;
