/**
 * Wave-1 audit (slice s05): finance money consistency + list input guards.
 *  - GET /summary "available" nets out an in-flight cash-out, like /balance.
 *  - GET /payouts and /transactions clamp ?limit= to 1..100 and ignore an
 *    array ?type= instead of forwarding junk to Stripe.
 * Same mocked harness as finance-payouts.test.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({
  available: 100_000,
  attempts: [] as any[],
  txnListParams: [] as any[],
  payoutListParams: [] as any[],
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => { req.clerkUserId = "seller-1"; next(); },
}));
vi.mock("../../middlewares/requireRole", () => ({
  teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requirePayoutsRead: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../notifications-feed", () => ({ publishNotification: async () => undefined }));
vi.mock("../../lib/admin/payoutControls", () => ({ isPayoutHeld: async () => false }));
vi.mock("../../lib/money/sellerPayouts", () => ({
  listSellerPayouts: async (input: any) => { state.payoutListParams.push(input); return { data: [], has_more: false, source: "table" }; },
  paidToBankCents: async () => 0,
  upsertPayoutFromApi: async () => null,
}));
vi.mock("drizzle-orm", () => {
  const fn = (...args: unknown[]) => args;
  const sql = Object.assign((..._a: unknown[]) => ({}), {});
  return { and: fn, eq: fn, desc: fn, inArray: fn, or: fn, sql };
});
vi.mock("@workspace/db", () => {
  const table = (name: string) => new Proxy({ __t: name }, {
    get: (t, key) => (key === "__t" ? t.__t : `${name}.${String(key)}`),
  });
  return {
    users: table("users"),
    orderFundReservations: table("reservations"),
    sellerCashoutAttempts: table("attempts"),
    sellerRecoveries: table("recoveries"),
    sellerRecoveryApplications: table("recoveryApplications"),
    drops: table("drops"),
    orders: table("orders"),
    orderReleases: table("releases"),
    ledgerPostings: table("postings"),
    ledgerTransactions: table("ledger"),
    db: (() => {
      const rowsFor = (name: string) => {
        if (name === "users") return [{ stripeAccountId: "acct_1" }];
        if (name === "reservations") return [{ reserved: 0 }];
        if (name === "attempts") return state.attempts;
        if (name === "recoveries") return [{ owed: 0 }];
        return [];
      };
      const db: any = {
        select: () => {
          let name = "";
          const chain: any = {
            from: (t: any) => { name = t.__t; return chain; },
            where: () => chain,
            limit: () => chain,
            orderBy: () => chain,
            groupBy: () => chain,
            then: (resolve: any, reject: any) => Promise.resolve(rowsFor(name)).then(resolve, reject),
          };
          return chain;
        },
        execute: async () => ({ rows: [] }),
        transaction: async (cb: any) => cb(db),
      };
      return db;
    })(),
  };
});
vi.mock("../../lib/stripe", () => ({
  get stripe() {
    return {
      accounts: {
        retrieve: async () => ({ id: "acct_1", payouts_enabled: true, settings: { payouts: { schedule: { interval: "daily", delay_days: 2 } } } }),
        listExternalAccounts: async () => ({ data: [], has_more: false }),
      },
      balance: { retrieve: async () => ({ available: [{ currency: "usd", amount: state.available }], pending: [] }) },
      payouts: { list: async () => ({ data: [], has_more: false }) },
      balanceTransactions: {
        list: async (params: any) => { state.txnListParams.push(params); return { data: [], has_more: false }; },
      },
    };
  },
}));

import financeRouter from "../finance";

let server: Server;
let baseUrl = "";
async function get(path: string) {
  const response = await fetch(`${baseUrl}/api/finance${path}`);
  return { status: response.status, body: (await response.json()) as any };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.log = { error: vi.fn(), warn: vi.fn() }; next(); });
  app.use("/api/finance", financeRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
beforeEach(() => {
  state.available = 100_000;
  state.attempts = [];
  state.txnListParams.length = 0;
  state.payoutListParams.length = 0;
});

describe("GET /summary available matches /balance", () => {
  it("subtracts a processing cash-out from the available figure", async () => {
    state.attempts = [{ idempotencyKey: "k".repeat(32), amountCents: 30_000, currency: "usd", createdAt: new Date() }];
    const summary = await get("/summary");
    const balance = await get("/balance");
    expect(summary.status).toBe(200);
    expect(balance.status).toBe(200);
    expect(balance.body.available.amount).toBe(70_000);
    expect(summary.body.available.amount).toBe(70_000);
    expect(summary.body.balanceAfterRecovery.amount).toBe(70_000);
  });
});

describe("list limit guards", () => {
  it("clamps a negative or fractional limit before calling Stripe", async () => {
    expect((await get("/transactions?limit=-5")).status).toBe(200);
    expect((await get("/transactions?limit=2.7")).status).toBe(200);
    expect((await get("/transactions?limit=5000")).status).toBe(200);
    expect(state.txnListParams.map((p) => p.limit)).toEqual([50, 2, 100]);
    expect((await get("/payouts?limit=-1")).status).toBe(200);
    expect(state.payoutListParams.at(-1).limit).toBe(20);
  });

  it("ignores a repeated ?type= instead of passing an array to Stripe", async () => {
    await get("/transactions?type=charge&type=payout");
    expect(state.txnListParams.at(-1).type).toBeUndefined();
    await get("/transactions?type=refund");
    expect(state.txnListParams.at(-1).type).toBe("refund");
  });
});
