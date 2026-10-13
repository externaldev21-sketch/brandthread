/**
 * Taxes and duties: in-app registrations and the head office Stripe Tax needs,
 * on the seller's connected account (Stripe stubbed). Without Stripe or a
 * connected account the routes answer the not-connected state, never crash.
 */
import crypto from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, sellerTaxConfig, users } from "@workspace/db";

const SELLER = `tax-reg-seller-${crypto.randomBytes(4).toString("hex")}`;
const ACCOUNT = `acct_tax_${crypto.randomBytes(4).toString("hex")}`;

const state = vi.hoisted(() => ({
  stripeOn: true,
  settings: null as any,
  account: null as any,
  registrations: [] as any[],
  settingsUpdates: [] as Array<{ params: any; options: any }>,
  creates: [] as Array<{ params: any; options: any }>,
  rejectCreate: false,
  seller: "",
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => { req.clerkUserId = state.seller; next(); },
}));

vi.mock("../../lib/stripe", () => ({
  get stripe() {
    if (!state.stripeOn) return null;
    return {
      accounts: { retrieve: async () => state.account },
      tax: {
        settings: {
          retrieve: async () => state.settings,
          update: async (params: any, options: any) => {
            state.settingsUpdates.push({ params, options });
            state.settings = { ...(state.settings ?? {}), head_office: params.head_office ?? state.settings?.head_office };
            return state.settings;
          },
        },
        registrations: {
          list: async () => ({ data: state.registrations, has_more: false }),
          create: async (params: any, options: any) => {
            if (state.rejectCreate) throw Object.assign(new Error("Head office address is required"), { statusCode: 400 });
            state.creates.push({ params, options });
            const created = { id: `taxreg_${state.creates.length}`, status: "active", active_from: 1_790_000_000, ...params };
            state.registrations.push(created);
            return created;
          },
        },
      },
    };
  },
}));

import taxesRouter from "../taxes";

let server: Server;
let base = "";

async function call(method: string, path: string, body?: unknown) {
  const response = await fetch(`${base}/api/taxes${path}`, {
    method, headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as any };
}

const address = { line1: "1 Market St", city: "San Francisco", state: "CA", postalCode: "94105", country: "US" };

beforeAll(async () => {
  state.seller = SELLER;
  await db.insert(users).values({
    clerkId: SELLER, email: `${SELLER}@test.local`, name: "Tax Seller", role: "seller",
    stripeAccountId: ACCOUNT, stripeAccountStatus: "active",
  });
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.log = { error: vi.fn(), warn: vi.fn() }; next(); });
  app.use("/api/taxes", taxesRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(sellerTaxConfig).where(eq(sellerTaxConfig.sellerId, SELLER));
  await db.delete(users).where(eq(users.clerkId, SELLER));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  state.stripeOn = true;
  state.seller = SELLER;
  state.settings = null;
  state.account = { id: ACCOUNT };
  state.registrations = [];
  state.settingsUpdates = [];
  state.creates = [];
  state.rejectCreate = false;
});

describe("GET /registrations", () => {
  it("answers not connected without Stripe, never crashing", async () => {
    state.stripeOn = false;
    const r = await call("GET", "/registrations");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ connected: false, providerConfigured: false, headOffice: null, registrations: [] });
  });

  it("answers not connected for a seller without a Stripe account", async () => {
    state.seller = `${SELLER}-none`;
    const r = await call("GET", "/registrations");
    expect(r.body).toMatchObject({ connected: false, providerConfigured: true });
  });

  it("lists the seller's registrations by name with the head office", async () => {
    state.settings = { head_office: { address: { line1: "1 Market St", city: "San Francisco", state: "CA", postal_code: "94105", country: "US" } } };
    state.registrations = [
      { id: "taxreg_tx", country: "US", country_options: { us: { state: "TX", type: "state_sales_tax" } }, status: "active", active_from: 1_790_000_000 },
      { id: "taxreg_gb", country: "GB", country_options: { gb: { type: "standard" } }, status: "scheduled", active_from: 1_800_000_000 },
    ];
    const r = await call("GET", "/registrations");
    expect(r.body.connected).toBe(true);
    expect(r.body.headOffice).toEqual({ ...address, line2: null });
    expect(r.body.registrations.map((x: any) => [x.code, x.name, x.status])).toEqual([
      ["US-TX", "Texas", "active"], ["GB", "United Kingdom", "scheduled"],
    ]);
    expect(r.body.regions.length).toBeGreaterThan(50);
  });
});

describe("POST /registrations", () => {
  it("adds a US state registration on the seller's account", async () => {
    const r = await call("POST", "/registrations", { region: "us-ca" });
    expect(r.status).toBe(201);
    expect(r.body.registration).toMatchObject({ code: "US-CA", name: "California", status: "active" });
    expect(state.creates[0]).toEqual({
      params: { country: "US", active_from: "now", country_options: { us: { state: "CA", type: "state_sales_tax" } } },
      options: { stripeAccount: ACCOUNT },
    });
  });

  it("adds a country registration with the standard type", async () => {
    const r = await call("POST", "/registrations", { region: "GB" });
    expect(r.status).toBe(201);
    expect(state.creates[0].params).toEqual({ country: "GB", active_from: "now", country_options: { gb: { type: "standard" } } });
  });

  it("rejects an unknown region and a duplicate without calling Stripe", async () => {
    expect((await call("POST", "/registrations", { region: "FR" })).body.code).toBe("INVALID_REGION");
    await call("POST", "/registrations", { region: "US-NY" });
    const dup = await call("POST", "/registrations", { region: "US-NY" });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("ALREADY_REGISTERED");
    expect(state.creates).toHaveLength(1);
  });

  it("passes Stripe's reason through when it refuses", async () => {
    state.rejectCreate = true;
    const r = await call("POST", "/registrations", { region: "US-WA" });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: "REGISTRATION_REJECTED", error: "Head office address is required" });
  });

  it("answers 503 without Stripe", async () => {
    state.stripeOn = false;
    expect((await call("POST", "/registrations", { region: "US-CA" })).status).toBe(503);
  });
});

describe("head office", () => {
  it("PUT saves a validated address on Stripe Tax", async () => {
    expect((await call("PUT", "/head-office", { headOffice: { ...address, postalCode: "" } })).status).toBe(400);
    const r = await call("PUT", "/head-office", { headOffice: address });
    expect(r.status).toBe(200);
    expect(state.settingsUpdates[0]).toEqual({
      params: { head_office: { address: { line1: "1 Market St", city: "San Francisco", state: "CA", postal_code: "94105", country: "US" } } },
      options: { stripeAccount: ACCOUNT },
    });
  });

  it("enable asks for a head office when Stripe has none and onboarding gave no address", async () => {
    const r = await call("POST", "/enable", {});
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("HEAD_OFFICE_REQUIRED");
    expect(state.settingsUpdates).toHaveLength(0);
    const [config] = await db.select().from(sellerTaxConfig).where(eq(sellerTaxConfig.sellerId, SELLER));
    expect(config?.stripeTaxEnabled ?? false).toBe(false);
  });

  it("enable uses the business address from Stripe onboarding", async () => {
    state.account = { id: ACCOUNT, company: { address: { line1: "9 Main St", city: "Austin", state: "TX", postal_code: "73301", country: "US" } } };
    const r = await call("POST", "/enable", {});
    expect(r.status).toBe(200);
    expect(state.settingsUpdates[0].params).toEqual({
      defaults: { tax_behavior: "exclusive" },
      head_office: { address: { line1: "9 Main St", city: "Austin", state: "TX", postal_code: "73301", country: "US" } },
    });
  });

  it("enable with an entered address saves it, and keeps an existing one otherwise", async () => {
    const entered = await call("POST", "/enable", { headOffice: address });
    expect(entered.status).toBe(200);
    expect(state.settingsUpdates[0].params.head_office.address.city).toBe("San Francisco");
    const again = await call("POST", "/enable", {});
    expect(again.status).toBe(200);
    expect(state.settingsUpdates[1].params).toEqual({ defaults: { tax_behavior: "exclusive" } });
    const [config] = await db.select().from(sellerTaxConfig).where(eq(sellerTaxConfig.sellerId, SELLER));
    expect(config.stripeTaxEnabled).toBe(true);
  });

  it("enable rejects an incomplete entered address", async () => {
    const r = await call("POST", "/enable", { headOffice: { line1: "x" } });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("INVALID_HEAD_OFFICE");
  });
});
