/**
 * Coverage for GET /api/seller/connect/status when STRIPE_SECRET_KEY isn't
 * set in this environment. The mobile Payouts screen must render a clean
 * "setup needed" state instead of the endpoint throwing/crashing.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({
  user: null as null | { stripeAccountId: string | null; stripeAccountStatus: string | null },
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
            limit: async () => (state.user ? [state.user] : []),
          }),
        }),
      }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    },
  };
});

// No STRIPE_SECRET_KEY in this environment: `stripe` is null, exactly like
// the real module when the key is absent.
vi.mock("../../lib/stripe", () => ({
  stripe: null,
  requireStripe: () => {
    throw Object.assign(new Error("Stripe is not configured. Set STRIPE_SECRET_KEY."), { status: 503 });
  },
}));

import connectRouter from "../connect";

let server: Server;
let baseUrl = "";

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
});

async function getStatus() {
  const response = await fetch(`${baseUrl}/api/seller/connect/status`);
  return { status: response.status, body: await response.json() };
}

describe("seller Connect status without a configured Stripe key", () => {
  it("reports setup-needed (not a crash) when no account exists yet", async () => {
    state.user = { stripeAccountId: null, stripeAccountStatus: null };

    const result = await getStatus();

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      connected: false,
      status: "not_started",
      providerConfigured: false,
    });
  });

  it("reports provider_unavailable (not a crash) when the seller already has a Stripe account on file", async () => {
    state.user = { stripeAccountId: "acct_existing", stripeAccountStatus: "active" };

    const result = await getStatus();

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      connected: true,
      stripeAccountId: "acct_existing",
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      status: "provider_unavailable",
      verified: false,
      bankLast4: null,
      providerConfigured: false,
      payoutSchedule: null,
      requirementsDue: [],
      taxInfoStatus: "unknown",
    });
  });
});
