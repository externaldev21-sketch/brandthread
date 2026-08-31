import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, manufacturers, savedManufacturers } from "@workspace/db";

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

let server: Server;
let base = "";
const prefix = `manufacturer-favorites-${crypto.randomBytes(8).toString("hex")}`;
const createdManufacturerIds: string[] = [];

const sellers = {
  a: `${prefix}-seller-a`,
  b: `${prefix}-seller-b`,
};

async function request(path: string, method = "GET", body?: unknown) {
  return fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

async function seedManufacturer(overrides: Partial<typeof manufacturers.$inferInsert> = {}) {
  const [row] = await db.insert(manufacturers).values({
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
  const { default: manufacturersRouter } = await import("../manufacturers");
  const app = express();
  app.use((req, _res, next) => {
    (req as any).log = { error: () => undefined, warn: () => undefined };
    next();
  });
  app.use(express.json());
  app.use("/api/manufacturers", manufacturersRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  if (createdManufacturerIds.length) {
    const ids = createdManufacturerIds.splice(0);
    await db.delete(savedManufacturers).where(inArray(savedManufacturers.manufacturerId, ids));
    await db.delete(manufacturers).where(inArray(manufacturers.id, ids));
  }
  auth.userId = "";
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

describe("manufacturer favorites route", () => {
  it("lists, adds, de-duplicates, and removes favorites for the authenticated seller", async () => {
    const first = await seedManufacturer();
    const second = await seedManufacturer();
    auth.userId = sellers.a;

    const initiallyEmpty = await request("/api/manufacturers/favorites");
    expect(initiallyEmpty.status).toBe(200);
    expect(await json(initiallyEmpty)).toEqual([]);

    const added = await request("/api/manufacturers/favorites", "POST", {
      manufacturerId: first.id,
    });
    expect(added.status).toBe(201);
    const addedBody = await json<{ manufacturerId: string; createdAt: string }>(added);
    expect(addedBody.manufacturerId).toBe(first.id);
    expect(Number.isNaN(Date.parse(addedBody.createdAt))).toBe(false);

    const duplicate = await request("/api/manufacturers/favorites", "POST", {
      manufacturerId: first.id,
    });
    expect(duplicate.status).toBe(201);
    expect(await json(duplicate)).toEqual(addedBody);

    const secondAdded = await request("/api/manufacturers/favorites", "POST", {
      manufacturerId: second.id,
    });
    expect(secondAdded.status).toBe(201);

    const listed = await request("/api/manufacturers/favorites");
    expect(listed.status).toBe(200);
    expect((await json<Array<{ manufacturerId: string }>>(listed)).map((row) => row.manufacturerId))
      .toEqual(expect.arrayContaining([first.id, second.id]));

    const removed = await request(`/api/manufacturers/favorites/${first.id}`, "DELETE");
    expect(removed.status).toBe(200);
    expect(await json(removed)).toEqual({ ok: true });

    const afterRemove = await request("/api/manufacturers/favorites");
    expect((await json<Array<{ manufacturerId: string }>>(afterRemove)).map((row) => row.manufacturerId))
      .toEqual([second.id]);
  });

  it("isolates listing and removal between sellers", async () => {
    const first = await seedManufacturer();
    const second = await seedManufacturer();

    auth.userId = sellers.a;
    expect((await request("/api/manufacturers/favorites", "POST", { manufacturerId: first.id })).status).toBe(201);

    auth.userId = sellers.b;
    expect((await request("/api/manufacturers/favorites", "POST", { manufacturerId: second.id })).status).toBe(201);

    const sellerBList = await request("/api/manufacturers/favorites");
    expect(await json(sellerBList)).toEqual([
      expect.objectContaining({ manufacturerId: second.id }),
    ]);

    const sellerBRemoveA = await request(`/api/manufacturers/favorites/${first.id}`, "DELETE");
    expect(sellerBRemoveA.status).toBe(200);

    auth.userId = sellers.a;
    const sellerAList = await request("/api/manufacturers/favorites");
    expect(await json(sellerAList)).toEqual([
      expect.objectContaining({ manufacturerId: first.id }),
    ]);
  });

  it("rejects signed-out list, add, and remove requests", async () => {
    const manufacturer = await seedManufacturer();

    expect((await request("/api/manufacturers/favorites")).status).toBe(401);
    expect((await request("/api/manufacturers/favorites", "POST", { manufacturerId: manufacturer.id })).status).toBe(401);
    expect((await request(`/api/manufacturers/favorites/${manufacturer.id}`, "DELETE")).status).toBe(401);
  });

  it("rejects missing, inactive, and private manufacturers", async () => {
    const inactive = await seedManufacturer({ status: "suspended" });
    const privateManufacturer = await seedManufacturer({ isPublicDirectory: false });
    auth.userId = sellers.a;

    const missing = await request("/api/manufacturers/favorites", "POST", {
      manufacturerId: crypto.randomUUID(),
    });
    expect(missing.status).toBe(404);
    expect(await json(missing)).toEqual({ error: "Manufacturer not found" });

    const inactiveResponse = await request("/api/manufacturers/favorites", "POST", {
      manufacturerId: inactive.id,
    });
    expect(inactiveResponse.status).toBe(404);

    const privateResponse = await request("/api/manufacturers/favorites", "POST", {
      manufacturerId: privateManufacturer.id,
    });
    expect(privateResponse.status).toBe(404);

    const [savedRows] = await Promise.all([
      db.select().from(savedManufacturers).where(eq(savedManufacturers.sellerId, sellers.a)),
      db.select().from(savedManufacturers).where(and(
        eq(savedManufacturers.sellerId, sellers.a),
        eq(savedManufacturers.manufacturerId, inactive.id),
      )),
    ]);
    expect(savedRows).toEqual([]);
  });
});