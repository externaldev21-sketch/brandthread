import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({
  user: null as null | Record<string, unknown>,
  account: null as any,
  created: [] as Array<{ params: any; options: any }>,
  links: [] as any[],
  loginLinks: [] as string[],
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = "seller-clerk-id";
    next();
  },
}));
vi.mock("drizzle-orm", () => ({ eq: (...v: unknown[]) => v }));
vi.mock("@workspace/db", () => {
  const columns = new Proxy({}, { get: (_t, key) => String(key) });
  return {
    users: columns,
    db: {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => (state.user ? [state.user] : []) }) }) }),
      update: () => ({
        set: (values: Record<string, unknown>) => {
          state.updates.push(values);
          if (state.user && typeof values.stripeAccountId === "string") state.user.stripeAccountId = values.stripeAccountId;
          return { where: async () => undefined };
        },
      }),
    },
  };
});
vi.mock("../../lib/stripe", () => {
  const client = {
    accounts: {
      create: async (params: any, options: any) => {
        state.created.push({ params, options });
        return { id: "acct_new" };
      },
      retrieve: async () => state.account,
      createLoginLink: async (id: string) => {
        state.loginLinks.push(id);
        return { url: "https://connect.stripe.com/express/login" };
      },
      listExternalAccounts: async () => ({ data: [], has_more: false }),
    },
    accountLinks: {
      create: async (params: any) => {
        state.links.push(params);
        return { url: "https://connect.stripe.com/setup/e/abc", expires_at: 1_900_000_000 };
      },
    },
  };
  return { stripe: client, requireStripe: () => client };
});

import connectRouter, { connectRedirectRouter } from "../connect";

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  process.env.CONNECT_STATE_SECRET = "test-secret";
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.log = { error: vi.fn() };
    next();
  });
  app.use("/api/seller/connect/onboard", connectRedirectRouter);
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
  state.user = { id: "u1", stripeAccountId: null, email: "sam@example.com", brandName: "Northline" };
  state.account = { details_submitted: false, requirements: { currently_due: ["individual.dob.day"] } };
  state.created.length = 0;
  state.links.length = 0;
  state.loginLinks.length = 0;
  state.updates.length = 0;
});

const post = (path: string, body: unknown = {}) =>
  fetch(`${baseUrl}/api/seller/connect${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /onboard", () => {
  it("creates an Express account with capabilities, US defaults and clerk metadata, then links", async () => {
    const res = await post("/onboard");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ url: "https://connect.stripe.com/setup/e/abc", kind: "account_onboarding", stripeAccountId: "acct_new" });
    const { params, options } = state.created[0];
    expect(params).toMatchObject({
      type: "express",
      country: "US",
      business_type: "individual",
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      metadata: { clerk_user_id: "seller-clerk-id" },
    });
    expect(options.idempotencyKey).toContain("seller-clerk-id");
    expect(state.updates[0]).toMatchObject({ stripeAccountId: "acct_new", stripeAccountStatus: "pending" });
    expect(state.links[0]).toMatchObject({ account: "acct_new", type: "account_onboarding" });
    expect(state.links[0].return_url).toMatch(/\/api\/seller\/connect\/onboard\/return$/);
    expect(state.links[0].refresh_url).toMatch(/\/onboard\/refresh\?state=/);
  });

  it("reuses the existing account on every call", async () => {
    state.user!.stripeAccountId = "acct_existing";
    await post("/onboard");
    await post("/onboard");
    expect(state.created).toHaveLength(0);
    expect(state.links.map((l) => l.account)).toEqual(["acct_existing", "acct_existing"]);
  });

  it("hands a fully submitted account the Express dashboard instead of an onboarding link", async () => {
    state.user!.stripeAccountId = "acct_done";
    state.account = { details_submitted: true, charges_enabled: true, payouts_enabled: true, requirements: { currently_due: [] } };
    const body: any = await (await post("/onboard")).json();
    expect(body).toMatchObject({ kind: "login_link", url: "https://connect.stripe.com/express/login", expiresAt: null });
    expect(state.links).toHaveLength(0);
  });

  it("keeps onboarding when a submitted account has new requirements", async () => {
    state.user!.stripeAccountId = "acct_due";
    state.account = { details_submitted: true, requirements: { currently_due: ["external_account"] } };
    const body: any = await (await post("/onboard")).json();
    expect(body.kind).toBe("account_onboarding");
  });

  it("rejects redirect URLs outside the allow-list", async () => {
    const res = await post("/onboard", { returnUrl: "https://evil.example/steal" });
    expect(res.status).toBe(400);
    expect(state.created).toHaveLength(0);
    expect((await post("/onboard", { refreshUrl: "javascript:alert(1)" })).status).toBe(400);
  });

  it("accepts an allow-listed Brandthread return URL", async () => {
    const res = await post("/onboard", { returnUrl: "https://brandthread.app/payout-setup" });
    expect(res.status).toBe(200);
    expect(state.links[0].return_url).toBe("https://brandthread.app/payout-setup");
  });

  it("404s when the user row is missing", async () => {
    state.user = null;
    expect((await post("/onboard")).status).toBe(404);
  });
});

describe("resume link", () => {
  it("GET /link mints a fresh link each time", async () => {
    state.user!.stripeAccountId = "acct_existing";
    const a = await fetch(`${baseUrl}/api/seller/connect/link`);
    const b = await fetch(`${baseUrl}/api/seller/connect/link`);
    expect(a.status).toBe(200);
    expect(((await b.json()) as any).url).toContain("connect.stripe.com");
    expect(state.links).toHaveLength(2);
  });

  it("POST /resume behaves the same", async () => {
    state.user!.stripeAccountId = "acct_existing";
    const res = await post("/resume");
    expect(res.status).toBe(200);
    expect(state.links).toHaveLength(1);
  });
});

describe("Stripe redirect targets", () => {
  it("/onboard/return deep links back into the app", async () => {
    const res = await fetch(`${baseUrl}/api/seller/connect/onboard/return`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("brandthread://payout-setup?returned=1");
  });

  it("/onboard/refresh with a valid state mints a fresh Stripe link", async () => {
    state.user!.stripeAccountId = "acct_existing";
    await post("/onboard");
    const refreshUrl = new URL(state.links[0].refresh_url);
    const res = await fetch(`${baseUrl}/api/seller/connect/onboard/refresh${refreshUrl.search}`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://connect.stripe.com/setup/e/abc");
    expect(state.links).toHaveLength(2);
  });

  it("/onboard/refresh without a valid state falls back to the app deep link", async () => {
    const res = await fetch(`${baseUrl}/api/seller/connect/onboard/refresh?state=forged.token`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("brandthread://payout-setup?refresh=1");
    expect(state.links).toHaveLength(0);
  });
});

describe("GET /status steps", () => {
  it("returns the structured checklist, deadline and keeps legacy fields", async () => {
    state.user!.stripeAccountId = "acct_existing";
    state.user!.stripeAccountStatus = "pending";
    state.account = {
      details_submitted: false, charges_enabled: false, payouts_enabled: false,
      requirements: {
        currently_due: ["individual.verification.document", "external_account"],
        past_due: ["external_account"],
        current_deadline: 1_800_000_000,
        disabled_reason: "requirements.past_due",
      },
    };
    const body: any = await (await fetch(`${baseUrl}/api/seller/connect/status`)).json();
    expect(body).toMatchObject({
      connected: true,
      status: "pending",
      requirementsDue: ["individual.verification.document", "external_account"],
      deadline: "2027-01-15T08:00:00.000Z",
      disabledReason: "requirements.past_due",
      setupState: "in_progress",
    });
    expect(body.steps.map((s: any) => [s.id, s.status])).toEqual([
      ["identity", "needed"], ["bank_account", "needed"], ["tax_info", "needed"],
    ]);
    expect(body.steps[1].pastDue).toBe(true);
  });
});
