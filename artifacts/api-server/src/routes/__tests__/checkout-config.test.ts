import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import checkoutConfigRouter from "../checkout-config";

let server: Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use("/public", checkoutConfigRouter);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
afterEach(() => { vi.unstubAllEnvs(); });

describe("GET /public/checkout-config", () => {
  it("answers without auth and says not live when Stripe keys are missing", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    const response = await fetch(`${base}/public/checkout-config`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ live: false, applePay: false, googlePay: false, reason: "missing_secret_key" });
  });

  it("is live once both keys are set, and never echoes a key", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_secret_value");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_secret_value");
    vi.stubEnv("APPLE_PAY_ENABLED", "true");
    const response = await fetch(`${base}/public/checkout-config`);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ live: true, mode: "test", applePay: true, googlePay: true, reason: null });
    expect(text).not.toContain("secret_value");
  });
});
