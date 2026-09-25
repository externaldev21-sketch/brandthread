import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { inArray } from "drizzle-orm";
import { db, manufacturers, sellerRfqs, sellerQuoteRequests } from "@workspace/db";

const auth = vi.hoisted(() => ({ userId: "" }));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: auth.userId || null }),
  clerkClient: { users: { getUser: async () => null } },
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    if (!auth.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.clerkUserId = auth.userId;
    next();
  },
  requirePlan: () => (_req: any, _res: any, next: () => void) => next(),
}));

vi.mock("../../middlewares/requireRole", () => ({
  teamContext: () => (_req: any, _res: any, next: () => void) => next(),
}));

vi.mock("../../routes/notifications-feed", () => ({
  publishNotification: async () => undefined,
}));

vi.mock("../../lib/brandthreadEmail", () => ({
  sendManufacturerSignupEmail: async () => undefined,
}));

vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class {
    async getObjectEntityDownloadURL(path: string) {
      return `https://objects.test${path}`;
    }
  },
}));

let sellerHubServer: Server;
let manufacturersServer: Server;
let sellerHubBase = "";
let manufacturersBase = "";
const prefix = `seller-rfqs-${crypto.randomBytes(8).toString("hex")}`;
const createdManufacturerIds: string[] = [];
const seller = `${prefix}-seller`;

async function request(base: string, path: string, method = "GET", body?: unknown) {
  return fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

async function seedManufacturer(clerkId: string | null, overrides: Partial<typeof manufacturers.$inferInsert> = {}) {
  const [row] = await db.insert(manufacturers).values({
    clerkId,
    businessName: `${prefix}-factory-${createdManufacturerIds.length}`,
    country: "US",
    specialty: "Cut and sew",
    status: "active",
    isPublicDirectory: true,
    ...overrides,
  }).returning();
  createdManufacturerIds.push(row.id);
  return row;
}

beforeAll(async () => {
  const { default: sellerHubRouter } = await import("../seller-hub");
  const { default: manufacturersRouter } = await import("../manufacturers");

  const sellerHubApp = express();
  sellerHubApp.use((req, _res, next) => {
    (req as any).log = { error: () => undefined, warn: () => undefined };
    next();
  });
  sellerHubApp.use(express.json());
  sellerHubApp.use("/api/seller-hub", sellerHubRouter);
  await new Promise<void>((resolve) => {
    sellerHubServer = sellerHubApp.listen(0, "127.0.0.1", () => resolve());
  });
  sellerHubBase = `http://127.0.0.1:${(sellerHubServer.address() as AddressInfo).port}`;

  const manufacturersApp = express();
  manufacturersApp.use((req, _res, next) => {
    (req as any).log = { error: () => undefined, warn: () => undefined };
    next();
  });
  manufacturersApp.use(express.json());
  manufacturersApp.use("/api/manufacturers", manufacturersRouter);
  await new Promise<void>((resolve) => {
    manufacturersServer = manufacturersApp.listen(0, "127.0.0.1", () => resolve());
  });
  manufacturersBase = `http://127.0.0.1:${(manufacturersServer.address() as AddressInfo).port}`;
});

afterEach(async () => {
  if (createdManufacturerIds.length) {
    const ids = createdManufacturerIds.splice(0);
    const rfqs = await db.select({ id: sellerRfqs.id }).from(sellerRfqs).where(inArray(sellerRfqs.sellerId, [seller]));
    if (rfqs.length) {
      await db.delete(sellerQuoteRequests).where(inArray(sellerQuoteRequests.rfqId, rfqs.map((r) => r.id)));
      await db.delete(sellerRfqs).where(inArray(sellerRfqs.id, rfqs.map((r) => r.id)));
    }
    await db.delete(sellerQuoteRequests).where(inArray(sellerQuoteRequests.manufacturerId, ids));
    await db.delete(manufacturers).where(inArray(manufacturers.id, ids));
  }
  auth.userId = "";
});

afterAll(async () => {
  await Promise.all([
    new Promise<void>((resolve, reject) => sellerHubServer.close((error) => error ? reject(error) : resolve())),
    new Promise<void>((resolve, reject) => manufacturersServer.close((error) => error ? reject(error) : resolve())),
  ]);
});

describe("seller RFQ broadcast + quote comparison", () => {
  it("fans an RFQ out to every selected active manufacturer", async () => {
    const mfrA = await seedManufacturer(`${prefix}-mfr-clerk-a`);
    const mfrB = await seedManufacturer(`${prefix}-mfr-clerk-b`);
    auth.userId = seller;

    const created = await request(sellerHubBase, "/api/seller-hub/rfqs", "POST", {
      garmentType: "Crewneck Sweatshirt",
      category: "Cut & Sew",
      description: "500 unit run, oversized fit",
      quantity: 500,
      targetPriceCents: 1200,
      manufacturerIds: [mfrA.id, mfrB.id],
    });
    expect(created.status).toBe(201);
    const body = await json<{ id: string; manufacturersCount: number; status: string }>(created);
    expect(body.manufacturersCount).toBe(2);
    expect(body.status).toBe("matched");

    const detail = await request(sellerHubBase, `/api/seller-hub/rfqs/${body.id}`);
    expect(detail.status).toBe(200);
    const detailBody = await json<{ quotes: Array<{ manufacturerName: string; status: string }> }>(detail);
    expect(detailBody.quotes).toHaveLength(2);
    expect(detailBody.quotes.every((q) => q.status === "submitted")).toBe(true);
  });

  it("rejects an RFQ with no manufacturers or with an inactive one only", async () => {
    auth.userId = seller;
    const noTargets = await request(sellerHubBase, "/api/seller-hub/rfqs", "POST", {
      garmentType: "Tee", quantity: 100, manufacturerIds: [],
    });
    expect(noTargets.status).toBe(400);

    const inactive = await seedManufacturer(`${prefix}-mfr-clerk-inactive`, { status: "pending" });
    const onlyInactive = await request(sellerHubBase, "/api/seller-hub/rfqs", "POST", {
      garmentType: "Tee", quantity: 100, manufacturerIds: [inactive.id],
    });
    expect(onlyInactive.status).toBe(404);
  });

  it("lets each manufacturer quote independently and the seller compare side by side", async () => {
    const mfrA = await seedManufacturer(`${prefix}-mfr-clerk-c`);
    const mfrB = await seedManufacturer(`${prefix}-mfr-clerk-d`);
    auth.userId = seller;

    const created = await request(sellerHubBase, "/api/seller-hub/rfqs", "POST", {
      garmentType: "Denim Jacket", quantity: 250, manufacturerIds: [mfrA.id, mfrB.id],
    });
    const { id: rfqId } = await json<{ id: string }>(created);

    const detailBefore = await request(sellerHubBase, `/api/seller-hub/rfqs/${rfqId}`);
    const { quotes } = await json<{ quotes: Array<{ id: string; manufacturerId: string }> }>(detailBefore);
    const quoteForA = quotes.find((q) => q.manufacturerId === mfrA.id)!;
    const quoteForB = quotes.find((q) => q.manufacturerId === mfrB.id)!;

    auth.userId = `${prefix}-mfr-clerk-c`;
    const quotedA = await request(manufacturersBase, `/api/manufacturers/me/quote-requests/${quoteForA.id}`, "PATCH", {
      status: "quoted", quotedPriceCents: 1800, quotedTurnaround: "30 days",
    });
    expect(quotedA.status).toBe(200);

    auth.userId = `${prefix}-mfr-clerk-d`;
    const quotedB = await request(manufacturersBase, `/api/manufacturers/me/quote-requests/${quoteForB.id}`, "PATCH", {
      status: "quoted", quotedPriceCents: 1550, quotedTurnaround: "45 days",
    });
    expect(quotedB.status).toBe(200);

    auth.userId = seller;
    const listRfqs = await request(sellerHubBase, "/api/seller-hub/rfqs");
    const rfqList = await json<Array<{ id: string; quotesReceivedCount: number }>>(listRfqs);
    expect(rfqList.find((r) => r.id === rfqId)?.quotesReceivedCount).toBe(2);

    const detailAfter = await request(sellerHubBase, `/api/seller-hub/rfqs/${rfqId}`);
    const detailBody = await json<{ quotes: Array<{ manufacturerId: string; quotedPriceCents: number; status: string }> }>(detailAfter);
    const pricesByManufacturer = new Map(detailBody.quotes.map((q) => [q.manufacturerId, q.quotedPriceCents]));
    expect(pricesByManufacturer.get(mfrA.id)).toBe(1800);
    expect(pricesByManufacturer.get(mfrB.id)).toBe(1550);
    expect(detailBody.quotes.every((q) => q.status === "quoted")).toBe(true);
  });

  it("lets the seller cancel an open RFQ but not one already cancelled", async () => {
    const mfrA = await seedManufacturer(`${prefix}-mfr-clerk-e`);
    auth.userId = seller;
    const created = await request(sellerHubBase, "/api/seller-hub/rfqs", "POST", {
      garmentType: "Beanie", quantity: 300, manufacturerIds: [mfrA.id],
    });
    const { id } = await json<{ id: string }>(created);

    const cancelled = await request(sellerHubBase, `/api/seller-hub/rfqs/${id}`, "PATCH", { status: "cancelled" });
    expect(cancelled.status).toBe(200);
    expect((await json<{ status: string }>(cancelled)).status).toBe("cancelled");

    const cancelAgain = await request(sellerHubBase, `/api/seller-hub/rfqs/${id}`, "PATCH", { status: "cancelled" });
    expect(cancelAgain.status).toBe(409);
  });

  it("isolates RFQs between sellers", async () => {
    const mfrA = await seedManufacturer(`${prefix}-mfr-clerk-f`);
    auth.userId = seller;
    const created = await request(sellerHubBase, "/api/seller-hub/rfqs", "POST", {
      garmentType: "Cap", quantity: 200, manufacturerIds: [mfrA.id],
    });
    const { id } = await json<{ id: string }>(created);

    auth.userId = `${prefix}-other-seller`;
    const otherList = await request(sellerHubBase, "/api/seller-hub/rfqs");
    expect(await json(otherList)).toEqual([]);

    const otherDetail = await request(sellerHubBase, `/api/seller-hub/rfqs/${id}`);
    expect(otherDetail.status).toBe(404);
  });
});
