import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({
  user: null as null | {
    stripeAccountId: string | null;
    stripeAccountStatus: string | null;
  },
  account: null as any,
  externalAccounts: [] as any[],
  retrieveError: null as Error | null,
  requireStripeCalls: 0,
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = "seller-clerk-id";
    next();
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (...values: unknown[]) => values,
}));

vi.mock("@workspace/db", () => {
  const columns = new Proxy({}, { get: (_target, key) => String(key) });
  return {
    users: columns,
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => state.user ? [state.user] : [],
          }),
        }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => {
          state.updates.push(values);
          return { where: async () => undefined };
        },
      }),
    },
  };
});

vi.mock("../../lib/stripe", () => ({
  requireStripe: () => {
    state.requireStripeCalls++;
    return {
      accounts: {
        retrieve: async () => {
          if (state.retrieveError) throw state.retrieveError;
          return state.account;
        },
        listExternalAccounts: async () => ({
          object: "list",
          data: state.externalAccounts,
          has_more: false,
          url: "/v1/accounts/acct/external_accounts",
        }),
      },
    };
  },
}));

import connectRouter from "../connect";

let server: Server;
let baseUrl = "";

async function getStatus() {
  const response = await fetch(`${baseUrl}/api/seller/connect/status`);
  return {
    status: response.status,
    body: await response.json(),
  };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.log = { error: vi.fn() };
    next();
  });
  app.use("/api/seller/connect", connectRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  state.user = null;
  state.account = null;
  state.externalAccounts.length = 0;
  state.retrieveError = null;
  state.requireStripeCalls = 0;
  state.updates.length = 0;
});

describe("seller Connect status", () => {
  it("returns not connected without requiring Stripe when no account exists", async () => {
    state.user = { stripeAccountId: null, stripeAccountStatus: null };

    const result = await getStatus();

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      connected: false,
      stripeAccountId: null,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      status: "not_started",
      verified: false,
      bankLast4: null,
    });
    expect(state.requireStripeCalls).toBe(0);
  });

  it("reports an incomplete account as pending", async () => {
    state.user = { stripeAccountId: "acct_pending", stripeAccountStatus: "active" };
    state.account = {
      charges_enabled: true,
      payouts_enabled: false,
      details_submitted: false,
      default_currency: "usd",
    };

    const result = await getStatus();

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      connected: true,
      status: "pending",
      verified: false,
      chargesEnabled: true,
      payoutsEnabled: false,
      bankLast4: null,
    });
    expect(state.updates[0]).toMatchObject({ stripeAccountStatus: "pending" });
  });

  it("reports payouts-enabled accounts as verified and exposes only bank last four", async () => {
    state.user = { stripeAccountId: "acct_active", stripeAccountStatus: "pending" };
    state.account = {
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      default_currency: "usd",
    };
    state.externalAccounts.push(
      { id: "ba_eur", object: "bank_account", currency: "eur", default_for_currency: true, last4: "4242" },
      { id: "ba_usd_old", object: "bank_account", currency: "usd", default_for_currency: false, last4: "5555" },
      { id: "ba_usd_default", object: "bank_account", currency: "usd", default_for_currency: true, last4: "6789", account_number: "sensitive" },
    );

    const result = await getStatus();

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      connected: true,
      stripeAccountId: "acct_active",
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      status: "active",
      verified: true,
      bankLast4: "6789",
    });
    expect(JSON.stringify(result.body)).not.toContain("sensitive");
  });

  it("keeps commerce restricted when payouts work but charges are disabled", async () => {
    state.user = { stripeAccountId: "acct_payouts_only", stripeAccountStatus: "pending" };
    state.account = {
      charges_enabled: false,
      payouts_enabled: true,
      details_submitted: true,
      default_currency: "usd",
    };
    state.externalAccounts.push({
      id: "ba_payouts_only",
      object: "bank_account",
      currency: "usd",
      default_for_currency: true,
      last4: "1122",
    });

    const result = await getStatus();

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      status: "restricted",
      verified: true,
      chargesEnabled: false,
      payoutsEnabled: true,
      bankLast4: "1122",
    });
    expect(state.updates[0]).toMatchObject({ stripeAccountStatus: "restricted" });
  });

  it("preserves restricted status for submitted accounts without payout capability", async () => {
    state.user = { stripeAccountId: "acct_restricted", stripeAccountStatus: "active" };
    state.account = {
      charges_enabled: true,
      payouts_enabled: false,
      details_submitted: true,
      default_currency: "usd",
    };

    const result = await getStatus();

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      status: "restricted",
      verified: false,
      chargesEnabled: true,
      payoutsEnabled: false,
    });
    expect(state.updates[0]).toMatchObject({ stripeAccountStatus: "restricted" });
  });

  it("returns a safe error when Stripe retrieval fails", async () => {
    state.user = { stripeAccountId: "acct_error", stripeAccountStatus: "pending" };
    state.retrieveError = new Error("provider secret");

    const result = await getStatus();

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: "Failed to retrieve Connect status" });
    expect(JSON.stringify(result.body)).not.toContain("provider secret");
  });
});