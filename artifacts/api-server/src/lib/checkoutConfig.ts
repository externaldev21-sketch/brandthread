/**
 * Whether checkout can take real money, from env only (no keys in code).
 * The app asks GET /api/public/checkout-config before it shows Pay, Apple Pay
 * or Google Pay; when this says not live it shows "Checkout isn't live yet"
 * instead, so nothing is ever charged (or faked) without Stripe set up.
 *
 * Live needs:
 *  - STRIPE_SECRET_KEY       the charge itself
 *  - STRIPE_WEBHOOK_SECRET   orders are created by the paid webhook; without
 *                            it a buyer would be charged with no order
 *  - CHECKOUT_ENABLED        kill switch, on unless set to "false"
 * Wallets:
 *  - APPLE_PAY_ENABLED       off until set to "true" — Apple Pay also needs
 *                            the merchant ID (merchant.com.brandthread.mobile)
 *                            set up in Apple Developer and Stripe first
 *  - GOOGLE_PAY_ENABLED      on unless "false"
 */
export type CheckoutConfig = {
  live: boolean;
  mode: "live" | "test" | null;
  applePay: boolean;
  googlePay: boolean;
  reason: "disabled" | "missing_secret_key" | "missing_webhook_secret" | null;
};

type Env = Record<string, string | undefined>;

const on = (value: string | undefined) => (value ?? "").trim().toLowerCase() !== "false";
const optIn = (value: string | undefined) => (value ?? "").trim().toLowerCase() === "true";

export function checkoutConfig(env: Env = process.env): CheckoutConfig {
  const secret = (env.STRIPE_SECRET_KEY ?? "").trim();
  const webhook = (env.STRIPE_WEBHOOK_SECRET ?? "").trim();
  const reason: CheckoutConfig["reason"] = !on(env.CHECKOUT_ENABLED) ? "disabled"
    : !secret ? "missing_secret_key"
      : !webhook ? "missing_webhook_secret"
        : null;
  const live = reason === null;
  return {
    live,
    mode: secret ? (secret.startsWith("sk_live_") || secret.startsWith("rk_live_") ? "live" : "test") : null,
    applePay: live && optIn(env.APPLE_PAY_ENABLED),
    googlePay: live && on(env.GOOGLE_PAY_ENABLED),
    reason,
  };
}
