import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => { req.clerkUserId = "seller_1"; next(); },
}));
vi.mock("../../middlewares/requireRole", () => ({
  teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requirePayoutsRead: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { createStatementsRouter } from "../finance-statements";

const NOW = new Date("2026-09-30T12:00:00Z");
const created = Math.floor(new Date("2026-08-05T10:00:00Z").getTime() / 1000);
const txns = [
  { id: "txn_a", created, type: "charge", reportingCategory: "charge", amount: 5_000, fee: 250, net: 4_750, currency: "usd", description: "=evil()", source: "ch_1",
    feeDetails: [{ type: "application_fee", amount: 250 }] },
];

let connected = true;
let server: Server;
let base = "";

beforeAll(async () => {
  const router = createStatementsRouter({
    now: () => NOW,
    getStripeAccount: async () => (connected ? "acct_1" : null),
    listTransactions: async () => txns,
    orderNumbersBySource: async () => new Map([["ch_1", "BT-1"]]),
    firstSaleAt: async () => new Date("2026-07-20T00:00:00Z"),
    sellerName: async () => "Acme",
  });
  const app = express();
  app.use("/api/finance/statements", router);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/finance/statements`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("finance statements routes", () => {
  it("lists months since the first sale, newest first, with net", async () => {
    const res = await fetch(base);
    const body = (await res.json()) as any;
    expect(body.months.map((m: any) => m.month)).toEqual(["2026-09", "2026-08", "2026-07"]);
    expect(body.months[0].netCents).toBe(0);
    expect(body.months[1].netCents).toBe(4_750);
  });

  it("returns JSON for a month", async () => {
    const body = (await (await fetch(`${base}/2026-08`)).json()) as any;
    expect(body.totals.grossSalesCents).toBe(5_000);
    expect(body.totals.platformFeesCents).toBe(-250);
    expect(body.lines[0].orderNumber).toBe("BT-1");
  });

  it("returns an injection-safe CSV with the right headers", async () => {
    const res = await fetch(`${base}/2026-08.csv`);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="brandthread-statement-2026-08.csv"');
    expect(await res.text()).toContain("'=evil()");
  });

  it("returns a PDF", async () => {
    const res = await fetch(`${base}/2026-08.pdf`);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="brandthread-statement-2026-08.pdf"');
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("rejects invalid and future months", async () => {
    expect((await fetch(`${base}/2026-13`)).status).toBe(400);
    expect((await fetch(`${base}/nope.pdf`)).status).toBe(400);
    const future = await fetch(`${base}/2026-10.csv`);
    expect(future.status).toBe(400);
    expect(((await future.json()) as any).code).toBe("FUTURE_MONTH");
  });

  it("answers 409 / empty without a connected Stripe account", async () => {
    connected = false;
    const res = await fetch(`${base}/2026-08.pdf`);
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).code).toBe("STRIPE_NOT_CONNECTED");
    expect(await (await fetch(base)).json()).toEqual({ connected: false, months: [] });
    connected = true;
  });
});
