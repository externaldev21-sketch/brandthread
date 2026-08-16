import Stripe from "stripe";

// Stripe is optional at startup — the server runs without it but Stripe-dependent
// endpoints will return 503 if the key is missing.
const key = process.env.STRIPE_SECRET_KEY;

export const stripe: Stripe | null = key
  ? new Stripe(key, { apiVersion: "2026-07-29.dahlia" })
  : null;

export function requireStripe(): Stripe {
  if (!stripe) {
    throw Object.assign(
      new Error("Stripe is not configured. Set STRIPE_SECRET_KEY."),
      { status: 503 }
    );
  }
  return stripe;
}

export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";
