/**
 * Discounted labels from Shippo + EasyPost (item 50): rates from both are
 * merged cheapest first, each quote remembers its provider and real retail
 * price, and the label is bought and voided at the provider it came from.
 * Shippo is mocked; EasyPost's HTTP API is stubbed on global fetch.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, orders, shippingLabelQuotes, shippingLabels, orderFundReservations } from "@workspace/db";
import { eq } from "drizzle-orm";

const shippoCreateShipment = vi.fn(async (..._args: any[]) => ({
  object_id: "shippo_shp_1",
  rates: [
    { object_id: `shippo_rate_usps_${Math.random()}`, amount: "8.10", currency: "USD", provider: "USPS", servicelevel: { name: "Ground Advantage", token: "usps_ground_advantage" }, estimated_days: 4 },
    { object_id: `shippo_rate_ups_${Math.random()}`, amount: "12.00", currency: "USD", provider: "UPS", servicelevel: { name: "Ground", token: "ups_ground" }, estimated_days: 5 },
  ],
}));
const shippoPurchase = vi.fn();
const shippoRefund = vi.fn();

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => { req.clerkUserId = req.headers["x-test-user"]; next(); },
}));
vi.mock("../../middlewares/requireRole", () => ({
  teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../lib/shippo", () => ({
  createShipment: (...args: any[]) => shippoCreateShipment(...args),
  purchaseTransaction: (...args: any[]) => shippoPurchase(...args),
  findTransaction: vi.fn(async () => null),
  refundTransaction: (...args: any[]) => shippoRefund(...args),
  shippoCarrierToken: () => null,
  registerTrack: vi.fn(),
  getTrack: vi.fn(),
}));

const suffix = crypto.randomBytes(6).toString("hex");
const sellerId = `label-providers-seller-${suffix}`;
const epShipmentId = `shp_ep_${suffix}`;
const epUspsRate = `rate_ep_usps_${suffix}`;
const epFedexRate = `rate_ep_fedex_${suffix}`;
let orderId = "";
let server: Server;
let base = "";

type EpCall = { method: string; path: string; body: any; auth: string | null };
const epCalls: EpCall[] = [];
let epShipmentState: Record<string, unknown> = {};
let epFailQuotes = false;
const realFetch = globalThis.fetch;

function epJson(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeAll(async () => {
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (!url.startsWith("https://api.easypost.com/")) return realFetch(input, init);
    const path = url.replace("https://api.easypost.com/v2", "");
    const method = init?.method ?? "GET";
    epCalls.push({ method, path, body: init?.body ? JSON.parse(init.body) : null, auth: init?.headers?.Authorization ?? null });
    if (method === "POST" && path === "/shipments") {
      if (epFailQuotes) return epJson({ error: { message: "boom" } }, 500);
      return epJson({
        id: epShipmentId,
        rates: [
          { id: epUspsRate, shipment_id: epShipmentId, carrier: "USPS", service: "GroundAdvantage", rate: "6.95", retail_rate: "9.40", list_rate: "8.90", currency: "USD", delivery_days: 3 },
          { id: epFedexRate, shipment_id: epShipmentId, carrier: "FedEx", service: "FEDEX_GROUND", rate: "11.00", retail_rate: null, list_rate: null, currency: "USD", delivery_days: 4 },
        ],
      });
    }
    if (method === "GET" && path === `/shipments/${epShipmentId}`) return epJson({ id: epShipmentId, ...epShipmentState });
    if (method === "POST" && path === `/shipments/${epShipmentId}/buy`) {
      epShipmentState = {
        tracking_code: "9400100000000000000000",
        postage_label: { label_url: "https://easypost-files.example/label.png", label_pdf_url: "https://easypost-files.example/label.pdf" },
        selected_rate: { id: epUspsRate, carrier: "USPS", service: "GroundAdvantage", rate: "6.95" },
        refund_status: null,
      };
      return epJson({ id: epShipmentId, ...epShipmentState });
    }
    if (method === "POST" && path === `/shipments/${epShipmentId}/refund`) {
      epShipmentState = { ...epShipmentState, refund_status: "submitted" };
      return epJson({ id: epShipmentId, ...epShipmentState });
    }
    return epJson({ error: "not stubbed" }, 404);
  }) as typeof fetch;

  const [order] = await db.insert(orders).values({
    ownerId: sellerId,
    orderNumber: `LBLP-${suffix}`,
    status: "processing",
    totalCents: 5000,
    subtotalCents: 5000,
    shippingAddress: { name: "Sam Lee", street: "1 Main St", city: "Austin", state: "TX", zip: "78701", country: "US" },
  }).returning({ id: orders.id });
  orderId = order.id;

  const { default: shippingLabelsRouter } = await import("../shipping-labels");
  const app = express();
  app.use(express.json());
  app.use("/api/shipping-labels", shippingLabelsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
  epCalls.length = 0;
  epFailQuotes = false;
  process.env.EASYPOST_API_KEY = "EZTK_test_key";
});

afterEach(() => {
  delete process.env.EASYPOST_API_KEY;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await db.delete(orderFundReservations).where(eq(orderFundReservations.orderId, orderId));
  await db.delete(shippingLabels).where(eq(shippingLabels.orderId, orderId));
  await db.delete(shippingLabelQuotes).where(eq(shippingLabelQuotes.orderId, orderId));
  await db.delete(orders).where(eq(orders.id, orderId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function call(path: string, body: unknown) {
  const response = await fetch(`${base}/api/shipping-labels/${orderId}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-user": sellerId },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const parcel = {
  fromAddress: { name: "Store", street: "9 Mill Rd", city: "Dallas", state: "TX", zip: "75201", country: "US" },
  weight: "1.5", length: "10", width: "8", height: "4",
};

describe("shipping label rates across providers", () => {
  it("asks only Shippo when EASYPOST_API_KEY is missing", async () => {
    delete process.env.EASYPOST_API_KEY;
    const res = await call("/rates", parcel);
    expect(res.status).toBe(200);
    expect(epCalls).toHaveLength(0);
    expect(res.body.rates.map((r: any) => r.provider)).toEqual(["shippo", "shippo"]);
    // Shippo publishes no retail price, so no saving is shown.
    expect(res.body.rates.every((r: any) => r.retailPriceCents === null && r.savingsCents === null)).toBe(true);
  });

  it("merges both providers cheapest first and keeps the real retail price", async () => {
    const res = await call("/rates", parcel);
    expect(res.status).toBe(200);
    const quote = epCalls.find((c) => c.method === "POST" && c.path === "/shipments")!;
    expect(quote.auth).toBe(`Basic ${Buffer.from("EZTK_test_key:").toString("base64")}`);
    expect(quote.body.shipment.parcel.weight).toBe(24); // 1.5 lb in ounces
    expect(quote.body.shipment.to_address).toMatchObject({ street1: "1 Main St", zip: "78701" });

    const rates = res.body.rates;
    // USPS Ground Advantage is offered by both: the cheaper EasyPost one wins.
    expect(rates.map((r: any) => [r.provider, r.carrier, r.priceCents])).toEqual([
      ["easypost", "USPS", 695],
      ["easypost", "FedEx", 1100],
      ["shippo", "UPS", 1200],
    ]);
    expect(rates[0]).toMatchObject({ id: epUspsRate, service: "Ground Advantage", retailPriceCents: 940, savingsCents: 245 });
    expect(rates[1]).toMatchObject({ retailPriceCents: null, savingsCents: null });

    const [stored] = await db.select().from(shippingLabelQuotes).where(eq(shippingLabelQuotes.providerRateId, epUspsRate));
    expect(stored).toMatchObject({ provider: "easypost", providerShipmentId: epShipmentId, priceCents: 695, retailPriceCents: 940 });
  });

  it("still quotes Shippo when EasyPost fails", async () => {
    epFailQuotes = true;
    const res = await call("/rates", parcel);
    expect(res.status).toBe(200);
    expect(res.body.rates.map((r: any) => r.provider)).toEqual(["shippo", "shippo"]);
  });

  it("buys and voids an EasyPost rate at EasyPost", async () => {
    await call("/rates", parcel);
    epCalls.length = 0;
    const bought = await call("/purchase", { rateId: epUspsRate, idempotencyKey: `fulfill-${orderId}` });
    expect(bought.status).toBe(201);
    expect(shippoPurchase).not.toHaveBeenCalled();
    expect(epCalls.map((c) => `${c.method} ${c.path}`)).toEqual([
      `GET /shipments/${epShipmentId}`,
      `POST /shipments/${epShipmentId}/buy`,
    ]);
    expect(epCalls[1].body).toEqual({ rate: { id: epUspsRate } });
    expect(bought.body.label).toMatchObject({
      provider: "easypost", status: "active", priceCents: 695, carrier: "USPS",
      trackingNumber: "9400100000000000000000", labelUrl: "https://easypost-files.example/label.pdf",
    });

    epCalls.length = 0;
    const voided = await call(`/${bought.body.label.id}/void`, {});
    expect(voided.status).toBe(200);
    expect(shippoRefund).not.toHaveBeenCalled();
    expect(epCalls.map((c) => `${c.method} ${c.path}`)).toEqual([
      `GET /shipments/${epShipmentId}`,
      `POST /shipments/${epShipmentId}/refund`,
    ]);
    // USPS refunds are submitted, then settle later.
    expect(voided.body.refundPending).toBe(true);
    const [row] = await db.select().from(shippingLabels).where(eq(shippingLabels.id, bought.body.label.id));
    expect(row.status).toBe("void_pending");
  });
});
