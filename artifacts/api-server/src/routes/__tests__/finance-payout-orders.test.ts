import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({
  accountId: "acct_1" as string | null,
  stripeOn: true,
  account: null as any,
  externalAccounts: [] as any[],
  available: 100_000,
  payoutRecord: null as any,
  balanceTxns: [] as any[],
  updateCalls: [] as any[],
  payoutCreates: [] as any[],
  attempts: [] as any[],
  permissions: [] as string[],
  denyWrites: false,
  orderRows: [] as any[],
  inTransit: [] as any[],
  listCalls: [] as any[],
  ordersQueryFails: false,
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = "seller-1";
    next();
  },
}));

vi.mock("../../middlewares/requireRole", () => ({
  teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requirePayoutsRead: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requirePermission: (permission: string) => {
    state.permissions.push(permission);
    return (_req: unknown, res: any, next: () => void) => {
      if (state.denyWrites) { res.status(403).json({ error: "Forbidden" }); return; }
      next();
    };
  },
}));

vi.mock("../notifications-feed", () => ({ publishNotification: async () => undefined }));
// This suite exercises payout/order linkage. Recovery and webhook-fed payout
// persistence have their own database suites, and are shared balance dependencies.
vi.mock("../../lib/money/sellerRecovery", () => ({
  payoutPauseForRecovery: async () => ({ owedCents: 0, paused: false }),
  listSellerRecoveries: async () => [],
}));
vi.mock("../../lib/money/sellerPayouts", () => ({
  listSellerPayouts: async () => ({ data: [], has_more: false, source: "table" }),
  paidToBankCents: async () => 0,
  upsertPayoutFromApi: async () => null,
}));

vi.mock("drizzle-orm", () => {
  const fn = (...args: unknown[]) => args;
  const sql = Object.assign((..._a: unknown[]) => ({}), {});
  return { and: fn, eq: fn, desc: fn, inArray: fn, sql };
});

vi.mock("@workspace/db", () => {
  const table = (name: string) => new Proxy({ __t: name }, {
    get: (t, key) => (key === "__t" ? t.__t : `${name}.${String(key)}`),
  });
  return {
    users: table("users"),
    orderFundReservations: table("reservations"),
    sellerCashoutAttempts: table("attempts"),
    drops: table("drops"),
    orders: table("orders"),
    orderReleases: table("releases"),
    ledgerPostings: table("postings"),
    ledgerTransactions: table("ledger"),
    db: (() => {
      const rowsFor = (name: string) => {
        if (name === "users") return [{ stripeAccountId: state.accountId }];
        if (name === "reservations") return [{ reserved: 0 }];
        if (name === "attempts") return state.attempts;
        if (name === "orders") {
          if (state.ordersQueryFails) throw new Error("db down");
          return state.orderRows;
        }
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
            then: (resolve: any, reject: any) => Promise.resolve().then(() => rowsFor(name)).then(resolve, reject),
          };
          return chain;
        },
        insert: () => ({
          values: async (v: any) => { state.attempts.push({ id: "att_1", createdAt: new Date(), ...v }); },
        }),
        update: () => ({
          set: (v: any) => ({ where: async () => { Object.assign(state.attempts[0], v); } }),
        }),
        execute: async () => ({ rows: [] }),
        transaction: async (cb: any) => cb(db),
      };
      return db;
    })(),
  };
});

vi.mock("../../lib/stripe", () => ({
  get stripe() {
    if (!state.stripeOn) return null;
    return {
      accounts: {
        retrieve: async () => state.account,
        update: async (_id: string, params: any) => {
          state.updateCalls.push(params);
          return {
            ...state.account,
            settings: { payouts: { schedule: { delay_days: 2, ...params.settings.payouts.schedule } } },
          };
        },
        listExternalAccounts: async () => ({ data: state.externalAccounts, has_more: false }),
      },
      balance: { retrieve: async () => ({ available: [{ currency: "usd", amount: state.available }], pending: [] }) },
      payouts: {
        list: async (params: any) => ({ data: params?.status === "in_transit" ? state.inTransit : [], has_more: false }),
        retrieve: async () => {
          if (!state.payoutRecord) throw Object.assign(new Error("No such payout"), { statusCode: 404 });
          return state.payoutRecord;
        },
        create: async (params: any) => {
          state.payoutCreates.push(params);
          return { id: "po_created1", amount: params.amount, currency: params.currency, status: "pending", arrival_date: 1_790_000_000 };
        },
      },
      balanceTransactions: { list: async (params: any) => { state.listCalls.push(params); return { data: state.balanceTxns, has_more: false }; } },
    };
  },
}));

import financeRouter from "../finance";

let server: Server;
let baseUrl = "";

async function call(method: string, path: string, body?: unknown) {
  const response = await fetch(`${baseUrl}/api/finance${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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

const debitCard = {
  id: "card_1", object: "card", currency: "usd", brand: "Visa", funding: "debit", last4: "4242",
  default_for_currency: true, available_payout_methods: ["standard", "instant"],
};
const bank = {
  id: "ba_1", object: "bank_account", currency: "usd", default_for_currency: true,
  status: "verified", last4: "6789", available_payout_methods: ["standard"],
};

beforeEach(() => {
  state.accountId = "acct_1";
  state.stripeOn = true;
  state.account = { id: "acct_1", payouts_enabled: true, settings: { payouts: { schedule: { interval: "daily", delay_days: 2 } } } };
  state.externalAccounts = [bank];
  state.available = 100_000;
  state.payoutRecord = null;
  state.balanceTxns = [];
  state.updateCalls.length = 0;
  state.payoutCreates.length = 0;
  state.attempts.length = 0;
  state.denyWrites = false;
  state.orderRows = [];
  state.inTransit = [];
  state.listCalls.length = 0;
  state.ordersQueryFails = false;
});

describe("GET /payouts/:id orders", () => {
  const payout = (extra: object = {}) => ({
    id: "po_abc123", amount: 5_412, currency: "usd", status: "paid", automatic: true, method: "standard",
    arrival_date: 1_790_000_000, created: 1_789_900_000, destination: { last4: "6789" }, ...extra,
  });

  it("lists the orders behind the payout's balance transactions", async () => {
    state.payoutRecord = payout();
    state.balanceTxns = [
      { id: "txn_1", type: "payment", amount: 4_000, fee: 0, net: 4_000, source: { id: "py_1", source_transfer: "tr_1" } },
      { id: "txn_2", type: "payment_refund", amount: -500, fee: 0, net: -500, source: { id: "pyr_1", charge: "py_1" } },
      { id: "txn_3", type: "charge", amount: 2_000, fee: 88, net: 1_912, source: { id: "ch_2", payment_intent: "pi_2" } },
    ];
    state.orderRows = [
      { id: "o1", orderNumber: "1001", shippingAddress: { name: "Sam Lee" }, stripeTransferId: "tr_1", stripeChargeId: null, stripePaymentIntentId: null, createdAt: new Date("2026-10-01T10:00:00Z") },
      { id: "o2", orderNumber: "1002", shippingAddress: null, stripeTransferId: null, stripeChargeId: "ch_2", stripePaymentIntentId: "pi_2", createdAt: new Date("2026-10-02T10:00:00Z") },
    ];
    const r = await call("GET", "/payouts/po_abc123");
    expect(r.status).toBe(200);
    expect(state.listCalls[0]).toMatchObject({ payout: "po_abc123", expand: ["data.source"] });
    expect(r.body.orders).toEqual([
      { orderId: "o2", orderNumber: "1002", total: 2_000, fee: 88, net: 1_912, createdAt: "2026-10-02T10:00:00.000Z" },
      { orderId: "o1", orderNumber: "1001", buyerName: "Sam Lee", total: 3_500, fee: 0, net: 3_500, createdAt: "2026-10-01T10:00:00.000Z" },
    ]);
    // The breakdown is unchanged by the orders list.
    expect(r.body.breakdown.net.amount).toBe(5_412);
  });

  it("returns an empty list for manual payouts and when the order lookup fails", async () => {
    state.payoutRecord = payout({ automatic: false });
    expect((await call("GET", "/payouts/po_abc123")).body.orders).toEqual([]);

    state.payoutRecord = payout({ amount: 1_000 });
    state.balanceTxns = [{ id: "txn_1", type: "charge", amount: 1_000, fee: 0, net: 1_000, source: { id: "ch_1" } }];
    state.ordersQueryFails = true;
    const r = await call("GET", "/payouts/po_abc123");
    expect(r.status).toBe(200);
    expect(r.body.orders).toEqual([]);
    expect(r.body.breakdown.reconciled).toBe(true);
  });
});

describe("GET /balance inTransit", () => {
  it("sums payouts that are in transit", async () => {
    state.inTransit = [
      { id: "po_1", amount: 1_250, currency: "usd", status: "in_transit" },
      { id: "po_2", amount: 750, currency: "usd", status: "in_transit" },
      { id: "po_3", amount: 999, currency: "eur", status: "in_transit" },
    ];
    const r = await call("GET", "/balance");
    expect(r.status).toBe(200);
    expect(r.body.inTransit).toEqual({ amount: 2_000, currency: "usd", formatted: "$20.00" });
    expect(r.body.available.amount).toBe(100_000);
  });

  it("reports zero without Stripe", async () => {
    state.stripeOn = false;
    const r = await call("GET", "/balance");
    expect(r.body.connected).toBe(false);
    expect(r.body.inTransit).toEqual({ amount: 0, currency: "usd", formatted: "$0.00" });
  });
});
