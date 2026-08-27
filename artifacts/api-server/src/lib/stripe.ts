import Stripe from "stripe";
import { db, users } from "@workspace/db";
import { eq } from "drizzle-orm";

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

/**
 * Find or create the platform Stripe Customer associated with one authenticated
 * Brandthread user. Buyers use this customer for saved payment methods, while
 * sellers also use the same field for platform subscription billing.
 *
 * The row lock keeps two checkout requests for a new user from creating two
 * Stripe Customers at the same time.
 */
export async function ensureStripeCustomer(
  stripeClient: Pick<Stripe, "customers">,
  clerkUserId: string,
  preferredEmail?: string,
): Promise<string> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({
        stripeCustomerId: users.stripeCustomerId,
        email: users.email,
        name: users.name,
      })
      .from(users)
      .where(eq(users.clerkId, clerkUserId))
      .for("update")
      .limit(1);

    if (!user) {
      throw Object.assign(new Error("User not found"), { status: 404 });
    }
    if (user.stripeCustomerId) {
      if (preferredEmail) {
        await stripeClient.customers.update(user.stripeCustomerId, {
          email: preferredEmail,
        });
      }
      return user.stripeCustomerId;
    }

    const customer = await stripeClient.customers.create({
      email: preferredEmail ?? user.email,
      name: user.name,
      metadata: { clerkUserId },
    });

    await tx
      .update(users)
      .set({ stripeCustomerId: customer.id, updatedAt: new Date() })
      .where(eq(users.clerkId, clerkUserId));

    return customer.id;
  });
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

// ─── Stripe decline-code → buyer-friendly message ────────────────────────────

/**
 * Maps a Stripe error object (from a StripeCardError or last_payment_error)
 * to a plain-language message suitable for display to a buyer.
 *
 * Stripe's `decline_code` is the most specific signal.  When absent, we fall
 * back to `code` (e.g. "card_declined"), then a safe generic message.
 * Raw Stripe strings are NEVER returned — callers can safely display the result.
 */
export function mapStripeError(err: {
  decline_code?: string | null;
  code?: string | null;
  type?: string;
}): string {
  const key = (err.decline_code ?? err.code ?? '').toLowerCase();

  switch (key) {
    case 'insufficient_funds':
      return "Your card has insufficient funds — please try a different card or top up your balance.";
    case 'card_declined':
    case 'generic_decline':
      return "Your card was declined — please try a different card or contact your card issuer.";
    case 'expired_card':
      return "Your card has expired — please update your card details or use a different card.";
    case 'incorrect_cvc':
      return "Your card's security code (CVC) is incorrect — please check and try again.";
    case 'incorrect_number':
    case 'invalid_number':
      return "Your card number is incorrect — please check and try again.";
    case 'incorrect_zip':
    case 'invalid_zip':
      return "Your billing postal code didn't match — please check your card details.";
    case 'processing_error':
      return "A processing error occurred — please try again in a moment.";
    case 'do_not_honor':
    case 'do_not_try_again':
      return "Your card issuer declined this transaction — please contact them or use a different card.";
    case 'fraudulent':
    case 'lost_card':
    case 'stolen_card':
    case 'pickup_card':
      return "Your card was declined — please contact your card issuer or use a different card.";
    case 'card_velocity_exceeded':
      return "Too many attempts on this card — please wait a moment or use a different card.";
    case 'currency_not_supported':
      return "Your card doesn't support USD payments — please try a different card.";
    case 'duplicate_transaction':
      return "A duplicate payment was detected — please check your Orders before trying again.";
    case 'card_not_supported':
      return "This card type is not supported — please try a different card.";
    case 'authentication_required':
      return "Your bank requires additional verification — please retry and approve the payment in your banking app.";
    case 'refer_to_customer':
      return "Your card was declined — please contact your card issuer for details.";
    case 'stop_payment_order':
      return "Your bank has placed a stop on this payment — please contact your card issuer.";
    case 'testmode_decline':
      return "Test card declined — use a Stripe test card number such as 4242 4242 4242 4242.";
    default:
      return "Your payment was declined — please try a different card or contact your card issuer.";
  }
}
