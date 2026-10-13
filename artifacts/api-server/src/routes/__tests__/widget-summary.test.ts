/**
 * GET /api/analytics/widget-summary — the seller widget numbers. Deps are
 * injected; no database.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const user = req.headers["x-test-user"];
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = user;
    next();
  },
}));
vi.mock("@workspace/db", () => ({ db: {}, orders: {} }));
vi.mock("../../lib/nativeSurfaces", () => ({ isNativeSurfacesEnabled: async () => true }));

import { createWidgetSummaryRouter, type WidgetSummaryDeps } from "../widgetSummary";

const calls: Array<{ ownerId: string; since: string }> = [];
let enabled = true;
const deps: WidgetSummaryDeps = {
  enabled: async () => enabled,
  today: async (ownerId, since) => { calls.push({ ownerId, since: since.toISOString() }); return { salesCents: 9800, orders: 2 }; },
  toShip: async () => 3,
  now: () => new Date("2026-10-13T15:30:00Z"),
};

let server: Server;
let baseUrl = "";
beforeAll(async () => {
  const app = express();
  app.use("/api/analytics/widget-summary", createWidgetSummaryRouter(deps));
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

const get = (query = "", user: string | null = "seller_1") =>
  fetch(`${baseUrl}/api/analytics/widget-summary${query}`, { headers: user ? { "x-test-user": user } : {} });

describe("GET /api/analytics/widget-summary", () => {
  it("requires sign-in", async () => {
    expect((await get("", null)).status).toBe(401);
  });

  it("returns today's sales, order count and to-ship backlog, never cached", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({
      enabled: true, salesTodayCents: 9800, ordersToday: 2, toShipCount: 3, currency: "USD", asOf: "2026-10-13T15:30:00.000Z",
    });
  });

  it("counts from the seller's local midnight", async () => {
    calls.length = 0;
    await get("?tz=-240"); // New York in October (UTC-4)
    expect(calls[0]).toEqual({ ownerId: "seller_1", since: "2026-10-13T04:00:00.000Z" });
    await get("?tz=600"); // Sydney-ish: already the 14th locally
    expect(calls[1].since).toBe("2026-10-13T14:00:00.000Z");
  });

  it("says disabled while the nativeSurfaces flag is off", async () => {
    enabled = false;
    expect(await (await get()).json()).toEqual({ enabled: false });
    enabled = true;
  });
});
