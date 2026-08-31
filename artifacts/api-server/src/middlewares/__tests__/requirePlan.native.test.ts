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
    planId: "starter" as string,
    provider: "none" as "stripe" | "revenuecat" | "none",
    status: "none",
    lookupError: false,
    authUserId: "native-seller" as string | null,
    downstreamCalls: 0,
  };
});

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: state.authUserId }),
}));
vi.mock("@workspace/db", () => ({ db: {}, users: {} }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));
vi.mock("../../lib/nativeEntitlements", () => ({
  getEffectiveEntitlement: async () => {
    if (state.lookupError) throw new Error("database unavailable");
    return {
      planId: state.planId,
      status: state.status,
      provider: state.provider,
      native: null,
    };
  },
}));

import { requirePlan } from "../requireAuth";

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.get("/growth", requirePlan("growth"), (_req, res) => {
    state.downstreamCalls += 1;
    res.json({ ok: true });
  });
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
    state.authUserId = "native-seller";
    state.planId = "starter";
    state.provider = "none";
    state.status = "none";
    state.downstreamCalls = 0;
  });

  it("grants Growth endpoints from a server-verified native Growth entitlement", async () => {
    state.planId = "growth";
    state.provider = "revenuecat";
    state.status = "active";
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

  it("denies a missing or unknown plan", async () => {
    for (const plan of ["", "unknown"]) {
      state.planId = plan;
      const response = await fetch(`${base}/growth`);
      expect(response.status).toBe(403);
    }
    expect(state.downstreamCalls).toBe(0);
  });

  it("returns 401 without authentication", async () => {
    state.authUserId = null;
    const response = await fetch(`${base}/growth`);
    expect(response.status).toBe(401);
    expect(state.downstreamCalls).toBe(0);
  });

  it("grants Scale endpoints from a server-verified native Scale entitlement", async () => {
    state.planId = "scale";
    state.provider = "revenuecat";
    state.status = "active";
    expect((await fetch(`${base}/scale`)).status).toBe(200);
  });

  it("uses the resolved Stripe Growth entitlement when native access is expired", async () => {
    state.planId = "growth";
    state.provider = "stripe";
    state.status = "active";

    expect((await fetch(`${base}/growth`)).status).toBe(200);
    expect((await fetch(`${base}/scale`)).status).toBe(403);
  });

  it("uses the resolved native Scale entitlement when legacy Stripe is canceled", async () => {
    state.planId = "scale";
    state.provider = "revenuecat";
    state.status = "active";

    expect((await fetch(`${base}/scale`)).status).toBe(200);
  });

  it("denies access with 503 when the subscription plan lookup fails", async () => {
    state.lookupError = true;
    const response = await fetch(`${base}/growth`);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      error: "Unable to verify subscription plan",
      code: "PLAN_CHECK_UNAVAILABLE",
      requiredPlan: "growth",
    });
    expect(state.downstreamCalls).toBe(0);
  });
});