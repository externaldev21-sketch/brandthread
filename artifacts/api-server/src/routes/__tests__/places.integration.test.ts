import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import { blocks, db, interactions, places, posts, users } from "@workspace/db";

const auth = vi.hoisted(() => ({ userId: "" }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const uid = req.header("x-test-user-id") || auth.userId;
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    req.clerkUserId = uid;
    next();
  },
}));
vi.mock("../../lib/safety", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/safety")>();
  return { ...real, optionalViewerId: (req: any) => req.header("x-test-user-id") || null };
});

const suffix = crypto.randomBytes(5).toString("hex");
const uid = (n: string) => `pl-${n}-${suffix}`;
const seller = uid("seller");
const buyer = uid("buyer");
const blockedAuthor = uid("blocked");
const viewer = uid("viewer");
const userIds = [seller, buyer, blockedAuthor, viewer];
const placeName = (n: string) => `${n} ${suffix}`;

let server: Server;
let base = "";
const postIds: string[] = [];
const placeIds: string[] = [];
const realFetch = globalThis.fetch;

async function call(method: string, path: string, userId?: string, body?: unknown) {
  const response = await realFetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(userId ? { "x-test-user-id": userId } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json().catch(() => null)) as any };
}

async function makePlace(name: string, extra: Record<string, unknown> = {}) {
  const res = await call("POST", "/api/places", seller, { name, ...extra });
  if (res.body?.place?.id) placeIds.push(res.body.place.id);
  return res;
}

async function seedPost(userId: string, placeId: string, extra: Partial<typeof posts.$inferInsert> = {}) {
  const [row] = await db.insert(posts).values({
    userId, placeId, mediaUrl: "https://img.test/a.jpg", mediaUrls: ["https://img.test/a.jpg"], mediaType: "photo",
    caption: "seeded", postStatus: "published", publishedAt: new Date(), ...extra,
  }).returning();
  postIds.push(row.id);
  return row;
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: seller, email: `${seller}@t.local`, name: "Seller", username: seller.replace(/-/g, "_"), role: "seller", accountType: "seller" },
    { clerkId: buyer, email: `${buyer}@t.local`, name: "Buyer", username: buyer.replace(/-/g, "_"), role: "buyer", accountType: "buyer" },
    { clerkId: blockedAuthor, email: `${blockedAuthor}@t.local`, name: "Blocked", username: blockedAuthor.replace(/-/g, "_"), role: "buyer", accountType: "buyer" },
    { clerkId: viewer, email: `${viewer}@t.local`, name: "Viewer", username: viewer.replace(/-/g, "_"), role: "buyer", accountType: "buyer" },
  ]);
  await db.insert(blocks).values({ blockerId: viewer, blockedId: blockedAuthor });
  const [{ default: placesRouter }, { default: postsRouter }] = await Promise.all([import("../places"), import("../posts")]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).log = { error: (...a: unknown[]) => console.error(...a) }; next(); });
  app.use("/api/places", placesRouter);
  app.use("/api/posts", postsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  delete process.env.GOOGLE_PLACES_API_KEY;
  globalThis.fetch = realFetch;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  if (postIds.length > 0) {
    await db.delete(interactions).where(inArray(interactions.postId, postIds));
    await db.delete(posts).where(inArray(posts.id, postIds));
  }
  if (placeIds.length > 0) await db.delete(places).where(inArray(places.id, placeIds));
  await db.delete(blocks).where(inArray(blocks.blockerId, userIds));
  await db.delete(users).where(inArray(users.clerkId, userIds));
});

describe("POST /api/places", () => {
  it("requires auth and validates input", async () => {
    expect((await call("POST", "/api/places", undefined, { name: "x" })).status).toBe(401);
    expect((await call("POST", "/api/places", seller, {})).status).toBe(400);
    expect((await call("POST", "/api/places", seller, { name: "Park", lat: 5 })).status).toBe(400);
    expect((await call("POST", "/api/places", seller, { name: "Park", lat: 100, lng: 0 })).status).toBe(400);
  });

  it("rejects moderated names", async () => {
    const res = await call("POST", "/api/places", seller, { name: "kill yourself plaza" });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("CONTENT_REJECTED");
  });

  it("creates once and merges duplicates (name casing and nearby coordinates)", async () => {
    const name = placeName("Union Square");
    const first = await makePlace(name, { lat: 40.7359, lng: -73.9911 });
    expect(first.status).toBe(201);
    expect(first.body.place).toMatchObject({ name, lat: 40.7359, lng: -73.9911 });
    const dup = await makePlace(name.toUpperCase(), { lat: 40.7361, lng: -73.9908 });
    expect(dup.status).toBe(200);
    expect(dup.body.created).toBe(false);
    expect(dup.body.place.id).toBe(first.body.place.id);
    const elsewhere = await makePlace(name, { lat: 37.788, lng: -122.407 });
    expect(elsewhere.status).toBe(201);
    expect(elsewhere.body.place.id).not.toBe(first.body.place.id);
  });
});

describe("GET /api/places/search", () => {
  it("searches existing places by prefix and word prefix, most used first, and works without a provider key", async () => {
    const quiet = (await makePlace(placeName("Harbor Cafe"))).body.place;
    const busy = (await makePlace(placeName("Harbor Pier"), { city: "Oakland" })).body.place;
    await seedPost(buyer, busy.id);
    await seedPost(seller, busy.id);
    const res = await call("GET", `/api/places/search?q=${encodeURIComponent("harbor")}`);
    expect(res.status).toBe(200);
    expect(res.body.providerEnabled).toBe(false);
    const ids = res.body.places.map((p: any) => p.id);
    expect(ids.indexOf(busy.id)).toBeLessThan(ids.indexOf(quiet.id));
    expect(res.body.places.find((p: any) => p.id === busy.id)).toMatchObject({ source: "local", postCount: 2, city: "Oakland" });
    const word = await call("GET", `/api/places/search?q=${encodeURIComponent("pier " + suffix)}`);
    expect(word.body.places.map((p: any) => p.id)).toContain(busy.id);
    expect((await call("GET", "/api/places/search?q=")).body.places).toEqual([]);
  });

  it("adds Google suggestions only when GOOGLE_PLACES_API_KEY is set, and survives provider failures", async () => {
    process.env.GOOGLE_PLACES_API_KEY = "test-key";
    const seen: any[] = [];
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = String(input);
      if (!url.startsWith("https://places.googleapis.com/")) return realFetch(input, init);
      seen.push({ url, key: init?.headers?.["X-Goog-Api-Key"] });
      return new Response(JSON.stringify({ suggestions: [{ placePrediction: {
        placeId: "ChIJtestplace1", text: { text: "Zeta Gallery, Paris" },
        structuredFormat: { mainText: { text: `Zeta Gallery ${suffix}` }, secondaryText: { text: "Paris, France" } },
      } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const ok = await call("GET", `/api/places/search?q=zeta&lat=48.85&lng=2.35`);
    expect(ok.body.providerEnabled).toBe(true);
    expect(ok.body.places).toContainEqual(expect.objectContaining({
      source: "google", providerPlaceId: "ChIJtestplace1", secondary: "Paris, France",
    }));
    expect(seen[0].key).toBe("test-key");

    globalThis.fetch = (async (input: any, init?: any) => {
      if (String(input).startsWith("https://places.googleapis.com/")) throw new Error("network down");
      return realFetch(input, init);
    }) as typeof fetch;
    const failed = await call("GET", `/api/places/search?q=harbor`);
    expect(failed.status).toBe(200);
    expect(failed.body.places.every((p: any) => p.source === "local")).toBe(true);
  });

  it("resolves a provider place through POST /api/places using Place Details", async () => {
    process.env.GOOGLE_PLACES_API_KEY = "test-key";
    const name = placeName("Provider Museum");
    globalThis.fetch = (async (input: any, init?: any) => {
      if (!String(input).startsWith("https://places.googleapis.com/")) return realFetch(input, init);
      return new Response(JSON.stringify({
        displayName: { text: name }, location: { latitude: 51.5, longitude: -0.12 },
        addressComponents: [
          { longText: "London", shortText: "London", types: ["locality"] },
          { longText: "England", shortText: "ENG", types: ["administrative_area_level_1"] },
          { longText: "United Kingdom", shortText: "GB", types: ["country"] },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const res = await makePlace(name, { providerPlaceId: "ChIJdetailsplace9" });
    expect(res.status).toBe(201);
    expect(res.body.place).toMatchObject({ lat: 51.5, lng: -0.12, city: "London", region: "ENG", country: "United Kingdom" });
    const again = await makePlace(`${name} renamed`, { providerPlaceId: "ChIJdetailsplace9" });
    expect(again.body.place.id).toBe(res.body.place.id);
  });
});

describe("posts accept a location and expose it", () => {
  it("creates with a location object, reads it back, reuses placeId and clears it", async () => {
    const name = placeName("Gallery Row");
    const created = await call("POST", "/api/posts", seller, {
      mediaUrl: "https://img.test/loc.jpg", caption: "opening night",
      location: { name, lat: 34.05, lng: -118.24, city: "Los Angeles" },
    });
    expect(created.status).toBe(201);
    postIds.push(created.body.id);
    expect(created.body.location).toMatchObject({ name });
    const placeId = created.body.location.id;
    placeIds.push(placeId);
    expect(created.body.placeId).toBe(placeId);

    const fetched = await call("GET", `/api/posts/${created.body.id}`);
    expect(fetched.body.location).toEqual({ id: placeId, name });

    const second = await call("POST", "/api/posts", seller, { mediaUrl: "https://img.test/loc2.jpg", placeId });
    postIds.push(second.body.id);
    expect(second.body.location).toEqual({ id: placeId, name });

    const none = await call("POST", "/api/posts", seller, { mediaUrl: "https://img.test/none.jpg" });
    postIds.push(none.body.id);
    expect(none.body.location).toBeNull();

    const moved = await call("PATCH", `/api/posts/${none.body.id}`, seller, { location: { name: placeName("Gallery Row"), lat: 34.0501, lng: -118.2399 } });
    expect(moved.status).toBe(200);
    expect(moved.body.location.id).toBe(placeId); // merged into the same place

    const cleared = await call("PATCH", `/api/posts/${none.body.id}`, seller, { placeId: null });
    expect(cleared.body.location).toBeNull();

    expect((await call("POST", "/api/posts", seller, { mediaUrl: "https://img.test/x.jpg", placeId: crypto.randomUUID() })).status).toBe(400);
    expect((await call("POST", "/api/posts", seller, { mediaUrl: "https://img.test/x.jpg", location: { name: "kill yourself plaza" } })).status).toBe(422);
  });
});

describe("GET /api/places/:id and /:id/posts", () => {
  const ids: Record<string, string> = {};
  let placeId = "";

  beforeAll(async () => {
    placeId = (await makePlace(placeName("Page Plaza"))).body.place.id;
    const base = Date.now() - 3_600_000;
    ids.old = (await seedPost(seller, placeId, { createdAt: new Date(base) })).id;
    ids.mid = (await seedPost(buyer, placeId, { createdAt: new Date(base + 600_000) })).id;
    ids.new = (await seedPost(buyer, placeId, { createdAt: new Date(base + 1_200_000) })).id;
    ids.draft = (await seedPost(seller, placeId, { postStatus: "draft" })).id;
    ids.held = (await seedPost(seller, placeId, { moderationStatus: "held" })).id;
    ids.blocked = (await seedPost(blockedAuthor, placeId)).id;
    await db.insert(interactions).values([
      { userId: buyer, postId: ids.old, type: "like" },
      { userId: viewer, postId: ids.old, type: "like" },
      { userId: buyer, postId: ids.mid, type: "like" },
    ]);
  });

  it("returns the place with a public post count and filtered posts", async () => {
    const page = await call("GET", `/api/places/${placeId}?sort=recent`);
    expect(page.status).toBe(200);
    expect(page.body.place.id).toBe(placeId);
    expect(page.body.postCount).toBe(4);
    const order = page.body.posts.items.map((p: any) => p.id);
    expect(order.indexOf(ids.new)).toBeLessThan(order.indexOf(ids.mid));
    for (const hidden of [ids.draft, ids.held]) expect(order).not.toContain(hidden);
    const forViewer = await call("GET", `/api/places/${placeId}`, viewer);
    expect(forViewer.body.postCount).toBe(3);
    expect(forViewer.body.posts.items.map((p: any) => p.id)).not.toContain(ids.blocked);
  });

  it("ranks top by engagement and paginates", async () => {
    const top = await call("GET", `/api/places/${placeId}/posts?sort=top`);
    expect(top.body.items[0].id).toBe(ids.old);
    expect(top.body.items[0].likesCount).toBe(2);
    const p1 = await call("GET", `/api/places/${placeId}/posts?sort=recent&limit=2`);
    expect(p1.body.items).toHaveLength(2);
    const p2 = await call("GET", `/api/places/${placeId}/posts?sort=recent&limit=2&cursor=${p1.body.nextCursor}`);
    expect(new Set([...p1.body.items, ...p2.body.items].map((p: any) => p.id)).size).toBe(p1.body.items.length + p2.body.items.length);
    expect(p2.body.nextCursor).toBeNull();
    const t1 = await call("GET", `/api/places/${placeId}/posts?sort=top&limit=3`);
    const t2 = await call("GET", `/api/places/${placeId}/posts?sort=top&limit=3&cursor=${t1.body.nextCursor}`);
    expect(t2.body.items).toHaveLength(1);
  });

  it("404s for unknown or malformed ids and sets post.place_id to null when a place is deleted", async () => {
    expect((await call("GET", `/api/places/${crypto.randomUUID()}`)).status).toBe(404);
    expect((await call("GET", "/api/places/not-a-uuid")).status).toBe(404);
    const temp = (await makePlace(placeName("Temp Spot"))).body.place.id;
    const p = await seedPost(buyer, temp);
    await db.delete(places).where(eq(places.id, temp));
    const [row] = await db.select({ placeId: posts.placeId }).from(posts).where(eq(posts.id, p.id));
    expect(row.placeId).toBeNull();
  });
});
