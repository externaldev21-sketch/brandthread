/**
 * Buying and sending a gift card.
 *
 * Payment is an ordinary Stripe PaymentIntent on Brandthread's balance
 * (metadata.kind = "gift_card_purchase"). No money goes to the seller at
 * purchase: it is held as a gift card liability until the card is redeemed
 * (payout.ts). The code is generated only once payment succeeded, emailed to
 * the recipient, and returned once to the buyer's app (for the share sheet).
 * Only its hash is ever stored.
 */
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db, giftCards, users } from "@workspace/db";
import { logger } from "../logger";
import { ensureStripeCustomer } from "../stripe";
import { escapeHtml, formatCents, renderBrandthreadEmail, sendBrandthreadEmail } from "../brandthreadEmail";
import { activateCard, assertValidAmount, createPendingCard, GiftCardError, type GiftCardRow } from "./service";
import { assertSellable, expiryFromMonths, getGiftCardSettings } from "./settings";

export const GIFT_CARD_PURCHASE_KIND = "gift_card_purchase";

export type PurchaseInput = {
  buyerId: string;
  sellerId: string;
  amountCents: number;
  recipientEmail: string;
  recipientName?: string | null;
  message?: string | null;
  /** Bought for the buyer themself (the card lands in their wallet on purchase). */
  forSelf?: boolean;
  clientIdempotencyKey: string;
};

type StripePurchase = Pick<Stripe, "paymentIntents" | "customers">;

export async function createGiftCardPurchase(stripeClient: StripePurchase, input: PurchaseInput): Promise<{
  giftCardId: string; paymentIntentId: string; clientSecret: string | null; amountCents: number;
}> {
  assertValidAmount(input.amountCents);
  if (input.sellerId === input.buyerId) {
    throw new GiftCardError(400, "OWN_STORE", "Use Issue gift card in your store tools instead.");
  }
  const settings = await getGiftCardSettings(input.sellerId);
  assertSellable(settings, input.amountCents);
  const [seller] = await db.select({ status: users.stripeAccountStatus, accountId: users.stripeAccountId })
    .from(users).where(eq(users.clerkId, input.sellerId)).limit(1);
  if (!seller?.accountId || seller.status !== "active") {
    throw new GiftCardError(400, "SELLER_PAYMENTS_UNAVAILABLE", "This store can't sell gift cards right now.");
  }
  const customer = await ensureStripeCustomer(stripeClient, input.buyerId, undefined);
  const intent = await stripeClient.paymentIntents.create({
    amount: input.amountCents,
    currency: "usd",
    customer,
    payment_method_types: ["card"],
    description: "Brandthread gift card",
    metadata: { kind: GIFT_CARD_PURCHASE_KIND, buyerId: input.buyerId, sellerId: input.sellerId },
  }, { idempotencyKey: `gift-card-pi/${input.buyerId}/${input.clientIdempotencyKey}` });

  // A retried request gets the same intent back; reuse its card instead of making a second.
  const [existing] = await db.select().from(giftCards).where(eq(giftCards.stripePaymentIntentId, intent.id)).limit(1);
  const card = existing ?? await createPendingCard(db, {
    sellerId: input.sellerId,
    amountCents: input.amountCents,
    purchaserId: input.buyerId,
    ownerId: input.forSelf ? input.buyerId : null,
    recipientEmail: input.recipientEmail,
    recipientName: input.recipientName ?? null,
    message: input.message ?? null,
    source: "purchase",
    expiresAt: expiryFromMonths(settings.expiryMonths),
    stripePaymentIntentId: intent.id,
  });
  await db.update(giftCards).set({ stripePaymentIntentId: intent.id }).where(eq(giftCards.id, card.id));
  return { giftCardId: card.id, paymentIntentId: intent.id, clientSecret: intent.client_secret, amountCents: card.initialCents };
}

async function sellerDisplayName(sellerId: string): Promise<string> {
  const [seller] = await db.select({ brandName: users.brandName, displayName: users.displayName, name: users.name })
    .from(users).where(eq(users.clerkId, sellerId)).limit(1);
  return seller?.brandName || seller?.displayName || seller?.name || "a Brandthread store";
}

export async function storeNameFor(sellerId: string): Promise<string> {
  return sellerDisplayName(sellerId);
}

/** Emails the code to the recipient. Returns whether the mail went out. */
export async function deliverGiftCard(card: GiftCardRow, code: string, senderName?: string | null): Promise<boolean> {
  if (!card.recipientEmail) return false;
  const store = await sellerDisplayName(card.sellerId);
  const greeting = card.recipientName ? `Hi ${escapeHtml(card.recipientName)},` : "Hi,";
  const from = senderName ? `${escapeHtml(senderName)} sent you a ${escapeHtml(store)} gift card.` : `You have a ${escapeHtml(store)} gift card.`;
  const html = renderBrandthreadEmail({
    preheader: `${formatCents(card.initialCents)} gift card for ${store}`,
    eyebrow: "Gift card",
    title: `${formatCents(card.initialCents)} gift card`,
    subtitle: `Good at ${store}`,
    bodyHtml: `
      <p style="margin:0 0 14px;">${greeting}</p>
      <p style="margin:0 0 18px;">${from}</p>
      ${card.message ? `<p style="margin:0 0 18px;padding:14px 16px;background:#f5f5f5;border-radius:12px;">${escapeHtml(card.message)}</p>` : ""}
      <p style="margin:0 0 8px;color:#666666;">Your code</p>
      <p style="margin:0 0 18px;font-family:'Courier New',monospace;font-size:26px;font-weight:700;letter-spacing:3px;color:#111111;text-align:center;">${escapeHtml(code)}</p>
      <p style="margin:0;color:#666666;">Add it in the Brandthread app under Menu, Gift cards, or enter it at checkout. It only works at ${escapeHtml(store)}.</p>
    `,
    cta: { label: "Open Brandthread", url: "https://brandthread.app/gift-cards" },
  });
  const ok = await sendBrandthreadEmail({
    to: card.recipientEmail,
    subject: `${formatCents(card.initialCents)} gift card for ${store}`,
    html,
    idempotencyKey: `gift-card-email/${card.id}`,
  });
  if (ok) await db.update(giftCards).set({ deliveredAt: new Date() }).where(eq(giftCards.id, card.id));
  return ok;
}

/**
 * Payment succeeded (webhook or the app's own confirm call, whichever comes
 * first): activate the card once and email the code. Returns the code only to
 * the caller that actually activated it.
 */
export async function completeGiftCardPurchase(cardId: string): Promise<{ card: GiftCardRow; code: string | null; emailed: boolean }> {
  const result = await db.transaction((tx) => activateCard(tx, cardId));
  let emailed = false;
  if (result.code) {
    let sender: string | null = null;
    if (result.card.purchaserId) {
      const [buyer] = await db.select({ displayName: users.displayName, name: users.name }).from(users)
        .where(eq(users.clerkId, result.card.purchaserId)).limit(1);
      sender = buyer?.displayName || buyer?.name || null;
    }
    emailed = await deliverGiftCard(result.card, result.code, sender).catch((err) => {
      logger.error({ err, cardId }, "Gift card email failed");
      return false;
    });
  }
  return { ...result, emailed };
}

/** payment_intent.succeeded for a gift card purchase. */
export async function handleGiftCardPaymentSucceeded(pi: { id: string }): Promise<void> {
  const [card] = await db.select({ id: giftCards.id }).from(giftCards).where(eq(giftCards.stripePaymentIntentId, pi.id)).limit(1);
  if (!card) {
    logger.error({ paymentIntentId: pi.id }, "Gift card payment succeeded without a gift card record");
    return;
  }
  await completeGiftCardPurchase(card.id);
}

/** The buyer's app asks whether payment went through (covers a slow webhook). */
export async function confirmGiftCardPurchase(
  stripeClient: Pick<Stripe, "paymentIntents">,
  buyerId: string,
  cardId: string,
): Promise<{ status: "paid" | "processing" | "unpaid"; card: GiftCardRow; code: string | null }> {
  const [card] = await db.select().from(giftCards).where(eq(giftCards.id, cardId)).limit(1);
  if (!card || card.purchaserId !== buyerId || !card.stripePaymentIntentId) {
    throw new GiftCardError(404, "NOT_FOUND", "Gift card not found.");
  }
  if (card.status !== "pending_payment") return { status: "paid", card, code: null };
  const intent = await stripeClient.paymentIntents.retrieve(card.stripePaymentIntentId);
  if (intent.status === "succeeded") {
    const done = await completeGiftCardPurchase(card.id);
    return { status: "paid", card: done.card, code: done.code };
  }
  return { status: intent.status === "processing" ? "processing" : "unpaid", card, code: null };
}
