import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";

/**
 * Seller conversion tracking ("Additional scripts"): validation, masking,
 * each provider's hashing + payload, and the per-order idempotent send with
 * retries. The database is a small in-memory fake; fetch is mocked.
 */
const state = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, any>>>,
  inserts: [] as Array<{ table: string; values: Record<string, any> }>,
  updates: [] as Array<{ table: string; values: Record<string, any>; where: any }>,
}));

vi.hoisted(() => {
  process.env.META_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

vi.mock("drizzle-orm", () => ({
  eq: (column: { table: string; column: string }, value: unknown) => ({ op: "eq", column: column.column, value }),
  and: (...conditions: unknown[]) => ({ op: "and", conditions }),
}));

vi.mock("@workspace/db", () => {
  const table = (name: string) => new Proxy({ __table: name } as Record<string, unknown>, {
    get: (target, key) => key === "__table" ? target.__table : { table: name, column: String(key) },
  });
  const matches = (row: Record<string, any>, where: any): boolean => {
    if (!where) return true;
    if (where.op === "and") return where.conditions.every((c: any) => matches(row, c));
    if (where.op === "eq") return row[where.column] === where.value;
    return true;
  };
  const rowsOf = (t: any) => (state.tables[t.__table] ??= []);
  const db = {
    select: () => ({
      from: (t: any) => {
        let where: any = null;
        const chain: any = {
          leftJoin: () => chain,
          where: (w: any) => { where = w; return chain; },
          limit: async (n: number) => rowsOf(t).filter((r) => matches(r, where)).slice(0, n),
          then: (resolve: any, reject: any) => Promise.resolve(rowsOf(t).filter((r) => matches(r, where))).then(resolve, reject),
        };
        return chain;
      },
    }),
    insert: (t: any) => ({
      values: (values: Record<string, any>) => {
        const run = (conflict: "nothing" | { set: Record<string, any> } | null) => {
          state.inserts.push({ table: t.__table, values });
          const rows = rowsOf(t);
          const key = t.__table === "seller_conversion_tracking"
            ? (r: any) => r.sellerId === values.sellerId
            : (r: any) => r.orderId === values.orderId && r.provider === values.provider;
          const existing = rows.find(key);
          if (existing) {
            if (conflict && conflict !== "nothing") Object.assign(existing, conflict.set);
            return existing;
          }
          const row = { status: "pending", attempts: 0, ...values };
          rows.push(row);
          return row;
        };
        return {
          onConflictDoNothing: () => Promise.resolve(run("nothing")),
          onConflictDoUpdate: (opts: { set: Record<string, any> }) => ({ returning: async () => [run({ set: opts.set })] }),
        };
      },
    }),
    update: (t: any) => ({
      set: (values: Record<string, any>) => ({
        where: async (where: any) => {
          state.updates.push({ table: t.__table, values, where });
          for (const row of rowsOf(t).filter((r) => matches(r, where))) Object.assign(row, values);
        },
      }),
    }),
  };
  return {
    db,
    orders: table("orders"),
    orderItems: table("order_items"),
    productVariants: table("product_variants"),
    users: table("users"),
    sellerConversionTracking: table("seller_conversion_tracking"),
    conversionEventDeliveries: table("conversion_event_deliveries"),
  };
});

vi.mock("../logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import {
  ga4PurchasePayload, hashEmailBasic, hashEmailGa4, maskSecret, metaPurchasePayload, saveConversionTracking,
  sendPurchaseConversions, sendToProvider, tiktokPurchasePayload, trackingView, validateConversionTrackingPatch,
  type PurchaseEvent,
} from "../conversionTracking";

const sha = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

const META_TOKEN = `EAA${"b".repeat(60)}`;
const TIKTOK_TOKEN = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";
const GA4_SECRET = "AbCdEfGhIjKlMnOpQrStUv";

const EVENT: PurchaseEvent = {
  orderId: "11111111-1111-1111-1111-111111111111",
  orderNumber: "BT-00042",
  sellerId: "seller_1",
  buyerId: "buyer_1",
  email: "  Jane.Doe@Gmail.com ",
  valueCents: 5_499,
  taxCents: 400,
  shippingCents: 599,
  currency: "USD",
  paidAt: new Date("2026-10-06T12:00:00Z"),
  items: [{ productId: "prod_1", name: "Tee", quantity: 2, priceCents: 2_250 }],
};

beforeEach(() => {
  state.tables = {};
  state.inserts = [];
  state.updates = [];
});

describe("validateConversionTrackingPatch", () => {
  it("accepts and normalises valid IDs and secrets", () => {
    const result = validateConversionTrackingPatch({
      metaPixelId: "1234 5678 9012 345",
      metaAccessToken: META_TOKEN,
      tiktokPixelId: "cabcd1234efgh5678ijk",
      tiktokAccessToken: TIKTOK_TOKEN,
      ga4MeasurementId: "g-abc123xyz",
      ga4ApiSecret: GA4_SECRET,
    });
    expect(result).toEqual({
      ok: true,
      patch: {
        metaPixelId: "123456789012345",
        metaAccessToken: META_TOKEN,
        tiktokPixelId: "CABCD1234EFGH5678IJK",
        tiktokAccessToken: TIKTOK_TOKEN,
        ga4MeasurementId: "G-ABC123XYZ",
        ga4ApiSecret: GA4_SECRET,
      },
    });
  });

  it("rejects malformed values and treats null/empty as clear", () => {
    expect(validateConversionTrackingPatch({ metaPixelId: "abc" })).toMatchObject({ ok: false, field: "metaPixelId" });
    expect(validateConversionTrackingPatch({ metaAccessToken: "not-a-token" })).toMatchObject({ ok: false, field: "metaAccessToken" });
    expect(validateConversionTrackingPatch({ ga4MeasurementId: "UA-12345-1" })).toMatchObject({ ok: false, field: "ga4MeasurementId" });
    expect(validateConversionTrackingPatch({ tiktokPixelId: "<script>" })).toMatchObject({ ok: false, field: "tiktokPixelId" });
    expect(validateConversionTrackingPatch({ ga4ApiSecret: 12 })).toMatchObject({ ok: false, field: "ga4ApiSecret" });
    expect(validateConversionTrackingPatch({ metaPixelId: null, ga4ApiSecret: "" })).toEqual({ ok: true, patch: { metaPixelId: null, ga4ApiSecret: null } });
    expect(validateConversionTrackingPatch([])).toMatchObject({ ok: false });
  });
});

describe("secrets", () => {
  it("are stored encrypted and only ever returned masked", async () => {
    const view = await saveConversionTracking("seller_1", { metaPixelId: "123456789012345", metaAccessToken: META_TOKEN });
    const stored = state.tables.seller_conversion_tracking[0];
    expect(stored.metaAccessTokenEnc).toMatch(/^v1:/);
    expect(stored.metaAccessTokenEnc).not.toContain(META_TOKEN);
    expect(view.metaAccessTokenMasked).toBe(`••••${META_TOKEN.slice(-4)}`);
    expect(JSON.stringify(view)).not.toContain(META_TOKEN);
    expect(view.activeProviders).toEqual(["meta"]);
    expect(maskSecret(null)).toBeNull();
    expect(trackingView(undefined).activeProviders).toEqual([]);
  });
});

describe("hashing per provider", () => {
  it("Meta/TikTok: trim + lower-case; GA4 also drops dots in gmail local parts", () => {
    expect(hashEmailBasic(EVENT.email)).toBe(sha("jane.doe@gmail.com"));
    expect(hashEmailGa4(EVENT.email)).toBe(sha("janedoe@gmail.com"));
    expect(hashEmailGa4("a.b@example.com")).toBe(sha("a.b@example.com"));
    expect(hashEmailBasic("not an email")).toBeNull();
  });

  it("builds Purchase payloads with value, currency, order id and only hashed email", () => {
    const meta = metaPurchasePayload(EVENT);
    expect(meta.data[0]).toMatchObject({
      event_name: "Purchase", event_id: EVENT.orderId, event_time: Math.floor(EVENT.paidAt.getTime() / 1000),
      user_data: { em: [sha("jane.doe@gmail.com")], external_id: [sha("buyer_1")] },
      custom_data: { currency: "USD", value: 54.99, order_id: "BT-00042", num_items: 2 },
    });
    const tiktok = tiktokPurchasePayload(EVENT, "CABCD1234EFGH5678IJK");
    expect(tiktok).toMatchObject({ event_source: "web", event_source_id: "CABCD1234EFGH5678IJK" });
    expect(tiktok.data[0]).toMatchObject({
      event: "CompletePayment", event_id: EVENT.orderId, user: { email: sha("jane.doe@gmail.com") },
      properties: { currency: "USD", value: 54.99, order_id: "BT-00042" },
    });
    const ga4 = ga4PurchasePayload(EVENT);
    expect(ga4.events[0]).toMatchObject({
      name: "purchase", params: { transaction_id: EVENT.orderId, currency: "USD", value: 54.99, tax: 4, shipping: 5.99 },
    });
    expect(ga4.user_data).toEqual({ sha256_email_address: [sha("janedoe@gmail.com")] });
    expect(ga4.client_id).toMatch(/^\d+\.\d+$/);
    for (const payload of [meta, tiktok, ga4]) expect(JSON.stringify(payload).toLowerCase()).not.toContain("jane.doe@gmail.com");
  });
});

describe("sendToProvider", () => {
  it("calls each provider's endpoint with its credentials", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(url.includes("tiktok") ? '{"code":0,"message":"OK"}' : "{}", { status: 200 });
    }) as unknown as typeof fetch;
    await sendToProvider("meta", EVENT, { id: "123456789012345", secret: META_TOKEN }, fetchImpl);
    await sendToProvider("tiktok", EVENT, { id: "CABCD1234EFGH5678IJK", secret: TIKTOK_TOKEN }, fetchImpl);
    await sendToProvider("ga4", EVENT, { id: "G-ABC123", secret: GA4_SECRET }, fetchImpl);
    expect(calls[0].url).toMatch(/^https:\/\/graph\.facebook\.com\/v\d+\.0\/123456789012345\/events\?access_token=EAA/);
    expect(calls[1].url).toBe("https://business-api.tiktok.com/open_api/v1.3/event/track/");
    expect((calls[1].init.headers as Record<string, string>)["Access-Token"]).toBe(TIKTOK_TOKEN);
    expect(calls[2].url).toBe(`https://www.google-analytics.com/mp/collect?measurement_id=G-ABC123&api_secret=${GA4_SECRET}`);
  });

  it("treats TikTok's HTTP 200 with a non-zero code as a failure", async () => {
    const fetchImpl = vi.fn(async () => new Response('{"code":40001,"message":"bad token"}', { status: 200 })) as unknown as typeof fetch;
    await expect(sendToProvider("tiktok", EVENT, { id: "CABCD1234EFGH5678IJK", secret: TIKTOK_TOKEN }, fetchImpl)).rejects.toThrow(/40001/);
  });
});

describe("sendPurchaseConversions", () => {
  async function seedPaidOrder() {
    state.tables.orders = [{
      id: EVENT.orderId, orderNumber: "BT-00042", ownerId: "seller_1", buyerId: "buyer_1", guestEmail: null,
      totalCents: 5_499, taxCents: 400, shippingCents: 599, paidAt: EVENT.paidAt, createdAt: EVENT.paidAt, status: "pending",
    }];
    state.tables.users = [{ clerkId: "buyer_1", email: "jane.doe@gmail.com" }];
    state.tables.order_items = [{ orderId: EVENT.orderId, productId: "prod_1", name: "Tee", quantity: 2, priceCents: 2_250 }];
    await saveConversionTracking("seller_1", {
      metaPixelId: "123456789012345", metaAccessToken: META_TOKEN,
      ga4MeasurementId: "G-ABC123", ga4ApiSecret: GA4_SECRET,
    });
  }

  it("sends once per configured provider and never again for the same order", async () => {
    await seedPaidOrder();
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    expect(await sendPurchaseConversions(EVENT.orderId, { fetchImpl, retryDelayMs: 1 })).toEqual({ meta: "sent", ga4: "sent" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // A webhook redelivery: nothing is sent twice.
    expect(await sendPurchaseConversions(EVENT.orderId, { fetchImpl, retryDelayMs: 1 })).toEqual({ meta: "skipped", ga4: "skipped" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(state.tables.conversion_event_deliveries.map((r) => [r.provider, r.status])).toEqual([["meta", "sent"], ["ga4", "sent"]]);
  });

  it("retries 5xx up to 3 times, records the failure, and never throws", async () => {
    await seedPaidOrder();
    const fetchImpl = vi.fn(async (url: string) => (url.includes("facebook")
      ? new Response("down", { status: 503 })
      : new Response("{}", { status: 200 }))) as unknown as typeof fetch;
    const outcome = await sendPurchaseConversions(EVENT.orderId, { fetchImpl, retryDelayMs: 1 });
    expect(outcome).toEqual({ meta: "failed", ga4: "sent" });
    const meta = state.tables.conversion_event_deliveries.find((r) => r.provider === "meta")!;
    expect(meta).toMatchObject({ status: "failed", attempts: 3 });
    expect(meta.lastError).toMatch(/503/);
    // The next delivery attempt (webhook redelivery) tries the failed one again.
    const recovered = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    expect(await sendPurchaseConversions(EVENT.orderId, { fetchImpl: recovered, retryDelayMs: 1 })).toEqual({ meta: "sent", ga4: "skipped" });
  });

  it("does nothing for unpaid orders or sellers without tracking", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect(await sendPurchaseConversions(EVENT.orderId, { fetchImpl })).toEqual({});
    state.tables.orders = [{ id: EVENT.orderId, ownerId: "seller_2", paidAt: EVENT.paidAt, status: "pending", totalCents: 100 }];
    state.tables.order_items = [];
    expect(await sendPurchaseConversions(EVENT.orderId, { fetchImpl })).toEqual({});
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
