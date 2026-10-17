import { describe, expect, it } from "vitest";
import { createTapstitchAdapterFromEnv, TapstitchAdapter } from "../fulfillmentPartners/tapstitchAdapter";
import { FulfillmentPartnerUnavailableError } from "../fulfillmentPartners/types";

const order = {
  brandthreadOrderId: "o1",
  orderNumber: "1001",
  lineItems: [{ sku: "TEE-M", quantity: 1 }],
  shippingAddress: { street: "1 Main", city: "Austin", state: "TX", zip: "78701", country: "US" },
};

describe("TapstitchAdapter", () => {
  it("is not created unless FULFILLMENT_PARTNER_ADAPTERS_ENABLED=true", () => {
    expect(createTapstitchAdapterFromEnv({ TAPSTITCH_API_KEY: "k" })).toBeNull();
    expect(createTapstitchAdapterFromEnv({ FULFILLMENT_PARTNER_ADAPTERS_ENABLED: "true" })).toBeInstanceOf(TapstitchAdapter);
  });

  it("fails with an actionable not-configured error when TAPSTITCH_API_KEY is unset", async () => {
    const adapter = createTapstitchAdapterFromEnv({ FULFILLMENT_PARTNER_ADAPTERS_ENABLED: "true" })!;
    const err = await adapter.createOrder(order).catch((e) => e);
    expect(err).toBeInstanceOf(FulfillmentPartnerUnavailableError);
    expect(err.reason).toBe("not_configured");
    expect(err.message).toMatch(/set TAPSTITCH_API_KEY/);
  });

  it("explains the Shopify path when a key is set but no public API exists", async () => {
    const adapter = new TapstitchAdapter("key");
    const err = await adapter.createOrder(order).catch((e) => e);
    expect(err).toBeInstanceOf(FulfillmentPartnerUnavailableError);
    expect(err.reason).toBe("no_public_api");
    expect(err.message).toMatch(/Fulfillment connections/);
  });
});
