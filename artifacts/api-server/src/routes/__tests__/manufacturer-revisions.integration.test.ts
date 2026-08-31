/**
 * Uses database-created timestamps (which retain microseconds) to prove that
 * revision tokens, not serialized timestamps, control optimistic concurrency.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, manufacturers, sampleOrders } from "@workspace/db";

const state = vi.hoisted(() => ({ userId: "" }));
const uploads = vi.hoisted(() => ({
  paths: [] as string[],
  deleted: [] as string[],
  acl: [] as Array<{ path: string; visibility: string }>,
  deleteOwnerOnAcl: false,
  failAcl: false,
}));
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: state.userId }),
  clerkClient: { users: { getUser: async () => null } },
}));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = state.userId;
    next();
  },
  requirePlan: () => (_req: any, _res: any, next: () => void) => next(),
}));
vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class {
    async createObjectEntityFromBuffer() {
      const path = `/objects/revision-upload-${uploads.paths.length + 1}`;
      uploads.paths.push(path);
      return path;
    }
    async trySetObjectEntityAclPolicy(path: string, policy: { visibility: string }) {
      uploads.acl.push({ path, visibility: policy.visibility });
      if (uploads.failAcl) throw new Error("ACL write failed");
      if (uploads.deleteOwnerOnAcl) {
        const { db: liveDb, manufacturers: liveManufacturers } = await import("@workspace/db");
        const { eq: liveEq } = await import("drizzle-orm");
        await liveDb.delete(liveManufacturers).where(liveEq(liveManufacturers.clerkId, state.userId));
      }
    }
    async getObjectEntityDownloadURL(path: string) { return `https://storage.test${path}`; }
    async deleteObjectEntity(path: string) { uploads.deleted.push(path); }
  },
}));

let server: Server;
let base = "";
let manufacturerId = "";
let orderId = "";
let decisionOrderId = "";
let manufacturerUserId = "";

async function patch(path: string, body: unknown) {
  return fetch(`${base}${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
async function postImage(path: string) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "image/jpeg" },
    body: Buffer.from([0xff, 0xd8, 0xff, 0x00]),
  });
}

beforeAll(async () => {
  state.userId = `manufacturer-revision-${crypto.randomBytes(8).toString("hex")}`;
  manufacturerUserId = state.userId;
  const [manufacturer] = await db.insert(manufacturers).values({
    clerkId: state.userId, businessName: "Revision Factory", country: "US",
    specialty: "Cut and sew", moq: 100, priceRange: "$$", bulkTurnaround: "30 days",
    sampleTurnaround: "7 days", status: "active",
  }).returning();
  manufacturerId = manufacturer.id;
  const [order] = await db.insert(sampleOrders).values({
    manufacturerId, sellerId: `seller-${state.userId}`, orderType: "bulk",
    title: "Revision Jacket", quantity: 50, priceCents: 500000, status: "payment_received",
  }).returning();
  orderId = order.id;
  const [decisionOrder] = await db.insert(sampleOrders).values({
    manufacturerId, sellerId: `seller-${state.userId}`, orderType: "sample",
    title: "Decision Sample", quantity: 1, priceCents: 10000, status: "delivered",
  }).returning();
  decisionOrderId = decisionOrder.id;

  const { default: manufacturersRouter } = await import("../manufacturers");
  const { default: manufacturerPublicRouter } = await import("../manufacturer-public");
  const { default: sampleOrdersRouter } = await import("../sample-orders");
  const app = express();
  app.use((req, _res, next) => {
    (req as any).log = { error: () => undefined };
    next();
  });
  app.use(express.json());
  app.use("/api/manufacturers/public", manufacturerPublicRouter);
  app.use("/api/manufacturers", manufacturersRouter);
  app.use("/api/sample-orders", sampleOrdersRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await db.delete(sampleOrders).where(eq(sampleOrders.id, orderId));
  await db.delete(sampleOrders).where(eq(sampleOrders.id, decisionOrderId));
  await db.delete(manufacturers).where(eq(manufacturers.id, manufacturerId));
});

describe("manufacturer revision concurrency", () => {
  it("accepts the returned profile revision and rejects stale reuse", async () => {
    const [created] = await db.select().from(manufacturers)
      .where(eq(manufacturers.id, manufacturerId)).limit(1);
    expect(created.revision).toBe(1);

    const updated = await patch("/api/manufacturers/me", {
      description: "Updated from a database-created row", expectedRevision: created.revision,
    });
    expect(updated.status).toBe(200);
    const updatedPayload = await updated.json() as { revision: number };
    expect(updatedPayload.revision).toBe(2);

    const stale = await patch("/api/manufacturers/me", {
      description: "Must not overwrite", expectedRevision: created.revision,
    });
    expect(stale.status).toBe(409);
  });

  it("accepts the returned order revision and rejects stale reuse", async () => {
    const [created] = await db.select().from(sampleOrders)
      .where(and(eq(sampleOrders.id, orderId), eq(sampleOrders.manufacturerId, manufacturerId))).limit(1);
    expect(created.revision).toBe(1);

    const updated = await patch(`/api/manufacturers/me/sample-orders/${orderId}/status`, {
      status: "processing", expectedRevision: created.revision,
    });
    expect(updated.status).toBe(200);
    const updatedPayload = await updated.json() as { revision: number };
    expect(updatedPayload.revision).toBe(2);

    const stale = await patch(`/api/manufacturers/me/sample-orders/${orderId}/status`, {
      status: "cut_and_sew", expectedRevision: created.revision,
    });
    expect(stale.status).toBe(409);
  });

  it("atomically preserves paths from concurrent authenticated media uploads", async () => {
    state.userId = `seller-${state.userId}`;
    const responses = await Promise.all([
      postImage(`/api/sample-orders/${orderId}/images/upload`),
      postImage(`/api/sample-orders/${orderId}/images/upload`),
    ]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const [order] = await db.select().from(sampleOrders).where(eq(sampleOrders.id, orderId)).limit(1);
    expect(order.imageUrls).toEqual(expect.arrayContaining(uploads.paths));
    expect((order.imageUrls as string[]).length).toBe(2);
    expect(order.revision).toBe(4);
  });

  it("rejects a stale seller sample decision without replacing notes", async () => {
    const sellerId = `seller-${state.userId.replace(/^seller-/, "")}`;
    state.userId = sellerId;
    const [created] = await db.select().from(sampleOrders).where(eq(sampleOrders.id, decisionOrderId)).limit(1);
    const updated = await patch(`/api/sample-orders/${decisionOrderId}/sample-detail`, {
      status: "approved", review: { decision: "approved" }, expectedRevision: created.revision,
    });
    expect(updated.status).toBe(200);
    const stale = await patch(`/api/sample-orders/${decisionOrderId}/sample-detail`, {
      status: "rejected", review: { decision: "rejected" }, expectedRevision: created.revision,
    });
    expect(stale.status).toBe(409);
    const [persisted] = await db.select().from(sampleOrders).where(eq(sampleOrders.id, decisionOrderId)).limit(1);
    expect(persisted.status).toBe("approved");
    expect(persisted.notes).toContain('"approved"');
  });

  it("keeps profile uploads private and returns only signed display URLs", async () => {
    state.userId = manufacturerUserId;
    const response = await postImage("/api/manufacturers/me/photos");
    expect(response.status).toBe(201);
    const payload = await response.json() as { photo: string; photos: string[] };
    const storedPath = uploads.paths.at(-1)!;
    expect(uploads.acl.at(-1)).toEqual({ path: storedPath, visibility: "private" });
    expect(payload.photo).toBe(`https://storage.test${storedPath}`);
    expect(payload.photos).not.toContain(storedPath);

    const [stored] = await db.select({ photos: manufacturers.photos })
      .from(manufacturers).where(eq(manufacturers.id, manufacturerId)).limit(1);
    expect(stored.photos).toContain(storedPath);
    const ownProfile = await fetch(`${base}/api/manufacturers/me`);
    const ownPayload = await ownProfile.json() as { photos: string[] };
    expect(ownPayload.photos).toContain(`https://storage.test${storedPath}`);
    expect(ownPayload.photos).not.toContain(storedPath);
  });

  it("reorders factory photos with a revision and exposes the new lead publicly", async () => {
    state.userId = manufacturerUserId;
    const originalPhotos = [
      "/objects/factory-cutting",
      "/objects/factory-sewing",
      "/objects/factory-finishing",
    ];
    const [before] = await db.update(manufacturers)
      .set({ photos: originalPhotos })
      .where(eq(manufacturers.id, manufacturerId))
      .returning();

    const response = await patch("/api/manufacturers/me/photos", {
      expectedRevision: before.revision,
      photoOrder: [2, 0, 1],
    });
    expect(response.status).toBe(200);
    const payload = await response.json() as { photos: string[]; revision: number };
    expect(payload.photos).toEqual([
      "https://storage.test/objects/factory-finishing",
      "https://storage.test/objects/factory-cutting",
      "https://storage.test/objects/factory-sewing",
    ]);
    expect(payload.revision).toBe(before.revision + 1);

    const [stored] = await db.select({ photos: manufacturers.photos })
      .from(manufacturers).where(eq(manufacturers.id, manufacturerId)).limit(1);
    expect(stored.photos).toEqual([
      "/objects/factory-finishing",
      "/objects/factory-cutting",
      "/objects/factory-sewing",
    ]);

    const publicResponse = await fetch(`${base}/api/manufacturers/public/${manufacturerId}`);
    expect(publicResponse.status).toBe(200);
    const publicPayload = await publicResponse.json() as { photos: string[] };
    expect(publicPayload.photos[0]).toBe("https://storage.test/objects/factory-finishing");
  });

  it("rejects a fractional photo order without changing stored paths", async () => {
    state.userId = manufacturerUserId;
    const [before] = await db.select().from(manufacturers)
      .where(eq(manufacturers.id, manufacturerId)).limit(1);
    const photosBefore = [...before.photos];

    const response = await patch("/api/manufacturers/me/photos", {
      expectedRevision: before.revision,
      photoOrder: [0.5, 1, 2],
    });
    expect(response.status).toBe(400);

    const [after] = await db.select().from(manufacturers)
      .where(eq(manufacturers.id, manufacturerId)).limit(1);
    expect(after.photos).toEqual(photosBefore);
    expect(after.revision).toBe(before.revision);
  });

  it("deletes the selected factory photo only after a successful revision update", async () => {
    state.userId = manufacturerUserId;
    const photos = [
      "/objects/factory-current",
      "/objects/factory-outdated",
      "/objects/factory-secondary",
    ];
    const [before] = await db.update(manufacturers)
      .set({ photos })
      .where(eq(manufacturers.id, manufacturerId))
      .returning();
    const deletedBefore = uploads.deleted.length;

    const stale = await fetch(`${base}/api/manufacturers/me/photos/1`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: before.revision - 1 }),
    });
    expect(stale.status).toBe(409);
    expect(uploads.deleted).toHaveLength(deletedBefore);

    const response = await fetch(`${base}/api/manufacturers/me/photos/1`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: before.revision }),
    });
    expect(response.status).toBe(200);
    const payload = await response.json() as { photos: string[]; revision: number };
    expect(payload.photos).toEqual([
      "https://storage.test/objects/factory-current",
      "https://storage.test/objects/factory-secondary",
    ]);
    expect(payload.revision).toBe(before.revision + 1);
    expect(uploads.deleted.slice(deletedBefore)).toEqual(["/objects/factory-outdated"]);

    const [stored] = await db.select({ photos: manufacturers.photos })
      .from(manufacturers).where(eq(manufacturers.id, manufacturerId)).limit(1);
    expect(stored.photos).toEqual([
      "/objects/factory-current",
      "/objects/factory-secondary",
    ]);
  });

  it("rejects a fractional delete index without changing revision or storage", async () => {
    state.userId = manufacturerUserId;
    const [before] = await db.select().from(manufacturers)
      .where(eq(manufacturers.id, manufacturerId)).limit(1);
    const photosBefore = [...before.photos];
    const deletedBefore = uploads.deleted.length;

    const response = await fetch(`${base}/api/manufacturers/me/photos/0.5`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: before.revision }),
    });
    expect(response.status).toBe(400);

    const [after] = await db.select().from(manufacturers)
      .where(eq(manufacturers.id, manufacturerId)).limit(1);
    expect(after.photos).toEqual(photosBefore);
    expect(after.revision).toBe(before.revision);
    expect(uploads.deleted).toHaveLength(deletedBefore);
  });

  it("does not publicly serialize pending or private profiles", async () => {
    const [pending] = await db.insert(manufacturers).values({
      businessName: "Pending Private Factory", country: "US", specialty: "Knits",
      status: "pending", isPublicDirectory: true, photos: ["/objects/pending-private"],
    }).returning();
    const [privateActive] = await db.insert(manufacturers).values({
      businessName: "Active Private Factory", country: "US", specialty: "Knits",
      status: "active", isPublicDirectory: false, photos: ["/objects/active-private"],
    }).returning();
    try {
      expect((await fetch(`${base}/api/manufacturers/public/${pending.id}`)).status).toBe(404);
      expect((await fetch(`${base}/api/manufacturers/public/${privateActive.id}`)).status).toBe(404);
      const directory = await (await fetch(`${base}/api/manufacturers/public`)).json() as Array<{ id: string }>;
      expect(directory.some((row) => row.id === pending.id || row.id === privateActive.id)).toBe(false);
    } finally {
      await db.delete(manufacturers).where(eq(manufacturers.id, pending.id));
      await db.delete(manufacturers).where(eq(manufacturers.id, privateActive.id));
    }
  });

  it("signs paths only after active public eligibility is confirmed", async () => {
    const [publicManufacturer] = await db.insert(manufacturers).values({
      businessName: "Eligible Public Factory", country: "US", specialty: "Wovens",
      status: "active", isPublicDirectory: true, photos: ["/objects/eligible-public"],
    }).returning();
    try {
      const response = await fetch(`${base}/api/manufacturers/public/${publicManufacturer.id}`);
      expect(response.status).toBe(200);
      const payload = await response.json() as { photos: string[] };
      expect(payload.photos).toEqual(["https://storage.test/objects/eligible-public"]);
      expect(JSON.stringify(payload)).not.toContain('"/objects/eligible-public"');
    } finally {
      await db.delete(manufacturers).where(eq(manufacturers.id, publicManufacturer.id));
    }
  });

  it("deletes a newly created object when the profile DB write cannot attach it", async () => {
    const cleanupUserId = `manufacturer-photo-cleanup-${crypto.randomBytes(6).toString("hex")}`;
    await db.insert(manufacturers).values({
      clerkId: cleanupUserId, businessName: "Cleanup Factory", country: "US", specialty: "Denim",
      status: "active",
    });
    state.userId = cleanupUserId;
    uploads.deleteOwnerOnAcl = true;
    try {
      const response = await postImage("/api/manufacturers/me/photos");
      expect(response.status).toBe(409);
      expect(uploads.deleted).toContain(uploads.paths.at(-1));
    } finally {
      uploads.deleteOwnerOnAcl = false;
      state.userId = manufacturerUserId;
      await db.delete(manufacturers).where(eq(manufacturers.clerkId, cleanupUserId));
    }
  });

  it("deletes a newly created object when private ACL persistence fails", async () => {
    state.userId = manufacturerUserId;
    uploads.failAcl = true;
    try {
      const response = await postImage("/api/manufacturers/me/photos");
      expect(response.status).toBe(500);
      expect(uploads.deleted).toContain(uploads.paths.at(-1));
    } finally {
      uploads.failAcl = false;
    }
  });
});