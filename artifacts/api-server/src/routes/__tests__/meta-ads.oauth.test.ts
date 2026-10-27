import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({
  upsertedValues: null as any,
  accountRow: null as any,
  updates: [] as any[],
  inserted: null as any,
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
      select: () => ({ from: () => ({ where: () => ({ limit: async () => (state.accountRow ? [state.accountRow] : []) }) }) }),
      insert: () => ({
        values: (values: any) => ({
          onConflictDoUpdate: async (opts: any) => {
            state.upsertedValues = { values, set: opts.set };
            state.accountRow = { id: "acc-1", ...values };
            return undefined;
          },
          returning: async () => {
            state.inserted = values;
            return [{ id: "campaign-1", ...values }];
          },
        }),
      }),
      update: () => ({
        set: (values: any) => ({
          where: async () => {
            state.updates.push(values);
            if (state.accountRow) state.accountRow = { ...state.accountRow, ...values };
            return undefined;
          },
        }),
      }),
    },
  };
});

vi.mock("drizzle-orm", () => ({
  eq: (...values: unknown[]) => values,
  and: (...values: unknown[]) => values,
  desc: (value: unknown) => value,
}));

vi.mock("../../lib/metaGraph", async () => {
  const actual = await vi.importActual<typeof import("../../lib/metaGraph")>("../../lib/metaGraph");
  return {
    // Real error class, scopes and dialog URL builder; every network call mocked.
    MetaGraphError: actual.MetaGraphError,
    META_OAUTH_SCOPES: actual.META_OAUTH_SCOPES,
    META_REQUIRED_SCOPES: actual.META_REQUIRED_SCOPES,
    buildOAuthDialogUrl: actual.buildOAuthDialogUrl,
    graphVersion: actual.graphVersion,
    exchangeCodeForToken: vi.fn(async () => ({ accessToken: "short-lived-token", expiresIn: 3600 })),
    getLongLivedToken: vi.fn(async () => ({ accessToken: "long-lived-token", expiresIn: 5_184_000 })),
    debugToken: vi.fn(async () => ({
      isValid: true,
      expiresAt: new Date("2026-12-26T00:00:00.000Z"),
      scopes: [...actual.META_OAUTH_SCOPES],
    })),
    getMe: vi.fn(async () => ({ id: "meta-user-1", name: "Test Seller" })),
    listBusinesses: vi.fn(),
    listAdAccounts: vi.fn(),
    listPages: vi.fn(),
    getOrCreatePixel: vi.fn(),
    targetingSearch: vi.fn(),
    generatePreviews: vi.fn(),
    getDeliveryEstimate: vi.fn(),
    getInsights: vi.fn(),
    updateAdSetBudget: vi.fn(),
    updateCampaignStatus: vi.fn(),
    sendConversionEvent: vi.fn(),
  };
});

vi.mock("../../lib/metaCrypto", () => ({
  encryptToken: vi.fn((plaintext: string) => `encrypted:${plaintext}`),
  decryptToken: vi.fn((ciphertext: string) => ciphertext.replace(/^encrypted:/, "")),
  hasMetaTokenEncryptionKey: vi.fn(() => true),
}));

vi.mock("../../lib/metaAdsLaunch", () => ({
  launchCampaign: vi.fn(),
  buildTargeting: vi.fn(() => ({})),
  OBJECTIVE_TO_OPTIMIZATION_GOAL: {},
  LaunchError: class LaunchError extends Error {
    userMessage: string;
    constructor(userMessage: string) {
      super(userMessage);
      this.userMessage = userMessage;
    }
  },
}));

import metaAdsRouter, { metaAdsOauthCallbackRouter } from "../meta-ads";
import { hasMetaTokenEncryptionKey } from "../../lib/metaCrypto";
import * as metaGraph from "../../lib/metaGraph";

let server: Server;
let baseUrl = "";
const ORIGINAL_ENV = { ...process.env };
const DAY = 86_400_000;

function signState(sellerId: string, secret: string, issuedAt = Date.now()): string {
  const key = crypto.createHmac("sha256", secret).update("meta-ads-oauth-state-v1").digest();
  const payload = Buffer.from(JSON.stringify({ sellerId, issuedAt, nonce: "test-nonce" })).toString("base64url");
  const sig = crypto.createHmac("sha256", key).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function connectedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "acc-1", sellerId: "seller-clerk-id", status: "connected", accessTokenEncrypted: "encrypted:tok",
    tokenExpiresAt: new Date(Date.now() + 40 * DAY), adAccountId: "act_1", pageId: "page-1",
    businessName: "Biz", adAccountName: "Ads", adAccountCurrency: "USD", pageName: "Page", instagramUsername: "ig",
    lastError: null, ...overrides,
  };
}

const post = (path: string, body: unknown) =>
  fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeAll(async () => {
  const app = express();
  app.use((req: any, _res, next) => {
    req.log = { error: vi.fn(), warn: vi.fn() };
    next();
  });
  // Mounted like routes/index.ts: the callback ahead of the authenticated router.
  app.use("/meta-ads/oauth/callback", metaAdsOauthCallbackRouter);
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
  vi.mocked(hasMetaTokenEncryptionKey).mockReturnValue(true);
  process.env.META_OAUTH_STATE_SECRET = "test-oauth-state-secret";
  process.env.META_REDIRECT_URI = "https://brandthread.app/api/meta-ads/oauth/callback";
  process.env.META_APP_ID = "test-app-id";
  process.env.META_APP_SECRET = "test-app-secret";
  delete process.env.META_LOGIN_CONFIG_ID;
  delete process.env.META_ADS_SANDBOX;
  state.upsertedValues = null;
  state.accountRow = null;
  state.updates = [];
  state.inserted = null;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.clearAllMocks();
});

describe("Meta configuration guards", () => {
  it("keeps connection status available and explicitly unconfigured without the encryption key", async () => {
    vi.mocked(hasMetaTokenEncryptionKey).mockReturnValue(false);
    const res = await fetch(`${baseUrl}/meta-ads/connection`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      state: "not_configured",
      connected: false,
      configured: false,
      configurationError: "Meta / Instagram is not configured.",
    });
  });

  it("rejects OAuth startup without the encryption key rather than starting an unrecoverable connection", async () => {
    vi.mocked(hasMetaTokenEncryptionKey).mockReturnValue(false);
    const res = await fetch(`${baseUrl}/meta-ads/oauth/start`);
    expect(res.status).toBe(503);
    expect(await res.text()).toMatch(/not configured/i);
  });
});

describe("GET /meta-ads/oauth/start", () => {
  it("returns the Facebook Login dialog URL with scopes, redirect URI and a verifiable state", async () => {
    const res = await fetch(`${baseUrl}/meta-ads/oauth/start`);
    expect(res.status).toBe(200);
    const { authUrl } = (await res.json()) as { authUrl: string };
    const url = new URL(authUrl);
    expect(url.host).toBe("www.facebook.com");
    expect(url.pathname).toBe(`/${metaGraph.graphVersion()}/dialog/oauth`);
    expect(url.searchParams.get("client_id")).toBe("test-app-id");
    expect(url.searchParams.get("redirect_uri")).toBe("https://brandthread.app/api/meta-ads/oauth/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe(metaGraph.META_OAUTH_SCOPES.join(","));
    expect(url.searchParams.get("state")).toMatch(/^[\w-]+\.[\w-]+$/);
  });
});

describe("GET /meta-ads/oauth/callback", () => {
  it("redirects to the error deep link when state is missing", async () => {
    const res = await fetch(`${baseUrl}/meta-ads/oauth/callback?code=abc`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location") ?? "").toContain("brandthread://meta-ads-connect?oauth=error");
  });

  it("redirects to the error deep link when state is tampered with", async () => {
    const tampered = `${signState("seller-clerk-id", "test-oauth-state-secret").slice(0, -1)}x`;
    const res = await fetch(`${baseUrl}/meta-ads/oauth/callback?code=abc&state=${encodeURIComponent(tampered)}`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location") ?? "").toContain("oauth=error");
  });

  it("redirects to the error deep link when state is expired", async () => {
    const expiredState = signState("seller-clerk-id", "test-oauth-state-secret", Date.now() - 11 * 60 * 1000);
    const res = await fetch(`${baseUrl}/meta-ads/oauth/callback?code=abc&state=${encodeURIComponent(expiredState)}`, { redirect: "manual" });
    expect(res.headers.get("location") ?? "").toContain("oauth=error");
  });

  it("never returns a 500 for a bad state — always a redirect", async () => {
    const res = await fetch(`${baseUrl}/meta-ads/oauth/callback?state=garbage`, { redirect: "manual" });
    expect(res.status).toBe(302);
  });

  it("says the seller cancelled when Meta returns access_denied", async () => {
    const valid = signState("seller-clerk-id", "test-oauth-state-secret");
    const res = await fetch(
      `${baseUrl}/meta-ads/oauth/callback?error=access_denied&error_reason=user_denied&state=${encodeURIComponent(valid)}`,
      { redirect: "manual" },
    );
    expect(res.headers.get("location")).toContain(encodeURIComponent("You cancelled the Meta connection."));
  });

  it("hands code + state back to the app without exchanging or storing anything", async () => {
    const valid = signState("seller-clerk-id", "test-oauth-state-secret");
    const res = await fetch(`${baseUrl}/meta-ads/oauth/callback?code=valid-code&state=${encodeURIComponent(valid)}`, { redirect: "manual" });
    expect(res.status).toBe(302);
    const location = new URL((res.headers.get("location") ?? "").replace("brandthread://", "https://x/"));
    expect(location.pathname).toBe("/meta-ads-connect");
    expect(Object.fromEntries(location.searchParams)).toEqual({ oauth: "code", code: "valid-code", state: valid });
    expect(metaGraph.exchangeCodeForToken).not.toHaveBeenCalled();
    expect(state.upsertedValues).toBeNull();
  });
});

describe("POST /meta-ads/oauth/complete", () => {
  it("exchanges code → short-lived → long-lived token and stores it encrypted with Meta's expiry and granted scopes", async () => {
    const valid = signState("seller-clerk-id", "test-oauth-state-secret");
    const res = await post("/meta-ads/oauth/complete", { code: "valid-code", state: valid });
    expect(res.status).toBe(200);
    expect(metaGraph.exchangeCodeForToken).toHaveBeenCalledWith({
      code: "valid-code", redirectUri: "https://brandthread.app/api/meta-ads/oauth/callback",
    });
    expect(metaGraph.getLongLivedToken).toHaveBeenCalledWith("short-lived-token");
    expect(state.upsertedValues?.values).toMatchObject({
      sellerId: "seller-clerk-id",
      metaUserId: "meta-user-1",
      status: "pending_selection",
      accessTokenEncrypted: "encrypted:long-lived-token",
      tokenExpiresAt: new Date("2026-12-26T00:00:00.000Z"),
      scopes: [...metaGraph.META_OAUTH_SCOPES],
    });
    expect(await res.json()).toMatchObject({ state: "pending_selection", connected: false });
  });

  it("refuses a state signed for a different seller (login CSRF) without touching Meta", async () => {
    const otherSeller = signState("attacker-seller", "test-oauth-state-secret");
    const res = await post("/meta-ads/oauth/complete", { code: "valid-code", state: otherSeller });
    expect(res.status).toBe(400);
    expect(metaGraph.exchangeCodeForToken).not.toHaveBeenCalled();
    expect(state.upsertedValues).toBeNull();
  });

  it("asks the seller to reconnect with every permission when a required one was unticked", async () => {
    vi.mocked(metaGraph.debugToken).mockResolvedValueOnce({ isValid: true, expiresAt: null, scopes: ["ads_read", "pages_show_list"] });
    const res = await post("/meta-ads/oauth/complete", { code: "c", state: signState("seller-clerk-id", "test-oauth-state-secret") });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { missingScopes: string[] }).missingScopes).toEqual(["ads_management", "business_management"]);
    expect(state.upsertedValues).toBeNull();
  });

  it("returns Meta's plain-English reason (never a 401) when the exchange fails", async () => {
    vi.mocked(metaGraph.getMe).mockRejectedValueOnce(
      new metaGraph.MetaGraphError({ message: "raw", status: 400, metaErrorCode: 100, userMessage: "Some of your campaign settings aren't valid — please review and try again." }),
    );
    const res = await post("/meta-ads/oauth/complete", { code: "c", state: signState("seller-clerk-id", "test-oauth-state-secret") });
    expect(res.status).toBe(422);
  });
});

describe("GET /meta-ads/connection states", () => {
  it("reports not_connected for no row", async () => {
    const res = await fetch(`${baseUrl}/meta-ads/connection`);
    expect(await res.json()).toMatchObject({ state: "not_connected", connected: false, configured: true });
  });

  it("reports connected without ever returning the token", async () => {
    state.accountRow = connectedRow();
    const body = await (await fetch(`${baseUrl}/meta-ads/connection`)).json();
    expect(body).toMatchObject({ state: "connected", connected: true, adAccountName: "Ads" });
    expect(JSON.stringify(body)).not.toContain("encrypted:tok");
  });

  it("reports needs_reconnect (distinct from not connected) once the token has expired", async () => {
    state.accountRow = connectedRow({ tokenExpiresAt: new Date(Date.now() - DAY) });
    const body = await (await fetch(`${baseUrl}/meta-ads/connection`)).json();
    expect(body).toMatchObject({ state: "needs_reconnect", connected: false, status: "needs_reauth" });
    expect(state.updates).toEqual([expect.objectContaining({ status: "needs_reauth" })]);
  });
});

describe("token expiry on Meta calls", () => {
  it("answers 409 META_RECONNECT_REQUIRED for an expired token instead of calling Meta", async () => {
    state.accountRow = connectedRow({ tokenExpiresAt: new Date(Date.now() - DAY) });
    const res = await fetch(`${baseUrl}/meta-ads/businesses`);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "META_RECONNECT_REQUIRED" });
    expect(metaGraph.listBusinesses).not.toHaveBeenCalled();
  });

  it("marks the connection needs_reauth when Meta answers code 190 / subcode 463", async () => {
    state.accountRow = connectedRow();
    vi.mocked(metaGraph.listBusinesses).mockRejectedValueOnce(
      new metaGraph.MetaGraphError({ message: "Session has expired", status: 400, metaErrorCode: 190, metaErrorSubcode: 463, userMessage: "x" }),
    );
    const res = await fetch(`${baseUrl}/meta-ads/businesses`);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "META_RECONNECT_REQUIRED" });
    expect(state.updates.some((u) => u.status === "needs_reauth")).toBe(true);
  });

  it("answers 409 META_NOT_CONNECTED when there is no connection", async () => {
    const res = await fetch(`${baseUrl}/meta-ads/businesses`);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "META_NOT_CONNECTED" });
  });
});

describe("POST /meta-ads/campaigns schedule validation", () => {
  const draft = (overrides: Record<string, unknown> = {}) => ({
    promoteKind: "store", objective: "traffic", budgetCents: 2000,
    destinationUrl: "https://brandthread.app/s", ...overrides,
  });

  beforeEach(() => {
    state.accountRow = connectedRow();
  });

  it("rejects a start date in the past", async () => {
    const res = await post("/meta-ads/campaigns", draft({ startTime: new Date(Date.now() - 2 * DAY).toISOString() }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("Start date can't be in the past.");
    expect(state.inserted).toBeNull();
  });

  it("rejects an end date on or before the start", async () => {
    const start = new Date(Date.now() + 3 * DAY).toISOString();
    const res = await post("/meta-ads/campaigns", draft({ startTime: start, endTime: start }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("End date must be after the start date.");
  });

  it("rejects a flight longer than 90 days", async () => {
    const res = await post("/meta-ads/campaigns", draft({
      startTime: new Date(Date.now() + DAY).toISOString(), endTime: new Date(Date.now() + 120 * DAY).toISOString(),
    }));
    expect(res.status).toBe(400);
  });

  it("stores a valid flight as dates", async () => {
    const start = new Date(Date.now() + DAY);
    const end = new Date(Date.now() + 8 * DAY);
    const res = await post("/meta-ads/campaigns", draft({ startTime: start.toISOString(), endTime: end.toISOString() }));
    expect(res.status).toBe(201);
    expect(state.inserted).toMatchObject({ startTime: start, endTime: end, metaObjective: "OUTCOME_TRAFFIC" });
  });

  it("refuses new drafts with a reconnect code while the token is expired", async () => {
    state.accountRow = connectedRow({ status: "needs_reauth" });
    const res = await post("/meta-ads/campaigns", draft());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "META_RECONNECT_REQUIRED" });
  });
});
