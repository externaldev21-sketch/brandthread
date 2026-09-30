import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeShippingProvider } from "../shippingProvider";
import { createShipment, decodeRateId, purchaseTransaction, refundTransaction } from "../easypost";

const ENV_KEYS = ["SHIPPING_PROVIDER", "SHIPPO_API_KEY", "EASYPOST_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => { for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.unstubAllGlobals();
});

describe("activeShippingProvider", () => {
  it("defaults to Shippo (connector) with no keys", () => {
    expect(activeShippingProvider()).toBe("shippo");
  });
  it("prefers a Shippo key, then an EasyPost key", () => {
    process.env.EASYPOST_API_KEY = "ep";
    expect(activeShippingProvider()).toBe("easypost");
    process.env.SHIPPO_API_KEY = "sh";
    expect(activeShippingProvider()).toBe("shippo");
  });
  it("honours an explicit SHIPPING_PROVIDER", () => {
    process.env.SHIPPO_API_KEY = "sh";
    process.env.SHIPPING_PROVIDER = "easypost";
    expect(activeShippingProvider()).toBe("easypost");
  });
});

function mockFetch(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Array<{ url: string; init: any }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
    calls.push({ url, init });
    const next = responses.shift() ?? { body: {} };
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  }));
  return calls;
}

describe("easypost adapter", () => {
  beforeEach(() => { process.env.EASYPOST_API_KEY = "EZ_test"; });

  it("creates a shipment with ounces and returns Shippo-shaped rates", async () => {
    const calls = mockFetch([{ body: { id: "shp_1", rates: [
      { id: "rate_1", carrier: "USPS", service: "Priority", rate: "8.40", currency: "USD", delivery_days: 2 },
    ] } }]);
    const result = await createShipment({
      address_from: { name: "A" }, address_to: { name: "B" },
      parcels: [{ length: 10, width: 8, height: 4, weight: "1.5", mass_unit: "lb" }],
    });
    const sent = JSON.parse(calls[0].init.body);
    expect(sent.shipment.parcel.weight).toBe(24);
    expect(sent.shipment.options.label_size).toBe("4x6");
    expect(calls[0].init.headers.Authorization).toBe(`Basic ${Buffer.from("EZ_test:").toString("base64")}`);
    expect(result.rates[0]).toMatchObject({ amount: "8.40", provider: "USPS", estimated_days: 2 });
    expect(decodeRateId(result.rates[0].object_id)).toEqual({ shipmentId: "shp_1", rateId: "rate_1" });
  });

  it("buys a label and maps tracking + label url", async () => {
    mockFetch([{ body: {
      id: "shp_1", tracking_code: "9400", postage_label: { label_pdf_url: "https://x/label.pdf" },
      selected_rate: { id: "rate_1", carrier: "USPS", service: "Priority", rate: "8.40", currency: "USD" },
    } }]);
    const txn = await purchaseTransaction("shp_1|rate_1", "brandthread-label/abc");
    expect(txn).toMatchObject({ object_id: "shp_1", status: "SUCCESS", tracking_number: "9400", label_url: "https://x/label.pdf" });
    expect(txn.rate?.provider).toBe("USPS");
  });

  it("treats a repeated buy as the existing purchase", async () => {
    mockFetch([
      { status: 422, body: { error: "already purchased" } },
      { body: { id: "shp_1", tracking_code: "9400", postage_label: { label_url: "https://x/l.png" } } },
    ]);
    const txn = await purchaseTransaction("shp_1|rate_1", "ref");
    expect(txn.status).toBe("SUCCESS");
    expect(txn.tracking_number).toBe("9400");
  });

  it("maps refund status", async () => {
    mockFetch([{ body: { id: "shp_1", refund_status: "submitted" } }, { body: { id: "shp_1", refund_status: "refunded" } }]);
    expect((await refundTransaction("shp_1")).status).toBe("QUEUED");
    expect((await refundTransaction("shp_1")).status).toBe("SUCCESS");
  });
});
