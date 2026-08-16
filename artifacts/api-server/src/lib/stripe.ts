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

// ─── Platform revenue commission ──────────────────────────────────────────────
/**
 * Fraction of each sale retained by Brandthread as an application fee on top
 * of standard Stripe processing fees.  Implemented as a Stripe Connect
 * `application_fee_amount` on every destination charge so the amount is
 * withheld automatically before the remainder is transferred to the seller's
 * connected account.
 *
 * Change this number to adjust the platform rate — no other code needs to
 * change.  The value is intentionally a plain constant (not an env var) so
 * that the effective rate is always visible in version control and cannot be
 * silently overridden at runtime.  If you need env-var overrides for staging
 * vs. production, wrap the assignment in:
 *
 *   process.env.PLATFORM_COMMISSION_RATE
 *     ? parseFloat(process.env.PLATFORM_COMMISSION_RATE)
 *     : 0.05
 */
export const PLATFORM_COMMISSION_RATE = 0.05; // 5 %

/**
 * Compute the platform application fee for a given order total.
 *
 * @param subtotalCents  Total charge amount in the smallest currency unit (cents).
 * @returns              Fee amount in cents, rounded to the nearest cent.
 *                       Always ≥ 0; returns 0 for a zero-value subtotal.
 */
export function computeApplicationFeeCents(subtotalCents: number): number {
  if (subtotalCents <= 0) return 0;
  return Math.round(subtotalCents * PLATFORM_COMMISSION_RATE);
}
