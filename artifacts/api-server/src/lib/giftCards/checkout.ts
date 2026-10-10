/**
 * Gift cards at checkout — the small surface the one-page checkout plugs into
 * (routes/checkout-intent.ts, routes/webhooks.ts, lib/money/stockReservation.ts).
 *
 *  price    `applyGiftCardToGroup` decides how much of a card goes on one
 *           seller's group. A card only applies to ITS store's group, never to
 *           shipping-fee-only remainders below the platform fee, so the card
 *           charge always covers Brandthread's and Stripe's fees.
 *  reserve  inside the same transaction that writes the checkout rows
 *           (service.reserveForCheckout: atomic guarded decrement).
 *  settle   `finalizeGiftCardsForGroup` after the paid webhook made the order.
 *  release  service.releaseForCheckout from stockReservation's release, so a
 *           cancel, a failed payment and the expiry sweep all free the card.
 */
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db, giftCards, orders } from "@workspace/db";
import { consumeRateLimitBucket, RATE_LIMIT_POLICIES } from "../../middlewares/rateLimit";
import { logger } from "../logger";
import { payoutSellerForOrder } from "./payout";
import { looksLikeGiftCardCode } from "./codes";
import {
  GiftCardError, assertRedeemableFor, findCardByCode, releaseForCheckout, settleForCheckout, type GiftCardRow,
} from "./service";

export type GiftCardRef = { code?: string; cardId?: string };

export type GiftCardApplication = {
  cardId: string;
  last4: string | null;
  /** Cents of this group's total the card covers. */
  cents: number;
  balanceCents: number;
};

/** Code guesses are limited per person, across lookup, claim and checkout. */
export async function guardCodeLookup(identity: string): Promise<void> {
  const counter = await consumeRateLimitBucket(`gift-card-lookup:${identity}`, RATE_LIMIT_POLICIES["gift-card-lookup"]);
  if (counter.count > RATE_LIMIT_POLICIES["gift-card-lookup"].limit) {
    throw new GiftCardError(429, "RATE_LIMITED", RATE_LIMIT_POLICIES["gift-card-lookup"].message);
  }
}

/** Resolves a code or a wallet card id to a redeemable card for this buyer and store. */
export async function resolveCardForBuyer(buyerId: string, sellerId: string, ref: GiftCardRef): Promise<GiftCardRow> {
  let card: GiftCardRow | null = null;
  if (ref.cardId) {
    const [row] = await db.select().from(giftCards).where(eq(giftCards.id, ref.cardId)).limit(1);
    // A wallet card is spent only by whoever claimed it.
    card = row && row.ownerId === buyerId ? row : null;
  } else if (ref.code) {
    await guardCodeLookup(buyerId);
    if (!looksLikeGiftCardCode(ref.code)) throw new GiftCardError(404, "GIFT_CARD_NOT_FOUND", "We couldn't find that gift card.");
    card = await findCardByCode(db, ref.code);
    if (card?.ownerId && card.ownerId !== buyerId) card = null;
  }
  if (!card) throw new GiftCardError(404, "GIFT_CARD_NOT_FOUND", "We couldn't find that gift card.");
  assertRedeemableFor(card, sellerId);
  return card;
}

/**
 * How much of the card goes on this group. `groupTotalCents` is the group's
 * full total (items + shipping + tax); `feeFloorCents` is what the card
 * payment must still cover (platform fee + processing estimate).
 */
export async function applyGiftCardToGroup(input: {
  buyerId: string; sellerId: string; ref: GiftCardRef; groupTotalCents: number; feeFloorCents: number;
}): Promise<GiftCardApplication> {
  const card = await resolveCardForBuyer(input.buyerId, input.sellerId, input.ref);
  const cap = Math.max(0, input.groupTotalCents - input.feeFloorCents);
  const cents = Math.min(card.balanceCents, cap);
  if (cents <= 0) {
    throw new GiftCardError(400, "GIFT_CARD_NOT_APPLICABLE", "This gift card can't be applied to this order.");
  }
  return { cardId: card.id, last4: card.codeLast4, cents, balanceCents: card.balanceCents };
}

/**
 * Stripe can't charge under 50 cents. If the gift cards would leave the whole
 * cart below that, give back just enough of the last card(s) so the card
 * charge is exactly the minimum.
 */
export function trimGiftCardsForMinimumCharge<T extends { totalCents: number; giftCardCents: number }>(groups: T[], minChargeCents: number): void {
  let charge = groups.reduce((sum, g) => sum + g.totalCents, 0);
  for (let i = groups.length - 1; i >= 0 && charge < minChargeCents; i--) {
    const give = Math.min(groups[i].giftCardCents, minChargeCents - charge);
    if (give <= 0) continue;
    groups[i].giftCardCents -= give;
    groups[i].totalCents += give;
    charge += give;
  }
}

/**
 * The paid webhook created this group's order. Settle the gift card (and pay
 * the seller the purchased-card part once the order's delivery hold allows it;
 * otherwise the money sweep pays it later), or — if the order was already cancelled/refunded for
 * being oversold — give the card its money back instead. Idempotent.
 */
export async function finalizeGiftCardsForGroup(
  stripeClient: Pick<Stripe, "transfers"> | null,
  group: { id: string; stripeSessionId: string | null },
): Promise<void> {
  if (!group.stripeSessionId) return;
  const [order] = await db.select({ id: orders.id, status: orders.status, fundsState: orders.fundsState })
    .from(orders).where(eq(orders.stripeCheckoutSessionId, group.stripeSessionId)).limit(1);
  if (!order) {
    logger.error({ checkoutSessionId: group.id }, "Gift card could not be settled: the order does not exist yet");
    return;
  }
  if (order.status === "cancelled" || order.status === "refund_pending" || order.fundsState === "refunded") {
    await db.transaction((tx) => releaseForCheckout(tx, group.id));
    return;
  }
  const settled = await db.transaction((tx) => settleForCheckout(tx, group.id, order.id));
  if (settled.length > 0) await payoutSellerForOrder(stripeClient, order.id);
}
