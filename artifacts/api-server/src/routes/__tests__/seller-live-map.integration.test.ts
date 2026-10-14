/**
 * Seller dashboard Live map.
 *
 *  - GET /api/seller/live-map/today: paid, non-cancelled orders since the
 *    seller's local midnight, aggregated to city level; other sellers'
 *    orders never appear; nothing finer than city leaves the server.
 *  - /ws/seller: an order_city broadcast reaches only the sockets of the
 *    seller it was addressed to, and carries city-level keys only.
 *
 * requireAuth reads identity off a header and the WS token is the user id
 * (same substitution as live-realtime-e2e.test.ts); Express, ws, Drizzle
 * and Postgres are real.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import express from "express";
import WS from "ws";
import { inArray } from "drizzle-orm";
import { db, orders, users } from "@workspace/db";

const suffix = crypto.randomBytes(5).toString("hex");
const SELLER = `livemap-seller-${suffix}`;
const OTHER = `livemap-other-${suffix}`;

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const actingAs = req.headers["x-test-acting-as"];
    if (!actingAs) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = actingAs;
    next();
  },
  requirePlan: () => (_req: any, _res: any, next: () => void) => next(),
}));

vi.mock("../../ws/auth", () => ({
  verifyWsToken: async (token: string | undefined | null) => (token ? token : null),
}));

let server: Server;
let base = "";
let wsBase = "";
let counter = 0;

const ADDRESS = (city: string, state: string, country = "US") => ({
  name: "Jane Buyer",
  street: "123 Secret Lane",
  line2: "Apt 4",
  city,
  state,
  zip: "78701",
  country,
});

async function makeOrder(ownerId: string, paidAt: Date | null, address: ReturnType<typeof ADDRESS> | null, status = "pending") {
  counter += 1;
  await db.insert(orders).values({
    ownerId,
    orderNumber: `LM-${suffix}-${counter}`,
    status,
    totalCents: 4200,
    subtotalCents: 4200,
    paidAt,
    createdAt: paidAt ?? new Date(),
    ...(address ? { shippingAddress: address } : {}),
  });
}

function get(path: string, as = SELLER) {
  return fetch(`${base}${path}`, { headers: { "x-test-acting-as": as } });
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: SELLER, email: `${SELLER}@test.local`, name: "LM Seller", displayName: "LM Seller", accountType: "seller", onboardingComplete: true },
    { clerkId: OTHER, email: `${OTHER}@test.local`, name: "LM Other", displayName: "LM Other", accountType: "seller", onboardingComplete: true },
  ]);
  const { default: router } = await import("../seller-live-map");
  const { attachSellerWebSocket } = await import("../../ws/sellerHub");
  const app = express();
  app.use("/api/seller/live-map", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}`;
  attachSellerWebSocket(server);
});

beforeEach(async () => {
  await db.delete(orders).where(inArray(orders.ownerId, [SELLER, OTHER]));
});

afterAll(async () => {
  await db.delete(orders).where(inArray(orders.ownerId, [SELLER, OTHER]));
  await db.delete(users).where(inArray(users.clerkId, [SELLER, OTHER]));
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

describe("GET /api/seller/live-map/today", () => {
  it("aggregates today's paid orders by city and resolves coordinates", async () => {
    const now = Date.now();
    await makeOrder(SELLER, new Date(now - 60_000), ADDRESS("Austin", "TX"));
    await makeOrder(SELLER, new Date(now - 30_000), ADDRESS("austin", "Texas"));
    await makeOrder(SELLER, new Date(now - 20_000), ADDRESS("Berlin", "", "DE"));
    // Unknown city in a known state → state centroid.
    await makeOrder(SELLER, new Date(now - 10_000), ADDRESS("Smallville Nowhere", "KS"));
    // Unplaceable: counted in total, no dot.
    await makeOrder(SELLER, new Date(now - 5_000), ADDRESS("Atlantis", "", "Narnia"));
    // Not paid: excluded entirely.
    await makeOrder(SELLER, null, ADDRESS("Denver", "CO"));

    const res = await get("/api/seller/live-map/today?tz=0");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.total).toBe(5);
    // count desc, then most recent first.
    expect(body.cities.map((c: any) => [c.key, c.count])).toEqual([
      ["US:TX:austin", 2],
      ["US:KS:", 1],
      ["DE:16:berlin", 1],
    ]);
    const austin = body.cities.find((c: any) => c.key === "US:TX:austin");
    expect(austin).toMatchObject({ city: "Austin", region: "TX", country: "US", count: 2 });
    expect(austin.lat).toBeCloseTo(30.27, 1);
    expect(austin.lastAt).toBe(new Date(now - 30_000).toISOString());
  });

  it("never returns anything finer than city", async () => {
    await makeOrder(SELLER, new Date(Date.now() - 1000), ADDRESS("Austin", "TX"));
    const res = await get("/api/seller/live-map/today?tz=0");
    const body = await res.json() as any;
    expect(Object.keys(body).sort()).toEqual(["cities", "total"]);
    for (const c of body.cities) {
      expect(Object.keys(c).sort()).toEqual(["city", "count", "country", "key", "lastAt", "lat", "lng", "region"]);
    }
    const raw = JSON.stringify(body);
    for (const secret of ["Secret Lane", "Apt 4", "78701", "Jane Buyer", "4200", "LM-"]) {
      expect(raw).not.toContain(secret);
    }
  });

  it("excludes cancelled orders", async () => {
    await makeOrder(SELLER, new Date(Date.now() - 1000), ADDRESS("Austin", "TX"), "cancelled");
    await makeOrder(SELLER, new Date(Date.now() - 1000), ADDRESS("Denver", "CO"), "processing");
    const body = await (await get("/api/seller/live-map/today?tz=0")).json() as any;
    expect(body.total).toBe(1);
    expect(body.cities.map((c: any) => c.key)).toEqual(["US:CO:denver"]);
  });

  it("only returns the calling seller's orders", async () => {
    await makeOrder(OTHER, new Date(Date.now() - 1000), ADDRESS("Austin", "TX"));
    await makeOrder(SELLER, new Date(Date.now() - 1000), ADDRESS("Denver", "CO"));
    const mine = await (await get("/api/seller/live-map/today?tz=0")).json() as any;
    expect(mine.total).toBe(1);
    expect(mine.cities.map((c: any) => c.key)).toEqual(["US:CO:denver"]);
    const theirs = await (await get("/api/seller/live-map/today?tz=0", OTHER)).json() as any;
    expect(theirs.cities.map((c: any) => c.key)).toEqual(["US:TX:austin"]);
  });

  it("starts the day at the seller's local midnight (tz offset)", async () => {
    const now = new Date();
    // For a UTC-5 seller (tz=-300) local midnight is 05:00 UTC.
    const tz = -300;
    const localMidnightUtc = Math.floor((now.getTime() + tz * 60_000) / 86_400_000) * 86_400_000 - tz * 60_000;
    const justBefore = new Date(localMidnightUtc - 60_000);
    const justAfter = new Date(localMidnightUtc + 60_000);
    await makeOrder(SELLER, justBefore, ADDRESS("Austin", "TX"));
    if (justAfter.getTime() <= now.getTime()) await makeOrder(SELLER, justAfter, ADDRESS("Denver", "CO"));
    const body = await (await get(`/api/seller/live-map/today?tz=${tz}`)).json() as any;
    const keys = body.cities.map((c: any) => c.key);
    expect(keys).not.toContain("US:TX:austin");
    if (justAfter.getTime() <= now.getTime()) expect(keys).toEqual(["US:CO:denver"]);

    // The same "just before" order IS today for a UTC seller when that
    // instant falls after UTC midnight.
    const utcMidnight = Math.floor(now.getTime() / 86_400_000) * 86_400_000;
    const utcBody = await (await get("/api/seller/live-map/today?tz=0")).json() as any;
    expect(utcBody.cities.some((c: any) => c.key === "US:TX:austin")).toBe(justBefore.getTime() >= utcMidnight);
  });

  it("returns an empty map for a seller with no orders today", async () => {
    await makeOrder(SELLER, new Date(Date.now() - 3 * 86_400_000), ADDRESS("Austin", "TX"));
    const body = await (await get("/api/seller/live-map/today?tz=0")).json() as any;
    expect(body).toEqual({ total: 0, cities: [] });
  });

  it("requires auth", async () => {
    const res = await fetch(`${base}/api/seller/live-map/today`);
    expect(res.status).toBe(401);
  });
});

function connect(token: string): Promise<WS> {
  return new Promise((resolve, reject) => {
    const socket = new WS(`${wsBase}/ws/seller?token=${encodeURIComponent(token)}`);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function collect(socket: WS): any[] {
  const out: any[] = [];
  socket.on("message", (raw) => out.push(JSON.parse(raw.toString())));
  return out;
}

describe("/ws/seller hub", () => {
  it("rejects a connection without a token", async () => {
    await expect(connect("")).rejects.toBeTruthy();
  });

  it("rejects a store membership the caller doesn't hold", async () => {
    await expect(new Promise((resolve, reject) => {
      const socket = new WS(`${wsBase}/ws/seller?token=${SELLER}&store=${crypto.randomUUID()}`);
      socket.once("open", () => resolve(socket));
      socket.once("error", reject);
    })).rejects.toBeTruthy();
  });

  it("delivers order_city only to the addressed seller, city level only", async () => {
    const { broadcastOrderCity } = await import("../../lib/liveMap/broadcastOrderCity");
    const { sellerSocketCount } = await import("../../ws/sellerHub");
    const mine = await connect(SELLER);
    const theirs = await connect(OTHER);
    const mineMsgs = collect(mine);
    const theirMsgs = collect(theirs);
    await vi.waitFor(() => expect(sellerSocketCount(SELLER)).toBe(1));

    broadcastOrderCity(SELLER, ADDRESS("Austin", "TX"), new Date("2026-10-13T15:00:00Z"));
    await vi.waitFor(() => expect(mineMsgs.length).toBe(1));
    await new Promise((r) => setTimeout(r, 150));
    expect(theirMsgs).toEqual([]);

    const msg = mineMsgs[0];
    expect(Object.keys(msg).sort()).toEqual(["at", "city", "country", "key", "lat", "lng", "region", "type"]);
    expect(msg).toMatchObject({ type: "order_city", key: "US:TX:austin", city: "Austin", region: "TX", country: "US", at: "2026-10-13T15:00:00.000Z" });
    expect(JSON.stringify(msg)).not.toMatch(/Secret|78701|Jane|Apt/);

    // Unplaceable address: nothing sent; a null address never throws.
    broadcastOrderCity(SELLER, ADDRESS("Atlantis", "", "Narnia"));
    expect(() => broadcastOrderCity(SELLER, null)).not.toThrow();
    await new Promise((r) => setTimeout(r, 150));
    expect(mineMsgs.length).toBe(1);

    mine.close();
    theirs.close();
    await vi.waitFor(() => expect(sellerSocketCount(SELLER)).toBe(0));
  });
});
