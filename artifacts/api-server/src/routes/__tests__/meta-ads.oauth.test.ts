import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({
  upsertedValues: null as any,
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = "seller-clerk-id";
    next();
  },
}));

vi.mock("@workspace/db", () => {
  const columns = new Proxy({}, { get: (_target, key) => String(key) });
  return {
    metaAdAccounts: columns,
    metaCampaigns: columns,
    metaCampaignInsights: columns,
    metaConversionEvents: columns,
    db: {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
      insert: () => ({
        values: (values: any) => ({
          onConflictDoUpdate: async (opts: any) => {
            state.upsertedValues = { values, set: opts.set };
            return undefined;
          },
        }),
      }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    },
  };
});

vi.mock("drizzle-orm", () => ({
  eq: (...values: unknown[]) => values,
  and: (...values: unknown[]) => values,
  desc: (value: unknown) => value,
}));

vi.mock("../../lib/metaGraph", () => ({
  MetaGraphError: class MetaGraphError extends Error {
    status: number;
    userMessage: string;
    constructor(params: { message: string; status: number; userMessage: string }) {
      super(params.message);
      this.status = params.status;
      this.userMessage = params.userMessage;
    }
  },
  exchangeCodeForToken: vi.fn(async () => ({ accessToken: "short-lived-token", expiresIn: 3600 })),
  getLongLivedToken: vi.fn(async () => ({ accessToken: "long-lived-token", expiresIn: 5_184_000 })),
  getMe: vi.fn(async () => ({ id: "meta-user-1", name: "Test Seller" })),
  listBusinesses: vi.fn(),
  listAdAccounts: vi.fn(),
  listPages: vi.fn(),
  getOrCreatePixel: vi.fn(),
  targetingSearch: vi.fn(),
  generatePreviews: vi.fn(),
  getInsights: vi.fn(),
  updateAdSetBudget: vi.fn(),
  updateCampaignStatus: vi.fn(),
  sendConversionEvent: vi.fn(),
}));

vi.mock("../../lib/metaCrypto", () => ({
  encryptToken: vi.fn((plaintext: string) => `encrypted:${plaintext}`),
  decryptToken: vi.fn((ciphertext: string) => ciphertext.replace(/^encrypted:/, "")),
  hasMetaTokenEncryptionKey: vi.fn(() => true),
}));

vi.mock("../../lib/metaAdsLaunch", () => ({
  launchCampaign: vi.fn(),
  LaunchError: class LaunchError extends Error {
    userMessage: string;
    constructor(userMessage: string) {
      super(userMessage);
      this.userMessage = userMessage;
    }
  },
}));

import metaAdsRouter from "../meta-ads";

let server: Server;
let baseUrl = "";
const ORIGINAL_ENV = { ...process.env };

function signState(sellerId: string, secret: string, issuedAt = Date.now()): string {
  const key = crypto.createHmac("sha256", secret).update("meta-ads-oauth-state-v1").digest();
  const payload = Buffer.from(JSON.stringify({ sellerId, issuedAt, nonce: "test-nonce" })).toString("base64url");
  const sig = crypto.createHmac("sha256", key).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

beforeAll(async () => {
  const app = express();
  app.use((req: any, _res, next) => {
    req.log = { error: vi.fn() };
    next();
  });
  app.use("/meta-ads", metaAdsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  process.env.META_OAUTH_STATE_SECRET = "test-oauth-state-secret";
  process.env.META_REDIRECT_URI = "https://api.brandthread.app/meta-ads/oauth/callback";
  process.env.META_APP_ID = "test-app-id";
  state.upsertedValues = null;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.clearAllMocks();
});

describe("GET /meta-ads/oauth/callback", () => {
  it("redirects to the error deep link when state is missing", async () => {
    const res = await fetch(`${baseUrl}/meta-ads/oauth/callback?code=abc`, { redirect: "manual" });
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("brandthread://meta-ads-connect?oauth=error");
  });

  it("redirects to the error deep link when state is tampered with", async () => {
    const validState = signState("seller-clerk-id", "test-oauth-state-secret");
    const tampered = `${validState.slice(0, -1)}x`;
    const res = await fetch(
      `${baseUrl}/meta-ads/oauth/callback?code=abc&state=${encodeURIComponent(tampered)}`,
      { redirect: "manual" },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location") ?? "").toContain("oauth=error");
  });

  it("redirects to the error deep link when state is expired", async () => {
    const expiredState = signState("seller-clerk-id", "test-oauth-state-secret", Date.now() - 11 * 60 * 1000);
    const res = await fetch(
      `${baseUrl}/meta-ads/oauth/callback?code=abc&state=${encodeURIComponent(expiredState)}`,
      { redirect: "manual" },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location") ?? "").toContain("oauth=error");
  });

  it("never returns a 500 for a bad state — always a redirect", async () => {
    const res = await fetch(`${baseUrl}/meta-ads/oauth/callback?state=garbage`, { redirect: "manual" });
    expect(res.status).toBe(302);
  });

  it("redirects to the success deep link and persists the connection on valid code+state", async () => {
    const validState = signState("seller-clerk-id", "test-oauth-state-secret");
    const res = await fetch(
      `${baseUrl}/meta-ads/oauth/callback?code=valid-code&state=${encodeURIComponent(validState)}`,
      { redirect: "manual" },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("brandthread://meta-ads-connect?oauth=success");
    expect(state.upsertedValues?.values).toMatchObject({
      sellerId: "seller-clerk-id",
      metaUserId: "meta-user-1",
      status: "pending_selection",
    });
    expect(state.upsertedValues?.values?.accessTokenEncrypted).toBe("encrypted:long-lived-token");
  });

  it("redirects to the error deep link with a plain-English message on a Meta failure", async () => {
    const metaGraph = await import("../../lib/metaGraph");
    (metaGraph.getMe as any).mockRejectedValueOnce(
      new metaGraph.MetaGraphError({
        message: "raw",
        status: 401,
        userMessage: "Your Meta connection expired — please reconnect.",
      }),
    );
    const validState = signState("seller-clerk-id", "test-oauth-state-secret");
    const res = await fetch(
      `${baseUrl}/meta-ads/oauth/callback?code=valid-code&state=${encodeURIComponent(validState)}`,
      { redirect: "manual" },
    );
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("oauth=error");
    expect(location).toContain(encodeURIComponent("Your Meta connection expired — please reconnect."));
  });
});
