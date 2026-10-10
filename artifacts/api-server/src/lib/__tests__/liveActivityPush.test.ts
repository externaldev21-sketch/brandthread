import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  tokens: [] as Array<{ token: string }>,
  order: null as null | Record<string, unknown>,
  deactivated: [] as unknown[],
}));

vi.mock("@workspace/db", () => {
  const liveActivityTokens = { token: "lat.token", kind: "lat.kind", targetId: "lat.targetId", active: "lat.active" };
  const orders = { id: "orders.id", status: "orders.status" };
  const fakeDb = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          const rows = table === liveActivityTokens ? state.tokens : state.order ? [state.order] : [];
          return Object.assign(Promise.resolve(rows), { limit: async () => rows });
        },
      }),
    }),
    update: () => ({
      set: (values: unknown) => ({
        where: async () => { state.deactivated.push(values); },
      }),
    }),
  };
  return { db: fakeDb, liveActivityTokens, orders };
});

vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => ({ eq: args }),
  and: (...args: unknown[]) => ({ and: args }),
}));

import {
  __resetApnsJwtCacheForTests,
  __resetLiveStreamThrottleForTests,
  __setApnsTransportForTests,
  apnsJwt,
  buildLiveStreamActivityPayload,
  buildOrderActivityPayload,
  etaEpochFromEstimatedDelivery,
  isLiveActivityPushConfigured,
  notifyLiveStreamActivity,
  notifyOrderLiveActivity,
  orderStageFromStatus,
  readApnsConfig,
  sendLiveActivityPush,
  type ApnsRequest,
} from "../liveActivityPush";

const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const ENV_KEYS = ["APNS_KEY_ID", "APNS_TEAM_ID", "APNS_AUTH_KEY", "APNS_BUNDLE_ID", "APNS_ENV"] as const;
const savedEnv: Record<string, string | undefined> = {};

function configure(overrides: Partial<Record<typeof ENV_KEYS[number], string>> = {}) {
  process.env.APNS_KEY_ID = "KEY123";
  process.env.APNS_TEAM_ID = "TEAM456";
  // Stored the way a secrets UI keeps a multi-line value: literal "\n".
  process.env.APNS_AUTH_KEY = pem.replace(/\n/g, "\\n");
  process.env.APNS_BUNDLE_ID = "com.brandthread.mobile";
  delete process.env.APNS_ENV;
  Object.assign(process.env, overrides);
}

let requests: ApnsRequest[] = [];
let respond: (req: ApnsRequest) => { status: number; body: string } = () => ({ status: 200, body: "" });

beforeEach(() => {
  for (const key of ENV_KEYS) { savedEnv[key] = process.env[key]; delete process.env[key]; }
  state.tokens = [];
  state.order = null;
  state.deactivated = [];
  requests = [];
  respond = () => ({ status: 200, body: "" });
  __resetApnsJwtCacheForTests();
  __resetLiveStreamThrottleForTests();
  __setApnsTransportForTests(async (req) => { requests.push(req); return respond(req); });
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key];
  }
  __setApnsTransportForTests(null);
  vi.useRealTimers();
});

describe("configuration", () => {
  it("is off unless every APNs variable is set", () => {
    expect(isLiveActivityPushConfigured()).toBe(false);
    configure();
    expect(isLiveActivityPushConfigured()).toBe(true);
    for (const key of ["APNS_KEY_ID", "APNS_TEAM_ID", "APNS_AUTH_KEY", "APNS_BUNDLE_ID"] as const) {
      configure({ [key]: "  " });
      expect(isLiveActivityPushConfigured()).toBe(false);
    }
  });

  it("defaults to production and unescapes the .p8 key", () => {
    configure();
    const config = readApnsConfig()!;
    expect(config.env).toBe("production");
    expect(config.authKey).toBe(pem.trim());
    configure({ APNS_ENV: "sandbox" });
    expect(readApnsConfig()!.env).toBe("sandbox");
  });
});

describe("apnsJwt", () => {
  it("is a verifiable ES256 token with kid, iss and iat", () => {
    configure();
    const now = new Date("2026-10-10T12:00:00Z");
    const jwt = apnsJwt(now);
    const [h, c, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "ES256", kid: "KEY123" });
    expect(JSON.parse(Buffer.from(c, "base64url").toString())).toEqual({ iss: "TEAM456", iat: now.getTime() / 1000 });
    const signature = Buffer.from(s, "base64url");
    expect(signature.length).toBe(64); // raw r||s, not DER
    expect(crypto.verify("sha256", Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, signature)).toBe(true);
  });

  it("is cached for ~50 minutes, then refreshed", () => {
    configure();
    const t0 = new Date("2026-10-10T12:00:00Z");
    const first = apnsJwt(t0);
    expect(apnsJwt(new Date(t0.getTime() + 49 * 60_000))).toBe(first);
    expect(apnsJwt(new Date(t0.getTime() + 51 * 60_000))).not.toBe(first);
  });

  it("throws when unconfigured", () => {
    expect(() => apnsJwt()).toThrow(/not configured/);
  });
});

describe("buildOrderActivityPayload", () => {
  it("matches the Swift OrderTrackingContentState contract", () => {
    expect(buildOrderActivityPayload({
      stage: "shipped", statusText: "On its way", etaEpochSeconds: 1_790_000_000, event: "update", nowSeconds: 1_789_000_000,
    })).toEqual({
      aps: {
        timestamp: 1_789_000_000,
        event: "update",
        "content-state": { stage: "shipped", statusText: "On its way", etaEpoch: 1_790_000_000 },
      },
    });
  });

  it("omits an unknown ETA and only alerts for out-for-delivery and delivered", () => {
    const ordered = buildOrderActivityPayload({ stage: "ordered", statusText: "Order confirmed", etaEpochSeconds: null, event: "update", nowSeconds: 1 });
    expect(ordered.aps["content-state"]).toEqual({ stage: "ordered", statusText: "Order confirmed" });
    expect(ordered.aps.alert).toBeUndefined();

    const out = buildOrderActivityPayload({ stage: "out_for_delivery", statusText: "Arriving today", etaEpochSeconds: null, event: "update", nowSeconds: 1 });
    expect(out.aps.alert).toEqual({ title: "Out for delivery", body: "Arriving today" });

    const delivered = buildOrderActivityPayload({
      stage: "delivered", statusText: "Your order was delivered", etaEpochSeconds: null, event: "end", dismissalEpochSeconds: 100, nowSeconds: 1,
    });
    expect(delivered.aps).toMatchObject({ event: "end", "dismissal-date": 100, alert: { title: "Delivered" } });
  });
});

describe("buildLiveStreamActivityPayload", () => {
  it("matches the Swift LiveStreamContentState contract", () => {
    expect(buildLiveStreamActivityPayload({
      viewers: 12, salesCents: 4500, ordersCount: 3, isLive: true, event: "update", nowSeconds: 5,
    })).toEqual({
      aps: { timestamp: 5, event: "update", "content-state": { viewers: 12, salesCents: 4500, ordersCount: 3, isLive: true } },
    });
  });

  it("clamps counts to whole non-negative numbers", () => {
    const p = buildLiveStreamActivityPayload({ viewers: -2, salesCents: 10.6, ordersCount: Number.NaN, isLive: false, event: "end", nowSeconds: 5 });
    expect(p.aps["content-state"]).toEqual({ viewers: 0, salesCents: 11, ordersCount: 0, isLive: false });
  });
});

describe("orderStageFromStatus", () => {
  it("maps order and carrier statuses onto four stages", () => {
    expect(orderStageFromStatus("pending", null)).toBe("ordered");
    expect(orderStageFromStatus("processing", null)).toBe("ordered");
    expect(orderStageFromStatus("fulfilled", null)).toBe("ordered");
    expect(orderStageFromStatus("shipped", null)).toBe("shipped");
    expect(orderStageFromStatus("processing", "label_created")).toBe("shipped");
    expect(orderStageFromStatus("shipped", "accepted")).toBe("shipped");
    expect(orderStageFromStatus("shipped", "in_transit")).toBe("shipped");
    expect(orderStageFromStatus("shipped", "exception")).toBe("shipped");
    expect(orderStageFromStatus("shipped", "out_for_delivery")).toBe("out_for_delivery");
    expect(orderStageFromStatus("shipped", "delivered")).toBe("delivered");
    expect(orderStageFromStatus("delivered", null)).toBe("delivered");
    expect(orderStageFromStatus("shipped", "in_transit", new Date())).toBe("delivered");
  });

  it("turns the carrier's YYYY-MM-DD estimate into a midday-UTC epoch", () => {
    expect(etaEpochFromEstimatedDelivery("2026-10-12")).toBe(Date.parse("2026-10-12T12:00:00Z") / 1000);
    expect(etaEpochFromEstimatedDelivery(null)).toBeNull();
    expect(etaEpochFromEstimatedDelivery("soon")).toBeNull();
  });
});

describe("sendLiveActivityPush", () => {
  const payload = buildOrderActivityPayload({ stage: "shipped", statusText: "x", etaEpochSeconds: null, event: "update", nowSeconds: 1 });

  it("is a no-op when unconfigured", async () => {
    expect(await sendLiveActivityPush("abcd", payload)).toEqual({ skipped: "not_configured" });
    expect(requests).toHaveLength(0);
  });

  it("sends a liveactivity push with the right headers", async () => {
    configure();
    expect(await sendLiveActivityPush("abcd", payload)).toEqual({ ok: true, status: 200 });
    expect(requests).toHaveLength(1);
    const [req] = requests;
    expect(req.host).toBe("api.push.apple.com");
    expect(req.path).toBe("/3/device/abcd");
    expect(req.headers).toMatchObject({
      "apns-push-type": "liveactivity",
      "apns-topic": "com.brandthread.mobile.push-type.liveactivity",
      "apns-priority": "10",
    });
    expect(req.headers.authorization).toMatch(/^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(JSON.parse(req.body)).toEqual(payload);
  });

  it("uses the sandbox host and a lower priority when asked", async () => {
    configure({ APNS_ENV: "sandbox" });
    await sendLiveActivityPush("abcd", payload, { priority: 5 });
    expect(requests[0].host).toBe("api.sandbox.push.apple.com");
    expect(requests[0].headers["apns-priority"]).toBe("5");
  });

  it("deactivates tokens APNs reports as gone", async () => {
    configure();
    respond = () => ({ status: 410, body: JSON.stringify({ reason: "Unregistered" }) });
    expect(await sendLiveActivityPush("dead1", payload)).toMatchObject({ ok: false, status: 410, deactivated: true });
    respond = () => ({ status: 400, body: JSON.stringify({ reason: "BadDeviceToken" }) });
    expect(await sendLiveActivityPush("dead2", payload)).toMatchObject({ deactivated: true, reason: "BadDeviceToken" });
    respond = () => ({ status: 403, body: JSON.stringify({ reason: "ExpiredToken" }) });
    expect(await sendLiveActivityPush("dead3", payload)).toMatchObject({ deactivated: true });
    expect(state.deactivated).toHaveLength(3);
    expect(state.deactivated[0]).toMatchObject({ active: false });
  });

  it("keeps the token on a transient failure", async () => {
    configure();
    respond = () => ({ status: 429, body: JSON.stringify({ reason: "TooManyRequests" }) });
    expect(await sendLiveActivityPush("abcd", payload)).toMatchObject({ ok: false, deactivated: false });
    expect(state.deactivated).toHaveLength(0);
  });
});

describe("notifyOrderLiveActivity", () => {
  it("does nothing when unconfigured", async () => {
    state.tokens = [{ token: "t1" }];
    expect(await notifyOrderLiveActivity("o1")).toEqual({ skipped: "not_configured" });
    expect(requests).toHaveLength(0);
  });

  it("pushes the current stage and ETA to every active token", async () => {
    configure();
    state.tokens = [{ token: "t1" }, { token: "t2" }];
    state.order = { status: "shipped", trackingStatus: "in_transit", estimatedDelivery: "2026-10-12", deliveredAt: null, carrier: "USPS" };
    expect(await notifyOrderLiveActivity("o1")).toEqual({ sent: 2, failed: 0 });
    const body = JSON.parse(requests[0].body);
    expect(body.aps.event).toBe("update");
    expect(body.aps["content-state"]).toEqual({
      stage: "shipped", statusText: "On its way with USPS", etaEpoch: Date.parse("2026-10-12T12:00:00Z") / 1000,
    });
  });

  it("ends the activity 4 hours after delivery", async () => {
    configure();
    state.tokens = [{ token: "t1" }];
    state.order = { status: "delivered", trackingStatus: "delivered", estimatedDelivery: "2026-10-12", deliveredAt: new Date(), carrier: null };
    await notifyOrderLiveActivity("o1");
    const body = JSON.parse(requests[0].body);
    expect(body.aps.event).toBe("end");
    expect(body.aps["dismissal-date"] - body.aps.timestamp).toBe(4 * 60 * 60);
    expect(body.aps["content-state"].stage).toBe("delivered");
    expect(body.aps["content-state"].etaEpoch).toBeUndefined();
  });

  it("skips orders nobody is tracking and never throws", async () => {
    configure();
    expect(await notifyOrderLiveActivity("o1")).toEqual({ skipped: "no_tokens" });
    state.tokens = [{ token: "t1" }];
    __setApnsTransportForTests(async () => { throw new Error("socket hang up"); });
    state.order = { status: "shipped", trackingStatus: null, estimatedDelivery: null, deliveredAt: null, carrier: null };
    expect(await notifyOrderLiveActivity("o1")).toEqual({ sent: 0, failed: 1 });
  });
});

describe("notifyLiveStreamActivity", () => {
  it("throttles routine updates but always sends the final one", async () => {
    configure();
    state.tokens = [{ token: "t1" }];
    const stats = { viewers: 10, salesCents: 0, ordersCount: 0, isLive: true };
    expect(await notifyLiveStreamActivity("s1", stats)).toEqual({ sent: 1, failed: 0 });
    expect(requests[0].headers["apns-priority"]).toBe("5");
    expect(await notifyLiveStreamActivity("s1", { ...stats, viewers: 11 })).toEqual({ skipped: "throttled" });
    expect(await notifyLiveStreamActivity("s1", { ...stats, isLive: false })).toEqual({ sent: 1, failed: 0 });
    const end = JSON.parse(requests[1].body);
    expect(requests[1].headers["apns-priority"]).toBe("10");
    expect(end.aps.event).toBe("end");
    expect(end.aps["content-state"].isLive).toBe(false);
  });

  it("does nothing when unconfigured", async () => {
    state.tokens = [{ token: "t1" }];
    expect(await notifyLiveStreamActivity("s1", { viewers: 1, salesCents: 0, ordersCount: 0, isLive: true }))
      .toEqual({ skipped: "not_configured" });
  });
});
