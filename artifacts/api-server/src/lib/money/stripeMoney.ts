/**
 * Thin, typed helpers around the Stripe calls the money services make.
 * Everything that talks to Stripe for orders goes through these so tests can
 * reason about one small surface.
 */
import type Stripe from "stripe";

export type ChargeDetails = {
  chargeId: string | null;
  /** Stripe's real processing fee, or null when not yet known. */
  processingFeeCents: number | null;
  /** Destination charges only: the automatic transfer to the seller. */
  transferId: string | null;
  /** Destination charges only: the application fee object. */
  applicationFeeId: string | null;
};

function idOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") {
    return (value as { id: string }).id;
  }
  return null;
}

/**
 * Reads the charge behind a PaymentIntent, including the exact Stripe fee
 * from its balance transaction. Throws when Stripe is unreachable so the
 * webhook fails and Stripe retries (never records a guessed charge id).
 */
export async function fetchChargeDetails(
  stripe: Pick<Stripe, "paymentIntents">,
  paymentIntentId: string,
): Promise<ChargeDetails> {
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: ["latest_charge.balance_transaction"],
  });
  const charge = intent.latest_charge as Stripe.Charge | string | null;
  if (!charge || typeof charge === "string") {
    return { chargeId: idOf(charge), processingFeeCents: null, transferId: null, applicationFeeId: null };
  }
  const balanceTransaction = charge.balance_transaction as Stripe.BalanceTransaction | string | null;
  const fee = balanceTransaction && typeof balanceTransaction === "object"
    && Number.isSafeInteger(balanceTransaction.fee) && balanceTransaction.fee >= 0
    ? balanceTransaction.fee
    : null;
  return {
    chargeId: charge.id,
    processingFeeCents: fee,
    transferId: idOf(charge.transfer),
    applicationFeeId: idOf(charge.application_fee),
  };
}

/**
 * A 4xx answer (other than 409 conflict / 429 rate limit) means Stripe
 * rejected the request before doing anything, so it is safe to record a
 * failure and retry later with a NEW idempotency key. Anything else (network
 * error, 5xx, timeout) is ambiguous: the request may have succeeded, so it
 * must be retried with the SAME key.
 */
export function isDefinitiveStripeRejection(error: unknown): boolean {
  const e = error as { statusCode?: number; status?: number; type?: string } | null;
  const status = e?.statusCode ?? e?.status;
  if (typeof status === "number") return status >= 400 && status < 500 && status !== 409 && status !== 429;
  return e?.type === "StripeInvalidRequestError" || e?.type === "StripeCardError";
}

export function stripeErrorCode(error: unknown): string {
  const e = error as { code?: unknown; raw?: { code?: unknown } } | null;
  const code = typeof e?.code === "string" ? e.code : typeof e?.raw?.code === "string" ? e.raw.code : null;
  return (code ?? "stripe_error").slice(0, 80);
}

export function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 300);
}
