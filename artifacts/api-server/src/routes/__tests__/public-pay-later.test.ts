/**
 * GET /api/public/sellers/:sellerId/pay-later: the product page's BNPL line.
 * No auth. The database is mocked; nothing real is read or written.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({
  row: null as null | { bnplEnabled: boolean },
  selects: 0,
  fail: false,
}));

// The authed seller router sits in the same module; prove the public one is not behind it.
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (_req: unknown, res: any) => res.status(401).json({ error: "auth" }),
}));
vi.mock("../../lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@workspace/db", () => ({
  sellerPaymentSettings: { sellerId: "seller_id", bnplEnabled: "bnpl_enabled" },
  db: {
    select: () => {
      state.selects += 1;
      return {
        from: () => ({
          where: () => ({
            limit: async () => {
              if (state.fail) throw new Error("db down");
              return state.row ? [state.row] : [];
            },
          }),
        }),
      };
    },
  },
}));

import { publicPayLaterRouter } from "../seller-payment-settings";

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use("/api/public", publicPayLaterRouter);
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/public`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

function resetEnv() {
  delete process.env.STRIPE_BNPL_ENABLED;
  delete process.env.BNPL_MIN_ORDER_CENTS;
}
beforeEach(() => {
  state.row = null;
  state.selects = 0;
  state.fail = false;
  resetEnv();
});
afterEach(resetEnv);

async function getPayLater(sellerId: string) {
  const res = await fetch(`${base}/sellers/${encodeURIComponent(sellerId)}/pay-later`);
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

describe("GET /public/sellers/:sellerId/pay-later", () => {
  it("is false with the platform switch off, without reading the seller's opt-in", async () => {
    state.row = { bnplEnabled: true };
    const res = await getPayLater("user_abc");
    expect(res).toEqual({ status: 200, body: { eligible: false, minCents: 7_500 } });
    expect(state.selects).toBe(0);
  });

  it("is true only when the switch is on AND the seller opted in", async () => {
    process.env.STRIPE_BNPL_ENABLED = "true";
    state.row = { bnplEnabled: true };
    expect((await getPayLater("user_abc")).body).toEqual({ eligible: true, minCents: 7_500 });
    state.row = { bnplEnabled: false };
    expect((await getPayLater("user_abc")).body).toEqual({ eligible: false, minCents: 7_500 });
    state.row = null;
    expect((await getPayLater("user_abc")).body).toEqual({ eligible: false, minCents: 7_500 });
  });

  it("returns only eligible + minCents (nothing else about the seller)", async () => {
    process.env.STRIPE_BNPL_ENABLED = "true";
    state.row = { bnplEnabled: true };
    expect(Object.keys((await getPayLater("user_abc")).body).sort()).toEqual(["eligible", "minCents"]);
  });

  it("reports the configured minimum", async () => {
    process.env.BNPL_MIN_ORDER_CENTS = "10000";
    expect((await getPayLater("user_abc")).body.minCents).toBe(10_000);
    process.env.BNPL_MIN_ORDER_CENTS = "abc";
    expect((await getPayLater("user_abc")).body.minCents).toBe(7_500);
  });

  it("hides the line when the lookup fails", async () => {
    process.env.STRIPE_BNPL_ENABLED = "true";
    state.fail = true;
    expect(await getPayLater("user_abc")).toEqual({ status: 200, body: { eligible: false, minCents: 7_500 } });
  });

  it("rejects a malformed seller id", async () => {
    expect((await getPayLater("bad id;")).status).toBe(400);
    expect((await getPayLater("x".repeat(129))).status).toBe(400);
  });
});
