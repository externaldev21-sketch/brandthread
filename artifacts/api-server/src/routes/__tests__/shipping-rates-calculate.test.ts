/**
 * Public GET /api/shipping-rates/calculate — the `freeAboveCents` field the
 * buyer's bag reads to say "$24 away from free shipping". The database and
 * auth middleware are mocked.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({
  rate: null as null | { name: string; flatRateCents: number; freeAboveCents: number | null },
  zones: [] as Array<{ processingDays: number | null; zoneType: string }>,
  selectCount: 0,
}));

function chain(result: () => unknown) {
  const c: any = {};
  for (const m of ["from", "where", "orderBy", "limit"]) c[m] = () => c;
  c.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result()).then(resolve, reject);
  return c;
}

vi.mock("@workspace/db", () => ({
  shippingRates: { sellerId: "sellerId", active: "active" },
  shippingZones: { sellerId: "sellerId", active: "active", sortOrder: "sortOrder", processingDays: "processingDays", zoneType: "zoneType" },
  db: {
    // The route reads the rate first, then the zones.
    select: () => {
      state.selectCount += 1;
      const first = state.selectCount % 2 === 1;
      return chain(() => (first ? (state.rate ? [state.rate] : []) : state.zones));
    },
  },
}));
vi.mock("../../middlewares/requireAuth", () => ({ requireAuth: (_req: any, _res: any, next: any) => next() }));

import router from "../shipping-rates";

let server: Server;
let base = "";

async function calc(subtotalCents: number) {
  const response = await fetch(`${base}/api/shipping-rates/calculate?sellerId=seller_1&subtotalCents=${subtotalCents}`);
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

beforeAll(async () => {
  const app = express();
  app.use("/api/shipping-rates", router);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  state.rate = null;
  state.zones = [];
  state.selectCount = 0;
});

describe("GET /api/shipping-rates/calculate freeAboveCents", () => {
  it("reports the seller's threshold below it", async () => {
    state.rate = { name: "Standard", flatRateCents: 800, freeAboveCents: 10000 };
    const { status, body } = await calc(7600);
    expect(status).toBe(200);
    expect(body).toMatchObject({ shippingCents: 800, isFree: false, freeAboveCents: 10000 });
  });

  it("reports the threshold once it is met", async () => {
    state.rate = { name: "Standard", flatRateCents: 800, freeAboveCents: 10000 };
    const { body } = await calc(12000);
    expect(body).toMatchObject({ shippingCents: 0, isFree: true, freeAboveCents: 10000 });
  });

  it("is null when the rate has no threshold", async () => {
    state.rate = { name: "Standard", flatRateCents: 800, freeAboveCents: null };
    const { body } = await calc(7600);
    expect(body).toMatchObject({ shippingCents: 800, freeAboveCents: null });
  });

  it("is null when the seller has no rate", async () => {
    const { body } = await calc(7600);
    expect(body).toMatchObject({ shippingCents: 0, isFree: true, freeAboveCents: null });
  });

  it("is null when the seller prices by shipping zone", async () => {
    state.rate = { name: "Standard", flatRateCents: 800, freeAboveCents: 10000 };
    state.zones = [{ processingDays: 2, zoneType: "domestic" }];
    const { body } = await calc(7600);
    expect(body).toMatchObject({ shippingCents: 800, freeAboveCents: null, processingDays: 2 });
  });
});
