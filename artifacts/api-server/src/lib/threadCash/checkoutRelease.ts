/**
 * Item 109: let go of Thread Cash that an abandoned Stripe payment is holding.
 *
 * When the buyer places an order, their Thread Cash token is reserved to that
 * checkout's Stripe session. If they close Stripe's page without paying, the
 * session stays open (for up to 24h) and keeps the token. Before this, the
 * checkout toggle couldn't be turned off or resized after a cancelled payment,
 * because cancelThreadCashRedemption refuses a reserved token.
 *
 * This expires that session at Stripe, so it can no longer be paid, then
 * releases the token from it. The caller can then cancel the token (the
 * amount goes back to the balance) or apply it to a new checkout.
 *
 * It only acts on the buyer's OWN checkout, and only when Stripe confirms
 * the session is unpaid:
 *  - an open session is expired first. If Stripe refuses (e.g. it was paid
 *    a moment ago), nothing is released;
 *  - an already expired session is released directly;
 *  - a paid or completed session is never touched, since its webhook
 *    consumes the token for the order.
 *  - a reservation still being set up (no Stripe session id yet, or a
 *    `checkout:` reservation id) is left alone. That request is in flight.
 */
import type Stripe from "stripe";
import { and, eq, isNull } from "drizzle-orm";
import { db, checkoutSessions, threadCashEntries } from "@workspace/db";
import { ThreadCashError, releaseThreadCashRedemption } from "./wallet";

type StripeCheckoutLike = { checkout: Pick<Stripe["checkout"], "sessions"> };

export async function releaseThreadCashFromAbandonedCheckout(
  stripeClient: StripeCheckoutLike | null,
  buyerId: string,
  token: string,
): Promise<void> {
  const normalizedToken = String(token ?? "").trim().toUpperCase();
  const [entry] = await db.select({ checkoutSessionId: threadCashEntries.checkoutSessionId })
    .from(threadCashEntries)
    .where(and(
      eq(threadCashEntries.buyerId, buyerId),
      eq(threadCashEntries.source, "redemption"),
      eq(threadCashEntries.referenceId, normalizedToken),
      isNull(threadCashEntries.usedAt),
    ))
    .limit(1);
  const holder = entry?.checkoutSessionId;
  if (!holder) return; // nothing holds it (or it's gone); the caller's cancel decides
  const stillStarting = new ThreadCashError(
    "Your last payment is still being set up. Try again in a moment.",
    409,
    "THREAD_CASH_TOKEN_RESERVED",
  );
  if (holder.startsWith("checkout:")) throw stillStarting;

  const [checkout] = await db.select({ id: checkoutSessions.id, stripeSessionId: checkoutSessions.stripeSessionId })
    .from(checkoutSessions)
    .where(and(eq(checkoutSessions.id, holder), eq(checkoutSessions.buyerId, buyerId)))
    .limit(1);
  if (!checkout) {
    throw new ThreadCashError("This Thread Cash is attached to a checkout that isn't yours.", 409, "THREAD_CASH_TOKEN_RESERVED");
  }
  if (!checkout.stripeSessionId) throw stillStarting;
  if (!stripeClient) {
    throw new ThreadCashError("Payments are unavailable right now. Try again shortly.", 503, "THREAD_CASH_TOKEN_RESERVED");
  }

  let session: Stripe.Checkout.Session;
  try {
    session = await stripeClient.checkout.sessions.retrieve(checkout.stripeSessionId);
  } catch {
    throw new ThreadCashError("We couldn't reach your last payment. Try again shortly.", 503, "THREAD_CASH_TOKEN_RESERVED");
  }
  if (session.payment_status === "paid" || session.status === "complete") {
    throw new ThreadCashError("This Thread Cash was already used on a paid order.", 409, "THREAD_CASH_TOKEN_USED");
  }
  if (session.status === "open") {
    try {
      await stripeClient.checkout.sessions.expire(checkout.stripeSessionId);
    } catch {
      throw new ThreadCashError(
        "Your last payment is still open. Finish or close it, then try again.",
        409,
        "THREAD_CASH_TOKEN_RESERVED",
      );
    }
  }
  // Expired now (or already was): it can never be paid, so the token is free.
  // Loyalty on the same session is released by the checkout.session.expired
  // webhook, as for any expired session.
  await releaseThreadCashRedemption(db, buyerId, normalizedToken, checkout.id);
}
