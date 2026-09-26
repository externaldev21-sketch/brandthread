import { describe, expect, it, beforeAll } from "vitest";
import crypto from "node:crypto";

beforeAll(() => {
  process.env.SHOPIFY_APP_API_KEY = "test-api-key";
  process.env.SHOPIFY_APP_API_SECRET = "test-api-secret";
});

describe("Shopify OAuth HMAC verification", () => {
  it("accepts a correctly signed OAuth callback query", async () => {
    const { verifyQueryHmac } = await import("../oauth");
    const query = { shop: "example.myshopify.com", state: "abc123", code: "codeval", timestamp: "1700000000" };
    const message = Object.keys(query).sort().map((k) => `${k}=${(query as any)[k]}`).join("&");
    const hmac = crypto.createHmac("sha256", "test-api-secret").update(message).digest("hex");
    expect(verifyQueryHmac({ ...query, hmac })).toBe(true);
  });

  it("rejects a tampered OAuth callback query", async () => {
    const { verifyQueryHmac } = await import("../oauth");
    const query = { shop: "example.myshopify.com", state: "abc123", code: "codeval", timestamp: "1700000000" };
    const message = Object.keys(query).sort().map((k) => `${k}=${(query as any)[k]}`).join("&");
    const hmac = crypto.createHmac("sha256", "test-api-secret").update(message).digest("hex");
    expect(verifyQueryHmac({ ...query, shop: "attacker.myshopify.com", hmac })).toBe(false);
  });

  it("rejects a callback with no hmac at all", async () => {
    const { verifyQueryHmac } = await import("../oauth");
    expect(verifyQueryHmac({ shop: "example.myshopify.com" })).toBe(false);
  });

  it("verifies a webhook body HMAC computed over the raw bytes", async () => {
    const { verifyWebhookHmac } = await import("../oauth");
    const raw = Buffer.from(JSON.stringify({ id: 123, order_id: 456 }));
    const hmac = crypto.createHmac("sha256", "test-api-secret").update(raw).digest("base64");
    expect(verifyWebhookHmac(raw, hmac)).toBe(true);
    expect(verifyWebhookHmac(raw, "not-the-right-hmac==")).toBe(false);
    expect(verifyWebhookHmac(Buffer.from("{}"), hmac)).toBe(false);
  });
});
