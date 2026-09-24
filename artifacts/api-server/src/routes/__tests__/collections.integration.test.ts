import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, savedCollections, savedItems } from "@workspace/db";

const auth = vi.hoisted(() => ({ userId: "" }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    if (!auth.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.clerkUserId = auth.userId;
    next();
  },
}));

let server: Server;
let base = "";
const prefix = `collections-${crypto.randomBytes(8).toString("hex")}`;
const buyer = `${prefix}-buyer`;
const otherBuyer = `${prefix}-buyer-2`;
const createdCollectionIds: string[] = [];
const createdItemIds: string[] = [];

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

beforeAll(async () => {
  const { default: collectionsRouter } = await import("../collections");
  const app = express();
  app.use((req, _res, next) => {
    (req as any).log = { error: () => undefined, warn: () => undefined };
    next();
  });
  app.use(express.json());
  app.use("/api/buyer/collections", collectionsRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  if (createdItemIds.length) {
    await db.delete(savedItems).where(inArray(savedItems.id, createdItemIds.splice(0)));
  }
  if (createdCollectionIds.length) {
    await db.delete(savedCollections).where(inArray(savedCollections.id, createdCollectionIds.splice(0)));
  }
  auth.userId = "";
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

describe("saved collections route", () => {
  it("creates, lists (with item counts), renames, toggles public, and deletes a collection", async () => {
    auth.userId = buyer;

    const created = await request("/api/buyer/collections", "POST", { name: "Fall Fits" });
    expect(created.status).toBe(201);
    const collection = await json<{ id: string; name: string; itemCount: number; isPublic: boolean }>(created);
    createdCollectionIds.push(collection.id);
    expect(collection.name).toBe("Fall Fits");
    expect(collection.itemCount).toBe(0);
    expect(collection.isPublic).toBe(false);

    // File a saved item into it directly (saved.ts owns creation; here we just attach one).
    const [item] = await db.insert(savedItems).values({
      userId: buyer,
      itemType: "product",
      targetId: crypto.randomUUID(),
      title: "Cropped Jacket",
      collectionId: collection.id,
    }).returning();
    createdItemIds.push(item.id);

    const listed = await request("/api/buyer/collections");
    const list = await json<Array<{ id: string; itemCount: number }>>(listed);
    expect(list.find((c) => c.id === collection.id)?.itemCount).toBe(1);

    const renamed = await request(`/api/buyer/collections/${collection.id}`, "PATCH", {
      name: "Winter Fits",
      isPublic: true,
    });
    expect(renamed.status).toBe(200);
    const renamedBody = await json<{ name: string; isPublic: boolean }>(renamed);
    expect(renamedBody.name).toBe("Winter Fits");
    expect(renamedBody.isPublic).toBe(true);

    const itemsResponse = await request(`/api/buyer/collections/${collection.id}/items`);
    expect(itemsResponse.status).toBe(200);
    const itemsBody = await json<{ items: Array<{ id: string; title: string }> }>(itemsResponse);
    expect(itemsBody.items).toHaveLength(1);
    expect(itemsBody.items[0].title).toBe("Cropped Jacket");

    const deleted = await request(`/api/buyer/collections/${collection.id}`, "DELETE");
    expect(deleted.status).toBe(200);

    const afterDelete = await request("/api/buyer/collections");
    expect((await json<Array<{ id: string }>>(afterDelete)).map((c) => c.id)).not.toContain(collection.id);

    // Deleting a collection un-files its items rather than deleting them.
    const [survivingItem] = await db.select().from(savedItems).where(eq(savedItems.id, item.id));
    expect(survivingItem.collectionId).toBeNull();
    createdCollectionIds.length = 0; // already deleted
  });

  it("persists drag-to-reorder", async () => {
    auth.userId = buyer;
    const a = await json<{ id: string }>(await request("/api/buyer/collections", "POST", { name: "A" }));
    const b = await json<{ id: string }>(await request("/api/buyer/collections", "POST", { name: "B" }));
    createdCollectionIds.push(a.id, b.id);

    const reordered = await request("/api/buyer/collections/reorder", "POST", { orderedIds: [b.id, a.id] });
    expect(reordered.status).toBe(200);

    const list = await json<Array<{ id: string; sortOrder: number }>>(await request("/api/buyer/collections"));
    const bEntry = list.find((c) => c.id === b.id)!;
    const aEntry = list.find((c) => c.id === a.id)!;
    expect(bEntry.sortOrder).toBeLessThan(aEntry.sortOrder);
  });

  it("isolates collections between buyers and rejects signed-out requests", async () => {
    auth.userId = buyer;
    const mine = await json<{ id: string }>(await request("/api/buyer/collections", "POST", { name: "Mine" }));
    createdCollectionIds.push(mine.id);

    auth.userId = otherBuyer;
    const theirList = await json<Array<{ id: string }>>(await request("/api/buyer/collections"));
    expect(theirList.map((c) => c.id)).not.toContain(mine.id);

    const theirDeleteAttempt = await request(`/api/buyer/collections/${mine.id}`, "DELETE");
    expect(theirDeleteAttempt.status).toBe(200); // no-op delete (scoped by userId, deletes 0 rows)

    auth.userId = buyer;
    const stillThere = await json<Array<{ id: string }>>(await request("/api/buyer/collections"));
    expect(stillThere.map((c) => c.id)).toContain(mine.id);

    auth.userId = "";
    expect((await request("/api/buyer/collections")).status).toBe(401);
    expect((await request("/api/buyer/collections", "POST", { name: "x" })).status).toBe(401);
  });
});
