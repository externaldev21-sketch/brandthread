import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => {
  // A bypass must only be honored by an explicitly development-mode server.
  // Keep the flag enabled here so this suite proves test/release-like modes
  // still exercise the real entitlement lookup path.
  process.env.NODE_ENV = "test";
  process.env.ENABLE_TEST_SUBSCRIPTION_BYPASS = "true";
  return {
    planId: "starter" as "starter" | "growth" | "scale",
    lookupError: false,
  };
});

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: "native-seller" }),
}));
vi.mock("@workspace/db", () => ({ db: {}, users: {} }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));
vi.mock("../../lib/nativeEntitlements", () => ({
  getEffectiveEntitlement: async () => {
    if (state.lookupError) throw new Error("database unavailable");
    return {
      planId: state.planId,
      status: "active",
      provider: "revenuecat",
      native: null,
    };
  },
}));

import { requirePlan } from "../requireAuth";

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.get("/growth", requirePlan("growth"), (_req, res) => res.json({ ok: true }));
  app.get("/scale", requirePlan("scale"), (_req, res) => res.json({ ok: true }));
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("requirePlan native entitlements", () => {
  beforeEach(() => {
    state.lookupError = false;
  });

  it("grants Growth endpoints from a server-verified native Growth entitlement", async () => {
    state.planId = "growth";
    expect((await fetch(`${base}/growth`)).status).toBe(200);
  });

  it("denies Starter access to Growth endpoints with a clear upgrade response", async () => {
    state.planId = "starter";
    const response = await fetch(`${base}/growth`);
    await expect(response.json()).resolves.toMatchObject({
      code: "PLAN_REQUIRED",
      currentPlan: "starter",
      requiredPlan: "growth",
    });
    expect(response.status).toBe(403);
  });

  it("grants Scale endpoints from a server-verified native Scale entitlement", async () => {
    state.planId = "scale";
    expect((await fetch(`${base}/scale`)).status).toBe(200);
  });

  it("denies access with 503 when the subscription plan lookup fails", async () => {
    state.lookupError = true;
    const response = await fetch(`${base}/growth`);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      error: "Unable to verify subscription plan",
      code: "PLAN_LOOKUP_UNAVAILABLE",
      requiredPlan: "growth",
    });
  });
});