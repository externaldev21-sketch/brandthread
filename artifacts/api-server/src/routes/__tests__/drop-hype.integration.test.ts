/**
 * GET /api/drops/:id/hype: seller-only waitlist growth for a drop.
 *
 * Owner-only (404 for anyone else's drop or a malformed id), daily buckets on
 * the seller's local calendar (tz offset), gaps filled with flat days, and a
 * cumulative series whose last point equals `total`. requireAuth reads the
 * caller from a header; Express, Drizzle and Postgres are real.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, dropAlertSubscriptions, drops, follows, users } from "@workspace/db";
import { buildCumulativeSeries, localDateKey } from "../../lib/dropHype";

const suffix = crypto.randomBytes(5).toString("hex");
const SELLER = `hype-seller-${suffix}`;
const OTHER = `hype-other-${suffix}`;
const DAY = 86_400_000;

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const actingAs = req.headers["x-test-acting-as"];
    if (!actingAs) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = actingAs;
    next();
  },
  requirePlan: () => (_req: any, _res: any, next: () => void) => next(),
}));

let server: Server;
let base = "";
let dropId = "";
let subCounter = 0;

function get(path: string, as: string | null = SELLER) {
  return fetch(`${base}${path}`, { headers: as ? { "x-test-acting-as": as } : {} });
}

async function signup(at: Date, userId = `hype-buyer-${suffix}-${++subCounter}`) {
  await db.insert(dropAlertSubscriptions).values({ dropId, userId, createdAt: at });
  return userId;
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: SELLER, email: `${SELLER}@test.local`, name: "Hype Seller", displayName: "Hype Seller", accountType: "seller", onboardingComplete: true },
    { clerkId: OTHER, email: `${OTHER}@test.local`, name: "Hype Other", displayName: "Hype Other", accountType: "seller", onboardingComplete: true },
  ]);
  const [drop] = await db.insert(drops).values({
    ownerId: SELLER,
    name: "Drop 05 Night Shift",
    type: "pre-made",
    status: "draft",
    releaseAt: new Date(Date.now() + 5 * DAY),
  }).returning({ id: drops.id });
  dropId = drop.id;

  const { default: dropsRouter } = await import("../drops");
  const app = express();
  app.use(express.json());
  app.use("/api/drops", dropsRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  await db.delete(dropAlertSubscriptions).where(eq(dropAlertSubscriptions.dropId, dropId));
  await db.delete(follows).where(eq(follows.followingId, SELLER));
});

afterAll(async () => {
  await db.delete(follows).where(eq(follows.followingId, SELLER));
  await db.delete(drops).where(inArray(drops.ownerId, [SELLER, OTHER]));
  await db.delete(users).where(inArray(users.clerkId, [SELLER, OTHER]));
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

describe("buildCumulativeSeries", () => {
  it("fills gaps with flat days and accumulates", () => {
    expect(buildCumulativeSeries([
      { date: "2026-10-01", count: 2 },
      { date: "2026-10-04", count: 1 },
    ], "2026-10-06")).toEqual([
      { date: "2026-10-01", cumulative: 2 },
      { date: "2026-10-02", cumulative: 2 },
      { date: "2026-10-03", cumulative: 2 },
      { date: "2026-10-04", cumulative: 3 },
      { date: "2026-10-05", cumulative: 3 },
      { date: "2026-10-06", cumulative: 3 },
    ]);
  });

  it("crosses month and year ends", () => {
    const s = buildCumulativeSeries([{ date: "2025-12-30", count: 1 }, { date: "2026-01-02", count: 4 }], "2026-01-02");
    expect(s.map((p) => p.date)).toEqual(["2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02"]);
    expect(s.map((p) => p.cumulative)).toEqual([1, 1, 1, 5]);
  });

  it("is empty with no signups and folds future-dated rows into today", () => {
    expect(buildCumulativeSeries([], "2026-10-06")).toEqual([]);
    expect(buildCumulativeSeries([{ date: "2026-10-07", count: 2 }], "2026-10-06")).toEqual([{ date: "2026-10-06", cumulative: 2 }]);
  });
});

describe("GET /api/drops/:id/hype", () => {
  it("is owner-only: another seller, a malformed id and no auth never see it", async () => {
    await signup(new Date());
    expect((await get(`/api/drops/${dropId}/hype`, OTHER)).status).toBe(404);
    expect((await get(`/api/drops/${crypto.randomUUID()}/hype`)).status).toBe(404);
    expect((await get(`/api/drops/not-a-uuid/hype`)).status).toBe(404);
    expect((await get(`/api/drops/${dropId}/hype`, null)).status).toBe(401);
    const res = await get(`/api/drops/${dropId}/hype?tz=0`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Object.keys(body).sort()).toEqual(["dropId", "followers", "name", "releaseAt", "series", "today", "total"]);
    expect(body).toMatchObject({ dropId, name: "Drop 05 Night Shift", total: 1, today: 1 });
    expect(typeof body.releaseAt).toBe("string");
  });

  it("returns an empty series and zeros before anyone signs up", async () => {
    const body = await (await get(`/api/drops/${dropId}/hype?tz=0`)).json() as any;
    expect(body).toMatchObject({ total: 0, today: 0, followers: 0, series: [] });
  });

  it("buckets by the seller's local day (tz offset)", async () => {
    // 03:00 UTC three days ago: that UTC calendar day for tz=0, but the
    // previous evening for a UTC-5 seller (tz=-300).
    const now = new Date();
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 3, 3, 0, 0));
    await signup(d);
    const utc = await (await get(`/api/drops/${dropId}/hype?tz=0`)).json() as any;
    const ny = await (await get(`/api/drops/${dropId}/hype?tz=-300`)).json() as any;
    expect(utc.series[0]).toEqual({ date: d.toISOString().slice(0, 10), cumulative: 1 });
    expect(ny.series[0]).toEqual({ date: new Date(d.getTime() - DAY).toISOString().slice(0, 10), cumulative: 1 });
    expect(ny.series.length).toBe(utc.series.length + (localDateKey(now, -300) === localDateKey(now, 0) ? 1 : 0));
    // "today" follows the same local calendar.
    expect(utc.today).toBe(0);
  });

  it("fills gaps and accumulates to the total, with +N today", async () => {
    const now = new Date();
    const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * DAY);
    await signup(at(6));
    await signup(at(6));
    await signup(at(3));
    await signup(new Date(now.getTime() - 1000));
    await signup(new Date(now.getTime() - 2000));
    const body = await (await get(`/api/drops/${dropId}/hype?tz=0`)).json() as any;

    const keys = body.series.map((p: any) => p.date);
    expect(keys[0]).toBe(localDateKey(at(6), 0));
    expect(keys[keys.length - 1]).toBe(localDateKey(now, 0));
    // Consecutive days, no gaps.
    for (let i = 1; i < keys.length; i++) {
      expect(Date.parse(`${keys[i]}T00:00:00Z`) - Date.parse(`${keys[i - 1]}T00:00:00Z`)).toBe(DAY);
    }
    // Monotonic, ends at the total.
    const cum = body.series.map((p: any) => p.cumulative);
    for (let i = 1; i < cum.length; i++) expect(cum[i]).toBeGreaterThanOrEqual(cum[i - 1]);
    expect(cum[0]).toBe(2);
    expect(cum[cum.length - 1]).toBe(5);
    expect(body.total).toBe(5);
    const todayKey = localDateKey(now, 0);
    const expectedToday = [now.getTime() - 1000, now.getTime() - 2000].filter((t) => localDateKey(new Date(t), 0) === todayKey).length;
    expect(body.today).toBe(expectedToday);
    // The day of the at(3) signup steps up by exactly one.
    const k3 = keys.indexOf(localDateKey(at(3), 0));
    expect(cum[k3] - cum[k3 - 1]).toBe(1);
  });

  it("splits followers from everyone else", async () => {
    const fan = await signup(new Date(Date.now() - DAY));
    const notFan = await signup(new Date(Date.now() - DAY));
    await db.insert(follows).values({ followerId: fan, followingId: SELLER });
    // Following some other seller doesn't count.
    await db.insert(follows).values({ followerId: notFan, followingId: OTHER });
    const body = await (await get(`/api/drops/${dropId}/hype?tz=0`)).json() as any;
    expect(body.total).toBe(2);
    expect(body.followers).toBe(1);
    await db.delete(follows).where(eq(follows.followingId, OTHER));
  });
});
