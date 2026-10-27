import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ updates: [] as Array<Record<string, unknown>> }));

vi.mock("@workspace/db", () => ({
  metaAdAccounts: { id: "id" },
  db: {
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => { state.updates.push(values); },
      }),
    }),
  },
}));
vi.mock("drizzle-orm", () => ({ eq: (...v: unknown[]) => v }));
vi.mock("../metaCrypto", () => ({
  decryptToken: vi.fn((c: string) => c.replace(/^enc:/, "")),
  encryptToken: vi.fn((p: string) => `enc:${p}`),
}));
vi.mock("../metaGraph", () => ({
  MetaGraphError: class MetaGraphError extends Error {
    metaErrorCode?: number;
    constructor(p: { message: string; metaErrorCode?: number }) { super(p.message); this.metaErrorCode = p.metaErrorCode; }
    get requiresReconnect() { return this.metaErrorCode === 190; }
  },
  getLongLivedToken: vi.fn(),
  debugToken: vi.fn(),
}));

import {
  MetaReconnectRequiredError, connectionState, getFreshAccessToken, marketingTarget, resetTokenRefreshThrottle,
} from "../metaConnection";
import * as metaGraph from "../metaGraph";

const NOW = new Date("2026-10-27T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const ORIGINAL_ENV = { ...process.env };

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "acc-1", status: "connected", accessTokenEncrypted: "enc:tok-old", adAccountId: "act_live",
    tokenExpiresAt: new Date(NOW.getTime() + 30 * DAY), lastError: null, ...overrides,
  } as any;
}

beforeEach(() => {
  state.updates = [];
  resetTokenRefreshThrottle();
  vi.clearAllMocks();
});
afterEach(() => { process.env = { ...ORIGINAL_ENV }; });

describe("connectionState", () => {
  it("separates not connected, picking accounts, connected and needs reconnect", () => {
    expect(connectionState(null, NOW)).toBe("not_connected");
    expect(connectionState(row({ status: "disconnected", accessTokenEncrypted: "" }), NOW)).toBe("not_connected");
    expect(connectionState(row({ status: "pending_selection" }), NOW)).toBe("pending_selection");
    expect(connectionState(row(), NOW)).toBe("connected");
    expect(connectionState(row({ status: "needs_reauth" }), NOW)).toBe("needs_reconnect");
    expect(connectionState(row({ tokenExpiresAt: new Date(NOW.getTime() - 1) }), NOW)).toBe("needs_reconnect");
  });
});

describe("getFreshAccessToken", () => {
  it("returns the stored token without calling Meta when expiry is far off", async () => {
    await expect(getFreshAccessToken(row(), NOW)).resolves.toBe("tok-old");
    expect(metaGraph.getLongLivedToken).not.toHaveBeenCalled();
  });

  it("marks an expired token needs_reauth and throws a reconnect error", async () => {
    await expect(getFreshAccessToken(row({ tokenExpiresAt: new Date(NOW.getTime() - DAY) }), NOW))
      .rejects.toBeInstanceOf(MetaReconnectRequiredError);
    expect(state.updates).toEqual([expect.objectContaining({ status: "needs_reauth" })]);
  });

  it("re-exchanges a token in its last week and stores the extended one", async () => {
    vi.mocked(metaGraph.getLongLivedToken).mockResolvedValue({ accessToken: "tok-new", expiresIn: 60 * 24 * 60 * 60 });
    const token = await getFreshAccessToken(row({ tokenExpiresAt: new Date(NOW.getTime() + 3 * DAY) }), NOW);
    expect(token).toBe("tok-new");
    expect(metaGraph.getLongLivedToken).toHaveBeenCalledWith("tok-old");
    expect(state.updates[0]).toMatchObject({
      accessTokenEncrypted: "enc:tok-new",
      tokenExpiresAt: new Date(NOW.getTime() + 60 * DAY),
    });
  });

  it("keeps the current token when Meta doesn't extend it, and doesn't re-ask on every request", async () => {
    const expires = new Date(NOW.getTime() + 3 * DAY);
    vi.mocked(metaGraph.getLongLivedToken).mockResolvedValue({ accessToken: "tok-old", expiresIn: null });
    vi.mocked(metaGraph.debugToken).mockResolvedValue({ isValid: true, expiresAt: expires, scopes: [] });
    await expect(getFreshAccessToken(row({ tokenExpiresAt: expires }), NOW)).resolves.toBe("tok-old");
    await expect(getFreshAccessToken(row({ tokenExpiresAt: expires }), NOW)).resolves.toBe("tok-old");
    expect(metaGraph.getLongLivedToken).toHaveBeenCalledTimes(1);
    expect(state.updates).toEqual([]);
  });

  it("marks needs_reauth when the refresh exchange says the token is invalid (code 190)", async () => {
    vi.mocked(metaGraph.getLongLivedToken).mockRejectedValue(
      new (metaGraph.MetaGraphError as any)({ message: "Session has expired", metaErrorCode: 190 }),
    );
    await expect(getFreshAccessToken(row({ tokenExpiresAt: new Date(NOW.getTime() + DAY) }), NOW))
      .rejects.toBeInstanceOf(MetaReconnectRequiredError);
    expect(state.updates).toEqual([expect.objectContaining({ status: "needs_reauth" })]);
  });

  it("keeps using a still-valid token when Meta is unreachable during refresh", async () => {
    vi.mocked(metaGraph.getLongLivedToken).mockRejectedValue(new TypeError("fetch failed"));
    await expect(getFreshAccessToken(row({ tokenExpiresAt: new Date(NOW.getTime() + DAY) }), NOW)).resolves.toBe("tok-old");
  });
});

describe("marketingTarget (sandbox)", () => {
  it("uses the seller's ad account unless META_ADS_SANDBOX=1", () => {
    delete process.env.META_ADS_SANDBOX;
    expect(marketingTarget({ adAccountId: "act_live" }, "tok")).toEqual({ adAccountId: "act_live", accessToken: "tok", sandbox: false });
  });

  it("routes to the sandbox ad account (act_ prefixed) and its token when set", () => {
    process.env.META_ADS_SANDBOX = "1";
    process.env.META_SANDBOX_AD_ACCOUNT_ID = "555";
    expect(marketingTarget({ adAccountId: "act_live" }, "tok")).toEqual({ adAccountId: "act_555", accessToken: "tok", sandbox: true });
    process.env.META_SANDBOX_ACCESS_TOKEN = "sandbox-tok";
    expect(marketingTarget({ adAccountId: "act_live" }, "tok")).toEqual({ adAccountId: "act_555", accessToken: "sandbox-tok", sandbox: true });
  });
});
