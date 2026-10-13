import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, inArray } from "drizzle-orm";
import {
  db, follows, interactions, productLaunches, productVariants, products, pushTokens, shippingRates, storeVisits, users,
} from "@workspace/db";
import { localWeekdayHour } from "../../lib/followerActivity";

vi.mock("../notifications-feed", () => ({ publishNotification: async () => {} }));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const user = req.header("x-test-user");
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = user;
    next();
  },
}));
vi.mock("../../middlewares/requireRole", () => ({
  teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const suffix = crypto.randomBytes(6).toString("hex");
const seller = `ready-seller-${suffix}`;
const noPayouts = `ready-nopay-${suffix}`;
const other = `ready-other-${suffix}`;
const quiet = `ready-quiet-${suffix}`;
const fans = Array.from({ length: 24 }, (_, i) => `ready-fan-${i}-${suffix}`);
const productIds: string[] = [];
let server: Server;
let base = "";
const HOUR = 3600 * 1000;
const future = (h: number) => new Date(Date.now() + h * HOUR);

async function api(path: string, user?: string, method = "GET", body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(user ? { "x-test-user": user } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

async function makeProduct(ownerId: string, values: Partial<typeof products.$inferInsert> = {}) {
  const [p] = await db.insert(products).values({ ownerId, name: `Ready Tee ${suffix}`, status: "active", ...values }).returning({ id: products.id });
  productIds.push(p.id);
  return p.id;
}

/** Start of the UTC hour `daysAgo` days back at `utcHour`. */
function hourAgo(daysAgo: number, utcHour: number) {
  const d = new Date(Date.now() - daysAgo * 24 * HOUR);
  d.setUTCHours(utcHour, 0, 0, 0);
  return d;
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: seller, email: `${seller}@example.test`, name: "Ready Seller", stripeAccountStatus: "active" },
    { clerkId: noPayouts, email: `${noPayouts}@example.test`, name: "No Payouts", stripeAccountStatus: "pending" },
  ]).onConflictDoNothing();
  const router = (await import("../product-launches")).default;
  const app = express();
  app.use(express.json());
  app.use("/api/product-launches", router);
  await new Promise<void>((r) => { server = app.listen(0, "127.0.0.1", () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(interactions).where(inArray(interactions.userId, fans));
  await db.delete(storeVisits).where(inArray(storeVisits.viewerUserId, fans));
  await db.delete(pushTokens).where(inArray(pushTokens.userId, fans));
  await db.delete(follows).where(inArray(follows.followingId, [seller, quiet]));
  await db.delete(shippingRates).where(eq(shippingRates.sellerId, seller));
  await db.delete(users).where(inArray(users.clerkId, [seller, noPayouts]));
  if (productIds.length) await db.delete(products).where(inArray(products.id, productIds));
  await new Promise<void>((r) => server.close(() => r()));
});

describe("launch readiness checklist", () => {
  it("derives every check from real product + account state", async () => {
    const bare = await makeProduct(seller);
    const c = await api(`/api/product-launches/${bare}/checklist`, seller);
    expect(c.status).toBe(200);
    expect(c.body.items.map((i: any) => i.id)).toEqual(["photos", "price", "stock", "variants", "description", "shipping", "payouts", "launch_time", "followers"]);
    expect(c.body.blockers).toEqual(["photos", "price"]);
    expect(c.body.canSchedule).toBe(false);
    expect(c.body.readyCount).toBe(1); // payouts only

    const full = await makeProduct(seller, { images: ["a.jpg", "b.jpg", "c.jpg"], description: "Boxy fit." });
    await db.insert(productVariants).values({ productId: full, size: "M", sku: `RDY-${full}`, priceCents: 5000, stock: 4 });
    await db.insert(shippingRates).values({ id: `rate-${suffix}`, sellerId: seller, flatRateCents: 500 });
    await db.insert(follows).values({ followerId: fans[0], followingId: seller }).onConflictDoNothing();
    await db.insert(productLaunches).values({ productId: full, launchAt: future(30), notifyFollowers: true });
    const f = await api(`/api/product-launches/${full}/checklist`, seller);
    expect(f.body.readyCount).toBe(9);
    expect(f.body.canSchedule).toBe(true);
    expect(f.body.followerCount).toBe(1);
  });

  it("is private to the owner", async () => {
    const id = await makeProduct(seller);
    expect((await api(`/api/product-launches/${id}/checklist`, other)).status).toBe(404);
    expect((await api(`/api/product-launches/${id}/checklist`)).status).toBe(401);
    expect((await api(`/api/product-launches/not-a-uuid/checklist`, seller)).status).toBe(404);
  });

  it("refuses to schedule on hard blockers and lists readiness per launch", async () => {
    const noPhoto = await makeProduct(seller);
    await db.insert(productVariants).values({ productId: noPhoto, sku: `NP-${noPhoto}`, priceCents: 3000, stock: 1 });
    const refused = await api(`/api/product-launches/${noPhoto}`, seller, "PUT", { launchAt: future(5).toISOString() });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: "LAUNCH_NOT_READY", blockers: ["photos"] });

    const unpaid = await makeProduct(noPayouts, { images: ["a.jpg"] });
    await db.insert(productVariants).values({ productId: unpaid, sku: `UP-${unpaid}`, priceCents: 3000, stock: 1 });
    expect((await api(`/api/product-launches/${unpaid}`, noPayouts, "PUT", { launchAt: future(5).toISOString() })).body.blockers).toEqual(["payouts"]);

    // Warnings (one photo, no description, no sizes) don't block.
    await db.update(products).set({ images: ["only.jpg"] }).where(eq(products.id, noPhoto));
    const ok = await api(`/api/product-launches/${noPhoto}`, seller, "PUT", { launchAt: future(5).toISOString(), notifyFollowers: true });
    expect(ok.status).toBe(200);

    const list = await api(`/api/product-launches`, seller);
    const row = list.body.find((r: any) => r.productId === noPhoto);
    expect(row.readiness).toEqual({ readyCount: 6, total: 9, blockers: [] });
  });
});

describe("best time to drop", () => {
  it("returns not-enough-activity below 20 active followers", async () => {
    for (const fan of fans.slice(0, 5)) await db.insert(follows).values({ followerId: fan, followingId: quiet }).onConflictDoNothing();
    await db.insert(interactions).values(fans.slice(0, 5).map((userId) => ({ userId, type: "like", createdAt: hourAgo(2, 3) })));
    const r = await api(`/api/product-launches/best-time?tz=America/New_York`, quiet);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "not_enough_activity", activeFollowers: null, grid: null, top: [], minActiveFollowers: 20 });
  });

  it("buckets follower activity by weekday x hour in the requested zone", async () => {
    for (const fan of fans) await db.insert(follows).values({ followerId: fan, followingId: seller }).onConflictDoNothing();
    const peak = hourAgo(3, 2);
    const second = hourAgo(5, 16);
    // 22 fans active at `peak` through feed interactions, store visits and app opens.
    await db.insert(interactions).values(fans.slice(0, 10).map((userId) => ({ userId, type: "view", createdAt: new Date(peak.getTime() + 5 * 60 * 1000) })));
    await db.insert(storeVisits).values(fans.slice(10, 16).map((viewerUserId) => ({ sellerId: other, source: "feed", viewerUserId, createdAt: new Date(peak.getTime() + 20 * 60 * 1000) })));
    await db.insert(pushTokens).values(fans.slice(16, 22).map((userId) => ({ userId, token: `tok-${userId}`, lastSeenAt: new Date(peak.getTime() + 40 * 60 * 1000) })));
    await db.insert(interactions).values(fans.slice(0, 8).map((userId) => ({ userId, type: "like", createdAt: second })));
    // Older than 28 days: ignored, even though it would outrank everything.
    await db.insert(interactions).values(fans.flatMap((userId) => [0, 1, 2].map(() => ({ userId, type: "like", createdAt: hourAgo(40, 9) }))));

    const la = await api(`/api/product-launches/best-time?tz=America/Los_Angeles`, seller);
    expect(la.status).toBe(200);
    expect(la.body.status).toBe("ok");
    expect(la.body.activeFollowers).toBe(22);
    const p = localWeekdayHour(peak, "America/Los_Angeles");
    const s = localWeekdayHour(second, "America/Los_Angeles");
    expect(la.body.top.slice(0, 2)).toEqual([{ ...p, followers: 22 }, { ...s, followers: 8 }]);
    expect(la.body.grid[p.weekday][p.hour]).toBe(22);

    const utc = await api(`/api/product-launches/best-time?tz=Not/AZone`, seller);
    expect(utc.body.timeZone).toBe("UTC");
    expect(utc.body.top[0]).toEqual({ ...localWeekdayHour(peak, "UTC"), followers: 22 });
    expect(utc.body.top[0].hour).toBe(2);
  });
});
