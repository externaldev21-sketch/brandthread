import { describe, expect, it, vi } from "vitest";
import { ensureShopifyWebhooks, shopifyWebhookAddress, topicsForScopes } from "../webhooks";

const FULFILLMENT_SCOPES = "read_products,read_inventory,read_orders,write_orders,read_fulfillments";
const ADDRESS = "https://brandthread.app/api/webhooks/shopify";

describe("ensureShopifyWebhooks", () => {
  it("registers fulfillment, cancellation and uninstall topics for a fulfillment connection", async () => {
    const client = { listWebhooks: vi.fn(async () => ({ webhooks: [] })), createWebhook: vi.fn(async () => ({ webhook: { id: 1 } })) };
    const result = await ensureShopifyWebhooks(client, FULFILLMENT_SCOPES, ADDRESS);
    expect(result.created).toEqual(["app/uninstalled", "fulfillments/create", "fulfillments/update", "orders/cancelled"]);
    expect(client.createWebhook).toHaveBeenCalledWith("fulfillments/create", ADDRESS);
  });

  it("only registers uninstall for an import-only connection", () => {
    expect(topicsForScopes("read_products,read_inventory")).toEqual(["app/uninstalled"]);
  });

  it("skips topics already registered at this address", async () => {
    const client = {
      listWebhooks: vi.fn(async () => ({ webhooks: [
        { id: 1, topic: "app/uninstalled", address: ADDRESS },
        { id: 2, topic: "fulfillments/create", address: "https://old.example.com/hook" },
      ] })),
      createWebhook: vi.fn(async () => ({ webhook: { id: 3 } })),
    };
    const result = await ensureShopifyWebhooks(client, FULFILLMENT_SCOPES, ADDRESS);
    expect(result.existing).toEqual(["app/uninstalled"]);
    expect(result.created).toEqual(["fulfillments/create", "fulfillments/update", "orders/cancelled"]);
  });

  it("targets the /api route the server serves", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(shopifyWebhookAddress()).toBe(ADDRESS);
    vi.unstubAllEnvs();
  });
});
