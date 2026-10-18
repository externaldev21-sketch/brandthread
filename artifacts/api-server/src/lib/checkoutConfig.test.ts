import { describe, expect, it } from "vitest";
import { checkoutConfig } from "./checkoutConfig";

describe("checkoutConfig", () => {
  it("is not live without a secret key", () => {
    expect(checkoutConfig({})).toEqual({ live: false, mode: null, applePay: false, googlePay: false, reason: "missing_secret_key" });
  });

  it("is not live without the webhook secret (orders come from the webhook)", () => {
    const config = checkoutConfig({ STRIPE_SECRET_KEY: "sk_test_x" });
    expect(config.live).toBe(false);
    expect(config.reason).toBe("missing_webhook_secret");
    expect(config.mode).toBe("test");
  });

  it("is live with both keys; Google Pay on, Apple Pay waits for its merchant ID", () => {
    expect(checkoutConfig({ STRIPE_SECRET_KEY: "sk_live_x", STRIPE_WEBHOOK_SECRET: "whsec_x" }))
      .toEqual({ live: true, mode: "live", applePay: false, googlePay: true, reason: null });
  });

  it("honours the kill switch and wallet flags", () => {
    const keys = { STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_x" };
    expect(checkoutConfig({ ...keys, CHECKOUT_ENABLED: "false", APPLE_PAY_ENABLED: "true" })).toMatchObject({ live: false, reason: "disabled", applePay: false, googlePay: false });
    expect(checkoutConfig({ ...keys, APPLE_PAY_ENABLED: "true" })).toMatchObject({ live: true, applePay: true, googlePay: true });
    expect(checkoutConfig({ ...keys, GOOGLE_PAY_ENABLED: "FALSE" })).toMatchObject({ live: true, applePay: false, googlePay: false });
  });
});
