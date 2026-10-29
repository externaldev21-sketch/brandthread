/**
 * Wave 1 audit (slice s08): a tampered "recent" cursor on a place page must
 * be ignored, not sent to Postgres as a uuid (which made the page 500).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { inArray } from "drizzle-orm";
import { db, places, posts, users } from "@workspace/db";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const uid = req.header("x-test-user-id");
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    req.clerkUserId = uid;
    next();
  },
}));
vi.mock("../../middlewares/rateLimit", () => ({ rateLimit: () => (_q: any, _s: any, next: () => void) => next() }));
vi.mock("../../lib/safety", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/safety")>();
  return { ...real, optionalViewerId: (req: any) => req.header("x-test-user-id") || null };
});

const suffix = crypto.randomBytes(5).toString("hex");
const seller = `w1s08-pl-${suffix}`;
let server: Server;
let base = "";
let placeId = "";
const postIds: string[] = [];

async function call(method: string, path: string, userId?: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(userId ? { "x-test-user-id": userId } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json().catch(() => null)) as any };
}

beforeAll(async () => {
  await db.insert(users).values({
    clerkId: seller, email: `${seller}@t.local`, name: "Seller", username: seller.replace(/-/g, "_"),
    role: "seller", accountType: "seller",
  } as any);
  const { default: placesRouter } = await import("../places");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).log = { error: () => {}, warn: () => {} }; next(); });
  app.use("/api/places", placesRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const created = await call("POST", "/api/places", seller, { name: `Cursor Park ${suffix}` });
  placeId = created.body.place.id;
  const [row] = await db.insert(posts).values({
    userId: seller, placeId, mediaUrl: "https://img.test/a.jpg", mediaUrls: ["https://img.test/a.jpg"],
    mediaType: "photo", caption: "seeded", postStatus: "published", publishedAt: new Date(),
  } as any).returning();
  postIds.push(row.id);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  if (postIds.length) await db.delete(posts).where(inArray(posts.id, postIds));
  if (placeId) await db.delete(places).where(inArray(places.id, [placeId]));
  await db.delete(users).where(inArray(users.clerkId, [seller]));
});

describe("GET /api/places/:id/posts?sort=recent", () => {
  it("ignores a cursor whose id part is not a uuid", async () => {
    const cursor = Buffer.from(`${new Date(Date.now() + 60_000).toISOString()}|not-a-uuid`, "utf8").toString("base64url");
    const res = await call("GET", `/api/places/${placeId}/posts?sort=recent&cursor=${cursor}`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: any) => i.id)).toEqual(postIds);
  });
});
