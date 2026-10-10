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
vi.mock("../../lib/admin/payoutControls", () => ({ isPayoutHeld: async () => false }));

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
            then: (resolve: any, reject: any) => Promise.resolve(rowsFor(name)).then(resolve, reject),
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
        list: async () => ({ data: [], has_more: false }),
        retrieve: async () => {
          if (!state.payoutRecord) throw Object.assign(new Error("No such payout"), { statusCode: 404 });
          return state.payoutRecord;
        },
        create: async (params: any) => {
          state.payoutCreates.push(params);
          return { id: "po_created1", amount: params.amount, currency: params.currency, status: "pending", arrival_date: 1_790_000_000 };
        },
      },
      balanceTransactions: { list: async () => ({ data: state.balanceTxns, has_more: false }) },
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
});

describe("permissions wiring", () => {
  it("guards the schedule PATCH and payouts with requirePermission('payouts')", () => {
    expect(state.permissions.length).toBeGreaterThanOrEqual(2);
    expect(new Set(state.permissions)).toEqual(new Set(["payouts"]));
  });
  it("denies the PATCH for a caller without the permission", async () => {
    state.denyWrites = true;
    expect((await call("PATCH", "/payout-schedule", { interval: "daily" })).status).toBe(403);
    expect(state.updateCalls).toHaveLength(0);
  });
});

describe("PATCH /payout-schedule", () => {
  it("validates input before touching Stripe", async () => {
    const r = await call("PATCH", "/payout-schedule", { interval: "weekly" });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("INVALID_SCHEDULE");
    expect(state.updateCalls).toHaveLength(0);
  });

  it("sets a weekly schedule with its anchor", async () => {
    const r = await call("PATCH", "/payout-schedule", { interval: "weekly", weeklyAnchor: "friday" });
    expect(r.status).toBe(200);
    expect(r.body.changed).toBe(true);
    expect(r.body.schedule).toMatchObject({ interval: "weekly", weeklyAnchor: "friday" });
    expect(state.updateCalls[0]).toEqual({ settings: { payouts: { schedule: { interval: "weekly", weekly_anchor: "friday" } } } });
  });

  it("is idempotent: the same schedule makes no Stripe write", async () => {
    const r = await call("PATCH", "/payout-schedule", { interval: "daily" });
    expect(r.status).toBe(200);
    expect(r.body.changed).toBe(false);
    expect(state.updateCalls).toHaveLength(0);
  });

  it("does not crash without Stripe or an account", async () => {
    state.stripeOn = false;
    expect((await call("PATCH", "/payout-schedule", { interval: "manual" })).status).toBe(503);
    state.stripeOn = true;
    state.accountId = null;
    const r = await call("PATCH", "/payout-schedule", { interval: "manual" });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("PAYOUTS_NOT_ENABLED");
  });
});

describe("GET /payout-schedule", () => {
  it("returns not connected without crashing when Stripe has no account", async () => {
    state.accountId = null;
    const r = await call("GET", "/payout-schedule");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ connected: false, schedule: null });
    expect(r.body.instant.eligible).toBe(false);
  });

  it("gates Instant honestly when only a bank is on file", async () => {
    const r = await call("GET", "/payout-schedule");
    expect(r.body.schedule.interval).toBe("daily");
    expect(r.body.instant).toMatchObject({ eligible: false, reason: "not_instant_capable", destination: null });
    expect(r.body.nextPayoutEstimate.kind).toBe("scheduled");
  });

  it("offers Instant for a Stripe-enabled debit card and quotes the fee", async () => {
    state.externalAccounts = [bank, debitCard];
    const r = await call("GET", "/payout-schedule?amount=50000");
    expect(r.body.instant.eligible).toBe(true);
    expect(r.body.instant.destination).toMatchObject({ last4: "4242", funding: "debit" });
    expect(r.body.instant.quote).toMatchObject({ amount: 50_000, fee: 500, total: 50_500, withinBalance: true });
    expect(r.body.instant.maxAmount.amount).toBe(99_010);
  });

  it("rejects a bad quote amount", async () => {
    expect((await call("GET", "/payout-schedule?amount=1.5")).status).toBe(400);
  });
});

describe("GET /payouts/:id", () => {
  const payout = (extra: object = {}) => ({
    id: "po_abc123", amount: 9_300, currency: "usd", status: "paid", automatic: true, method: "standard",
    arrival_date: 1_790_000_000, created: 1_789_900_000, destination: { last4: "6789", bank_name: "Chase" }, ...extra,
  });

  it("groups balance transactions and reconciles to the payout", async () => {
    state.payoutRecord = payout();
    state.balanceTxns = [{
      id: "txn_1", type: "payment", reporting_category: "charge", amount: 10_000, fee: 700, net: 9_300,
      fee_details: [{ type: "application_fee", amount: 500 }, { type: "stripe_fee", amount: 200 }],
    }];
    const r = await call("GET", "/payouts/po_abc123");
    expect(r.status).toBe(200);
    expect(r.body.payout).toMatchObject({ id: "po_abc123", status: "paid", destination: { last4: "6789" } });
    expect(r.body.breakdown.lines.sales.amount).toBe(10_000);
    expect(r.body.breakdown.lines.platformFee.amount).toBe(-500);
    expect(r.body.breakdown.lines.stripeFee.amount).toBe(-200);
    expect(r.body.breakdown.net.amount).toBe(9_300);
    expect(r.body.breakdown.reconciled).toBe(true);
  });

  it("shows a remainder as adjustments", async () => {
    state.payoutRecord = payout({ amount: 9_400 });
    state.balanceTxns = [{ id: "txn_1", type: "charge", amount: 9_300, fee: 0, net: 9_300, fee_details: [] }];
    const r = await call("GET", "/payouts/po_abc123");
    expect(r.body.breakdown.reconciled).toBe(false);
    expect(r.body.breakdown.lines.adjustments.amount).toBe(100);
    expect(r.body.breakdown.remainder.amount).toBe(100);
  });

  it("does not claim a breakdown for manual payouts", async () => {
    state.payoutRecord = payout({ automatic: false, method: "instant" });
    const r = await call("GET", "/payouts/po_abc123");
    expect(r.body.payout.automatic).toBe(false);
    expect(r.body.breakdown).toBeNull();
  });

  it("404s a payout that is not this seller's and rejects malformed ids", async () => {
    expect((await call("GET", "/payouts/po_missing123")).status).toBe(404);
    expect((await call("GET", "/payouts/not-a-payout")).status).toBe(400);
  });

  it("returns connected:false without Stripe", async () => {
    state.stripeOn = false;
    const r = await call("GET", "/payouts/po_abc123");
    expect(r.body).toEqual({ connected: false, payout: null, breakdown: null });
  });
});

describe("POST /payout method", () => {
  const key = "cashout_test_key_000001";

  it("rejects an unknown method", async () => {
    const r = await call("POST", "/payout", { amount: 100, currency: "usd", idempotencyKey: key, method: "wire" });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("INVALID_PAYOUT_METHOD");
  });

  it("standard payouts still bind the exact available balance and use method standard", async () => {
    const r = await call("POST", "/payout", { amount: 100_000, currency: "usd", idempotencyKey: key });
    expect(r.status).toBe(201);
    expect(state.payoutCreates[0]).toMatchObject({ amount: 100_000, method: "standard", destination: "ba_1" });
    expect(state.attempts[0].method).toBe("standard");
  });

  it("refuses instant without a Stripe-enabled debit card", async () => {
    const r = await call("POST", "/payout", { amount: 99_010, currency: "usd", idempotencyKey: key, method: "instant" });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("INSTANT_PAYOUT_UNAVAILABLE");
    expect(state.payoutCreates).toHaveLength(0);
  });

  it("instant binds the amount that fits with its fee and sends method instant to the card", async () => {
    state.externalAccounts = [bank, debitCard];
    const wrong = await call("POST", "/payout", { amount: 100_000, currency: "usd", idempotencyKey: key, method: "instant" });
    expect(wrong.status).toBe(409);
    expect(wrong.body).toMatchObject({ code: "BALANCE_CHANGED", availableAfterReservations: 99_010 });
    const ok = await call("POST", "/payout", { amount: 99_010, currency: "usd", idempotencyKey: key, method: "instant" });
    expect(ok.status).toBe(201);
    expect(state.payoutCreates[0]).toMatchObject({ amount: 99_010, method: "instant", destination: "card_1" });
    expect(state.attempts[0].method).toBe("instant");
  });

  it("a retry cannot switch method under the same idempotency key", async () => {
    state.externalAccounts = [bank, debitCard];
    await call("POST", "/payout", { amount: 99_010, currency: "usd", idempotencyKey: key, method: "instant" });
    const r = await call("POST", "/payout", { amount: 99_010, currency: "usd", idempotencyKey: key });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(state.payoutCreates).toHaveLength(1);
  });
});
