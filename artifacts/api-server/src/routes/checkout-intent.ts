/**
 * One-page checkout: ONE PaymentIntent for the whole cart, confirmed in the
 * app with Stripe's own card fields, Apple Pay or Google Pay. 3DS is handled
 * by the Stripe SDK.
 *
 * Two mounts, one implementation (createCheckoutIntentRouter):
 *  - /api/buyer/checkout/payment-intent   signed in (Clerk, requireAuth);
 *  - /api/guest/checkout/payment-intent   guests (BT-257): no account. The
 *    guest is identified by the contact email, and gets back an opaque
 *    guestAccessToken (the same HMAC capability as hosted guest checkout,
 *    routes/guest-checkout.ts; only its SHA-256 is stored) that status and
 *    cancel require. Rate limited by the app-wide checkout policy, like
 *    every /guest/checkout path (middlewares/rateLimit.ts).
 *
 * POST /quote      prices the cart for an address (shipping, promo, rewards,
 *                  Stripe Tax) without reserving anything, so the page and
 *                  the Apple Pay / Google Pay sheet show the real total.
 * POST /           prices every seller group (lib/money/cartCheckout.ts),
 *                  applies loyalty / Thread Cash (lib/money/cartRewards.ts),
 *                  reserves stock atomically, persists one checkout row per
 *                  seller, creates the PaymentIntent. Returns its client
 *                  secret and the server's breakdown.
 * GET  /:id        (signed in) payment status + the orders it produced.
 * POST /:id/status (guest, with guestAccessToken) the same.
 * POST /:id/cancel the buyer backed out after Pay: cancels the intent and
 *                  gives the stock and reward tokens back.
 *
 * Money: separate charges and transfers. The charge lands on Brandthread's
 * balance; each seller's order is paid out by its own transfer right after
 * the webhook creates it (lib/money/cartTransfers.ts). A preorder group
 * (BT-258) is "held" instead: paid out per order when it ships
 * (lib/money/escrow.ts), exactly like a hosted preorder.
 *
 * Idempotency: the client key identifies one pay attempt. A retry with the
 * same key returns the same PaymentIntent, and Stripe is also called with
 * idempotency keys.
 *
 * PCI SAQ-A: no card data is ever accepted here (rejectCardData below).
 */
import crypto from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { and, eq, inArray, isNull, like } from "drizzle-orm";
import { db, checkoutSessions, orders, stockReservations } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { ensureStripeCustomer, requireStripe } from "../lib/stripe";
import { logger } from "../lib/logger";
import { z } from "@workspace/api-zod";
import { requestPrimitives, validateRequest } from "../middlewares/validateRequest";
import {
  CART_CHECKOUT_KIND, CartCheckoutError, MAX_CART_GROUPS, MIN_CARD_CHARGE_CENTS,
  calculateGroupTax, findCardDataInRequest, priceCartGroup, type CartShipping, type PricedGroup,
} from "../lib/money/cartCheckout";
import { destinationApplicationFeeCents } from "../lib/money/fees";
import { paymentIntentMethodParams, paymentMethodTypesFor } from "../lib/payments/bnpl";
import { bnplMethodsForCart } from "../lib/payments/sellerPaymentSettings";
import { StockReservationError, releaseStockReservation, reserveStock } from "../lib/money/stockReservation";
import { applyGiftCardToGroup, trimGiftCardsForMinimumCharge } from "../lib/giftCards/checkout";
import { GiftCardError, claimCard, giftCentsForCheckouts, reserveForCheckout } from "../lib/giftCards/service";
import {
  ThreadCashError, bindThreadCashRedemptionToCheckout, isFeatureEnabled, peekThreadCashRedemption,
  releaseThreadCashRedemption, reserveThreadCashRedemption, splitThreadCashRedemption,
} from "../lib/threadCash/wallet";
import {
  LoyaltyRedemptionError, bindLoyaltyRedemptionToCheckout, releaseLoyaltyRedemption, reserveLoyaltyRedemption,
} from "./loyalty";
import { peekLoyaltyRedemption, planCartRewards, releaseCartRewards, type CartRewardPlan } from "../lib/money/cartRewards";
import { guestAccessToken, tokenHash } from "./guest-checkout";

/** Refuses any request that carries card data, before auth, parsing or logging touch it. */
export function rejectCardData(req: Request, res: Response, next: NextFunction): void {
  const hit = findCardDataInRequest(req.body);
  if (hit) {
    // Log only the path, never the value.
    logger.warn({ path: req.path, field: hit }, "Rejected a checkout request carrying card data");
    res.status(400).json({
      error: "Card details must be entered in the secure payment field, not sent to Brandthread.",
      code: "CARD_DATA_REJECTED",
    });
    return;
  }
  next();
}

const itemSchema = z.object({
  variantId: requestPrimitives.uuid,
  productId: requestPrimitives.uuid,
  quantity: z.coerce.number().int().min(1).max(100),
});
const addressSchema = z.object({
  recipientName: requestPrimitives.shortText,
  street: requestPrimitives.shortText,
  line2: z.string().trim().max(160).nullable().optional(),
  city: requestPrimitives.shortText,
  state: requestPrimitives.shortText,
  postalCode: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9 -]{1,15}$/),
  country: z.string().trim().length(2).default("US"),
});
const groupsSchema = z.array(z.object({
  items: z.array(itemSchema).min(1).max(100),
  discountCode: z.string().trim().min(1).max(64).optional(),
  liveStreamId: z.string().uuid().nullable().optional(),
  /** A store gift card for this seller's group: a code, or the id of a card in the buyer's wallet. */
  giftCard: z.object({
    code: z.string().trim().min(4).max(64).optional(),
    cardId: z.string().uuid().optional(),
  }).refine((ref) => Boolean(ref.code) !== Boolean(ref.cardId)).optional(),
})).min(1).max(MAX_CART_GROUPS);
/** Loyalty / Thread Cash redemption tokens (signed-in buyers only; from /loyalty/redeem and /thread-cash/redeem). */
const rewardTokens = {
  loyaltyToken: z.string().trim().min(4).max(160).optional(),
  threadCashToken: z.string().trim().min(4).max(160).optional(),
};
/** A quote only needs where the order goes (a wallet sheet shares no street until the buyer pays). */
const quoteSchema = z.object({
  groups: groupsSchema,
  shippingAddress: z.object({
    street: z.string().trim().max(160).optional(),
    line2: z.string().trim().max(160).nullable().optional(),
    city: z.string().trim().max(160).optional(),
    state: z.string().trim().max(160).optional(),
    postalCode: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9 -]{1,15}$/),
    country: z.string().trim().length(2).default("US"),
  }),
  ...rewardTokens,
});
const createSchema = z.object({
  groups: groupsSchema,
  contactEmail: requestPrimitives.email,
  contactPhone: z.string().trim().regex(/^[0-9+(). -]{7,32}$/),
  shippingAddress: addressSchema,
  clientIdempotencyKey: z.string().trim().min(8).max(120),
  /** Keep the card on the buyer's Stripe customer for next time (the hosted flow always did). Ignored for guests. */
  saveCard: z.boolean().optional(),
  ...rewardTokens,
});
const guestTokenSchema = z.object({ guestAccessToken: z.string().min(32).max(512) });

type GroupBreakdown = {
  sellerId: string;
  checkoutSessionId: string;
  subtotalCents: number;
  shippingCents: number;
  discountCents: number;
  /** Loyalty points on this group. */
  loyaltyCents: number;
  /** Thread Cash on this group (its share of the buyer's Thread Cash). */
  threadCashCents: number;
  taxCents: number;
  /** Covered by a store gift card; totalCents is what is left for the card payment. */
  giftCardCents: number;
  totalCents: number;
  processingDays: number | null;
};

function breakdownFromRows(rows: Array<typeof checkoutSessions.$inferSelect>, gift: Map<string, number> = new Map()): GroupBreakdown[] {
  return rows.map((row) => {
    const subtotal = (row.items ?? []).reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
    return {
      sellerId: row.sellerId,
      checkoutSessionId: row.id,
      subtotalCents: subtotal,
      shippingCents: row.shippingCents ?? 0,
      discountCents: row.discountCodeAmountCents ?? 0,
      loyaltyCents: row.loyaltyDiscountCents ?? 0,
      threadCashCents: row.threadCashDiscountCents ?? 0,
      taxCents: row.taxCents ?? 0,
      giftCardCents: gift.get(row.id) ?? 0,
      totalCents: row.amountTotalCents ?? 0,
      processingDays: null,
    };
  });
}

type PricedCartGroup = PricedGroup & {
  taxCents: number; calculationId: string | null; totalCents: number;
  giftCardId: string | null; giftCardCents: number;
  loyaltyCents: number; threadCashCents: number;
};

/** Who is paying: a signed-in buyer, or a guest known only by email. */
type Payer = { buyerId: string; guestEmail: null } | { buyerId: null; guestEmail: string | null };

function customerKeyOf(payer: Payer): string {
  return payer.buyerId ?? `guest:${payer.guestEmail ?? ""}`;
}

/** Prices every seller group (promo, shipping), before rewards and tax. Throws CartCheckoutError. */
async function priceGroups(
  payer: Payer,
  groups: z.infer<typeof groupsSchema>,
  shipping: CartShipping,
): Promise<PricedGroup[]> {
  const priced: PricedGroup[] = [];
  const sellers = new Set<string>();
  for (const group of groups) {
    const pricedGroup = await priceCartGroup({
      buyerId: payer.buyerId, customerKey: customerKeyOf(payer), items: group.items,
      discountCode: group.discountCode ?? null, liveStreamId: group.liveStreamId ?? null, shipping,
    });
    if (sellers.has(pricedGroup.sellerId)) {
      throw new CartCheckoutError(400, "DUPLICATE_SELLER_GROUP", "Each seller's items must be in one group.");
    }
    sellers.add(pricedGroup.sellerId);
    if (group.giftCard && !payer.buyerId) {
      throw new CartCheckoutError(400, "GIFT_CARD_NEEDS_ACCOUNT", "Sign in to use a store gift card.");
    }
    if (group.giftCard && pricedGroup.chargePlan.chargeModel === "held") {
      throw new CartCheckoutError(400, "GIFT_CARD_NOT_FOR_PREORDER", "Store gift cards can't be used on preorders.");
    }
    priced.push(pricedGroup);
  }
  return priced;
}

/** Applies the reward plan, then Stripe Tax, then gift cards. Throws CartCheckoutError / GiftCardError. */
async function finishPricing(
  stripe: ReturnType<typeof requireStripe>,
  payer: Payer,
  groups: z.infer<typeof groupsSchema>,
  priced: PricedGroup[],
  plan: CartRewardPlan,
  shipping: CartShipping,
): Promise<PricedCartGroup[]> {
  const result: PricedCartGroup[] = [];
  for (let index = 0; index < priced.length; index++) {
    let group = priced[index];
    const loyaltyCents = plan.loyaltyCents[index] ?? 0;
    const threadCashCents = plan.threadCashCents[index] ?? 0;
    if (loyaltyCents > 0) {
      // Loyalty is seller-funded, so it lowers the fee basis like a promo
      // code (routes/buyer.ts `combinedDiscountCents`). Thread Cash never does.
      const fee = destinationApplicationFeeCents({
        merchandiseCents: Math.max(0, group.subtotalCents - group.discountCents - loyaltyCents),
        preTaxTotalCents: Math.max(0, group.subtotalCents + group.shippingCents - group.discountCents - loyaltyCents),
        platformFeeBps: group.platformFeeBps,
      });
      group = { ...group, platformFeeCents: fee.platformFeeCents, processingFeeEstimateCents: fee.processingFeeEstimateCents };
    }
    const tax = await calculateGroupTax(stripe, group, shipping, loyaltyCents + threadCashCents);
    const fullTotalCents = group.subtotalCents + group.shippingCents - group.discountCents - loyaltyCents - threadCashCents + tax.taxCents;
    const giftRef = groups[index]?.giftCard;
    // A store gift card covers part of THIS seller's group only.
    const gift = giftRef && payer.buyerId
      ? await applyGiftCardToGroup({
        buyerId: payer.buyerId, sellerId: group.sellerId, ref: giftRef, groupTotalCents: fullTotalCents,
        feeFloorCents: group.platformFeeCents + group.processingFeeEstimateCents,
      })
      : null;
    result.push({
      ...group,
      taxCents: tax.taxCents,
      calculationId: tax.calculationId,
      giftCardId: gift?.cardId ?? null,
      giftCardCents: gift?.cents ?? 0,
      totalCents: fullTotalCents - (gift?.cents ?? 0),
      loyaltyCents,
      threadCashCents,
    });
  }
  trimGiftCardsForMinimumCharge(result, MIN_CARD_CHARGE_CENTS);
  return result;
}

function breakdown(priced: PricedCartGroup[], rows?: Array<{ id: string }>): GroupBreakdown[] {
  return priced.map((group, index) => ({
    sellerId: group.sellerId,
    checkoutSessionId: rows?.[index]?.id ?? "",
    subtotalCents: group.subtotalCents,
    shippingCents: group.shippingCents,
    discountCents: group.discountCents,
    loyaltyCents: group.loyaltyCents,
    threadCashCents: group.threadCashCents,
    taxCents: group.taxCents,
    giftCardCents: group.giftCardCents,
    totalCents: group.totalCents,
    processingDays: group.processingDays,
  }));
}

function stripeFor(res: Response): ReturnType<typeof requireStripe> | null {
  try {
    return requireStripe();
  } catch {
    res.status(503).json({ error: "Payments are unavailable right now.", code: "STRIPE_NOT_CONFIGURED" });
    return null;
  }
}

function sendError(res: Response, error: unknown): boolean {
  if (error instanceof GiftCardError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return true;
  }
  if (error instanceof CartCheckoutError) {
    res.status(error.status).json({ error: error.message, code: error.code, ...error.details });
    return true;
  }
  if (error instanceof StockReservationError) {
    res.status(409).json({ error: error.message, code: "OUT_OF_STOCK", variantId: error.variantId });
    return true;
  }
  if (error instanceof ThreadCashError || error instanceof LoyaltyRedemptionError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return true;
  }
  return false;
}

/**
 * Refuses reward tokens a payer can't use: guests have no wallet, and Thread
 * Cash at checkout is behind the threadCashCheckoutDiscount flag (Dev's
 * sign-off), exactly as on the hosted flow.
 */
async function rewardGate(payer: Payer, body: { loyaltyToken?: string; threadCashToken?: string }): Promise<CartCheckoutError | null> {
  if (!payer.buyerId && (body.loyaltyToken || body.threadCashToken)) {
    return new CartCheckoutError(400, "REWARDS_NEED_ACCOUNT", "Sign in to use rewards or Thread Cash.");
  }
  if (body.threadCashToken && !(await isFeatureEnabled("threadCashCheckoutDiscount"))) {
    return new CartCheckoutError(403, "THREAD_CASH_CHECKOUT_DISABLED", "Using Thread Cash at checkout isn't available yet.");
  }
  return null;
}

/** A reward token held for this pay attempt; reservationId moves to the row id once bound. */
type HeldReward = { kind: "loyalty" | "thread_cash"; token: string; reservationId: string; groupIndex: number };

async function releaseHeld(buyerId: string, held: HeldReward[]): Promise<void> {
  for (const reward of held) {
    try {
      if (reward.kind === "loyalty") {
        await db.transaction((tx) => releaseLoyaltyRedemption(tx, buyerId, reward.token, reward.reservationId));
      } else {
        await releaseThreadCashRedemption(db, buyerId, reward.token, reward.reservationId);
      }
    } catch (error) {
      logger.error({ err: error }, "Could not release a reward token from an unfinished checkout");
    }
  }
}

/**
 * Reserves the buyer's loyalty and Thread Cash tokens for this pay attempt
 * and plans where each cent goes. A multi-store Thread Cash token is split
 * into one child token per store first. Releases everything it took if any
 * step fails.
 */
async function reserveRewards(
  buyerId: string,
  priced: PricedGroup[],
  body: { loyaltyToken?: string; threadCashToken?: string },
): Promise<{ plan: CartRewardPlan; held: HeldReward[] }> {
  const held: HeldReward[] = [];
  try {
    let loyaltyCents = 0;
    if (body.loyaltyToken) {
      if (priced.length !== 1) {
        throw new CartCheckoutError(400, "LOYALTY_ONE_STORE", "Rewards points work on one store's order at a time. Check out this store on its own.");
      }
      const reservationId = `checkout:${crypto.randomUUID()}`;
      const reserved = await reserveLoyaltyRedemption(
        buyerId, body.loyaltyToken, reservationId, priced[0].subtotalCents + priced[0].shippingCents,
      );
      held.push({ kind: "loyalty", token: reserved.token, reservationId, groupIndex: 0 });
      loyaltyCents = reserved.discountCents;
    }
    let threadCashCents = 0;
    let alreadySplit = false;
    if (body.threadCashToken) {
      const peeked = await peekThreadCashRedemption(buyerId, body.threadCashToken);
      threadCashCents = peeked.discountCents;
      alreadySplit = peeked.split;
    }
    const plan = planCartRewards(priced, { loyaltyCents, threadCashCents });
    if (body.threadCashToken && threadCashCents > 0) {
      const parent = body.threadCashToken.trim().toUpperCase();
      const shares = plan.threadCashCents
        .map((cents, groupIndex) => ({ cents, groupIndex }))
        .filter((share) => share.cents > 0);
      // A token split by an earlier multi-store attempt is re-split, even into one store.
      const tokens = shares.length > 1 || alreadySplit
        ? await splitThreadCashRedemption(buyerId, parent, shares.map((share) => share.cents))
        : [parent];
      for (let i = 0; i < shares.length; i++) {
        const group = priced[shares[i].groupIndex];
        const reservationId = `checkout:${crypto.randomUUID()}`;
        const remaining = group.subtotalCents + group.shippingCents - group.discountCents - (plan.loyaltyCents[shares[i].groupIndex] ?? 0);
        await reserveThreadCashRedemption(buyerId, tokens[i], reservationId, remaining, MIN_CARD_CHARGE_CENTS);
        held.push({ kind: "thread_cash", token: tokens[i], reservationId, groupIndex: shares[i].groupIndex });
      }
    }
    return { plan, held };
  } catch (error) {
    await releaseHeld(buyerId, held);
    throw error;
  }
}

async function quoteRewards(buyerId: string | null, priced: PricedGroup[], body: { loyaltyToken?: string; threadCashToken?: string }): Promise<CartRewardPlan> {
  if (!buyerId) return planCartRewards(priced, {});
  const loyaltyCents = body.loyaltyToken ? await peekLoyaltyRedemption(buyerId, body.loyaltyToken) : 0;
  const threadCashCents = body.threadCashToken ? (await peekThreadCashRedemption(buyerId, body.threadCashToken)).discountCents : 0;
  return planCartRewards(priced, { loyaltyCents, threadCashCents });
}

export type CheckoutIntentMode = "buyer" | "guest";

export function createCheckoutIntentRouter(mode: CheckoutIntentMode): Router {
  const router = Router();
  router.use(rejectCardData);
  if (mode === "buyer") router.use(requireAuth);

  const payerFor = (req: Request, email?: string | null): Payer => (mode === "buyer"
    ? { buyerId: (req as any).clerkUserId as string, guestEmail: null }
    : { buyerId: null, guestEmail: email ? email.trim().toLowerCase() : null });

  router.post("/quote", validateRequest({ body: quoteSchema }), async (req, res) => {
    const body = req.body as z.infer<typeof quoteSchema>;
    const payer = payerFor(req);
    const stripe = stripeFor(res);
    if (!stripe) return;
    const address = body.shippingAddress;
    const shipping: CartShipping = {
      name: "",
      street: address.street ?? "",
      line2: address.line2 ?? null,
      city: address.city ?? "",
      state: address.state ?? "",
      zip: address.postalCode.toUpperCase(),
      country: address.country.toUpperCase(),
      phone: "",
    };
    try {
      const gate = await rewardGate(payer, body);
      if (gate) throw gate;
      const groups = await priceGroups(payer, body.groups, shipping);
      const plan = await quoteRewards(payer.buyerId, groups, body);
      const priced = await finishPricing(stripe, payer, body.groups, groups, plan, shipping);
      const amountCents = priced.reduce((sum, group) => sum + group.totalCents, 0);
      const bnpl = await bnplMethodsForCart({ sellerIds: priced.map((g) => g.sellerId), amountCents, shipToCountry: shipping.country });
      res.json({
        amountCents,
        groups: breakdown(priced),
        paymentMethodTypes: paymentMethodTypesFor(bnpl),
      });
    } catch (error) {
      if (sendError(res, error)) return;
      throw error;
    }
  });

  router.post("/", validateRequest({ body: createSchema }), async (req, res) => {
    const body = req.body as z.infer<typeof createSchema>;
    const payer = payerFor(req, body.contactEmail);
    const key = body.clientIdempotencyKey;
    const stripe = stripeFor(res);
    if (!stripe) return;

    // ── Retried pay attempt: hand back the same intent ──────────────────────
    const likeKey = key.replace(/[\\%_]/g, (ch) => `\\${ch}`);
    const prior = await db.select().from(checkoutSessions).where(and(
      payer.buyerId
        ? eq(checkoutSessions.buyerId, payer.buyerId)
        : and(isNull(checkoutSessions.buyerId), eq(checkoutSessions.guestEmail, payer.guestEmail ?? "")),
      like(checkoutSessions.clientIdempotencyKey, `${likeKey}\\_%`),
    ));
    if (prior.length > 0) {
      let priorGuestToken: string | null = null;
      if (!payer.buyerId) {
        // Only the guest who started it (the token derives from one of its rows) gets it back.
        try {
          priorGuestToken = prior.map((row) => guestAccessToken(row.id))
            .find((token, index) => tokenHash(token) === prior[index].guestAccessTokenHash) ?? null;
        } catch {
          priorGuestToken = null;
        }
        if (!priorGuestToken) {
          res.status(409).json({ error: "Checkout idempotency key cannot be reused", code: "IDEMPOTENCY_KEY_REUSED" });
          return;
        }
      }
      const intentId = prior[0].stripePaymentIntentId;
      if (!intentId) {
        res.status(409).json({ error: "Your payment is still being set up. Try again in a moment.", code: "PAYMENT_PENDING" });
        return;
      }
      const intent = await stripe.paymentIntents.retrieve(intentId);
      if (intent.status === "canceled") {
        res.status(410).json({ error: "This payment attempt was closed. Tap Pay again to start a new one.", code: "PAYMENT_CANCELED" });
        return;
      }
      res.json({
        paymentIntentId: intent.id,
        clientSecret: intent.client_secret,
        status: intent.status,
        amountCents: intent.amount,
        groups: breakdownFromRows(prior, await giftCentsForCheckouts(db, prior.map((row) => row.id))),
        ...(priorGuestToken ? { guestAccessToken: priorGuestToken } : {}),
      });
      return;
    }

    // A guest's capability for this cart (status / cancel), keyed on its first row.
    const firstRowId = crypto.randomUUID();
    let guestToken: string | null = null;
    if (!payer.buyerId) {
      try {
        guestToken = guestAccessToken(firstRowId);
      } catch {
        res.status(503).json({ error: "Guest checkout is temporarily unavailable", code: "GUEST_CHECKOUT_UNAVAILABLE" });
        return;
      }
    }

    const shipping: CartShipping = {
      name: body.shippingAddress.recipientName,
      street: body.shippingAddress.street,
      line2: body.shippingAddress.line2 ?? null,
      city: body.shippingAddress.city,
      state: body.shippingAddress.state,
      zip: body.shippingAddress.postalCode.toUpperCase(),
      country: body.shippingAddress.country.toUpperCase(),
      phone: body.contactPhone,
    };

    // ── Price every seller group, its rewards and its tax ───────────────────
    let priced: PricedCartGroup[];
    let held: HeldReward[] = [];
    try {
      const gate = await rewardGate(payer, body);
      if (gate) throw gate;
      const groups = await priceGroups(payer, body.groups, shipping);
      let plan: CartRewardPlan = planCartRewards(groups, {});
      if (payer.buyerId && (body.loyaltyToken || body.threadCashToken)) {
        ({ plan, held } = await reserveRewards(payer.buyerId, groups, body));
      }
      priced = await finishPricing(stripe, payer, body.groups, groups, plan, shipping);
    } catch (error) {
      if (payer.buyerId) await releaseHeld(payer.buyerId, held);
      if (sendError(res, error)) return;
      throw error;
    }
    const amountCents = priced.reduce((sum, group) => sum + group.totalCents, 0);
    if (amountCents < MIN_CARD_CHARGE_CENTS) {
      if (payer.buyerId) await releaseHeld(payer.buyerId, held);
      res.status(400).json({ error: "The order total must be at least $0.50.", code: "BELOW_MINIMUM" });
      return;
    }
    const tokenOf = (kind: HeldReward["kind"], index: number) => held.find((reward) => reward.kind === kind && reward.groupIndex === index);

    // ── Persist the groups and reserve their stock, all or nothing ─────────
    let rows: Array<typeof checkoutSessions.$inferSelect> = [];
    try {
      rows = await db.transaction(async (tx) => {
        const inserted: Array<typeof checkoutSessions.$inferSelect> = [];
        for (let index = 0; index < priced.length; index++) {
          const group = priced[index];
          const loyalty = tokenOf("loyalty", index);
          const threadCash = tokenOf("thread_cash", index);
          const isPreorder = group.chargePlan.chargeModel === "held";
          const [row] = await tx.insert(checkoutSessions).values({
            ...(index === 0 ? { id: firstRowId } : {}),
            buyerId: payer.buyerId,
            ...(payer.buyerId ? {} : { guestEmail: payer.guestEmail, guestAccessTokenHash: tokenHash(guestToken!) }),
            sellerId: group.sellerId,
            items: group.items.map(({ variantId, productName, variantLabel, quantity, priceCents }) => ({
              variantId, productName, variantLabel, quantity, priceCents,
            })),
            shippingAddress: {
              name: shipping.name, street: shipping.street, line2: shipping.line2,
              city: shipping.city, state: shipping.state, zip: shipping.zip, country: shipping.country,
            },
            clientIdempotencyKey: `${key}_${group.sellerId}`,
            // A preorder stays held until it ships (BT-258); everything else is a transfer order.
            chargeModel: isPreorder ? "held" : "transfer",
            dropId: isPreorder ? group.chargePlan.dropId : null,
            platformFeeCents: group.platformFeeCents,
            platformFeeBps: group.platformFeeBps,
            processingFeeEstimateCents: group.processingFeeEstimateCents,
            ...(group.discountCodeId ? { discountCodeId: group.discountCodeId, discountCodeAmountCents: group.discountCents } : {}),
            ...(loyalty && group.loyaltyCents > 0 ? { loyaltyToken: loyalty.token, loyaltyDiscountCents: group.loyaltyCents } : {}),
            ...(threadCash && group.threadCashCents > 0 ? { threadCashToken: threadCash.token, threadCashDiscountCents: group.threadCashCents } : {}),
            amountTotalCents: group.totalCents,
            shippingCents: group.shippingCents,
            taxCents: group.taxCents,
            stripeTaxCalculationId: group.calculationId,
          }).returning();
          await reserveStock(tx, row.id, group.items.map((item) => ({
            variantId: item.variantId, quantity: item.quantity, productName: item.productName,
          })));
          if (group.giftCardId && group.giftCardCents > 0 && payer.buyerId) {
            // Claims an unclaimed card for this buyer, then atomically takes the amount off it.
            await claimCard(tx, group.giftCardId, payer.buyerId);
            await reserveForCheckout(tx, {
              cardId: group.giftCardId, checkoutSessionId: row.id, amountCents: group.giftCardCents,
              actorId: payer.buyerId, sellerId: group.sellerId,
            });
          }
          inserted.push(row);
        }
        return inserted;
      });
    } catch (error: any) {
      if (payer.buyerId) await releaseHeld(payer.buyerId, held);
      if (sendError(res, error)) return;
      if (error?.code === "23505" || error?.cause?.code === "23505") {
        res.status(409).json({ error: "Your payment is already being set up. Try again in a moment.", code: "PAYMENT_PENDING" });
        return;
      }
      throw error;
    }

    const releaseAll = async () => {
      await db.transaction(async (tx) => {
        for (const row of rows) {
          await releaseStockReservation(tx, row.id);
          await tx.delete(checkoutSessions).where(eq(checkoutSessions.id, row.id));
        }
      });
    };

    // ── Move the reward reservations onto the durable rows ─────────────────
    if (payer.buyerId && held.length > 0) {
      try {
        for (const reward of held) {
          const rowId = rows[reward.groupIndex].id;
          if (reward.kind === "loyalty") await bindLoyaltyRedemptionToCheckout(payer.buyerId, reward.token, reward.reservationId, rowId);
          else await bindThreadCashRedemptionToCheckout(payer.buyerId, reward.token, reward.reservationId, rowId);
          reward.reservationId = rowId;
        }
      } catch (error) {
        await releaseHeld(payer.buyerId, held);
        await releaseAll().catch((err) => logger.error({ err }, "Could not undo a checkout whose rewards could not be attached"));
        if (sendError(res, error)) return;
        throw error;
      }
    }

    // ── One PaymentIntent for the cart ──────────────────────────────────────
    let intent;
    try {
      // Card always; Klarna / Afterpay only when the platform flag, every seller and the amount allow it.
      const bnpl = await bnplMethodsForCart({ sellerIds: priced.map((g) => g.sellerId), amountCents, shipToCountry: shipping.country });
      // Guests have no saved-card customer: the card is used for this payment only.
      const customer = payer.buyerId
        ? await ensureStripeCustomer(stripe, payer.buyerId, body.contactEmail, shipping, body.contactPhone)
        : undefined;
      intent = await stripe.paymentIntents.create({
        amount: amountCents,
        currency: "usd",
        ...(customer ? { customer } : {}),
        // Card covers Apple Pay and Google Pay (both are card wallets). BNPL
        // can't be combined with a top-level setup_future_usage, see lib/payments/bnpl.ts.
        ...paymentIntentMethodParams(bnpl, payer.buyerId ? body.saveCard !== false : false),
        receipt_email: body.contactEmail,
        shipping: {
          name: shipping.name,
          phone: shipping.phone,
          address: {
            line1: shipping.street,
            ...(shipping.line2 ? { line2: shipping.line2 } : {}),
            city: shipping.city,
            state: shipping.state,
            postal_code: shipping.zip,
            country: shipping.country,
          },
        },
        transfer_group: `cart_${rows[0].id}`,
        description: `Brandthread order (${rows.length} ${rows.length === 1 ? "seller" : "sellers"})`,
        metadata: {
          kind: CART_CHECKOUT_KIND,
          ...(payer.buyerId ? { buyerId: payer.buyerId } : { guest: "true" }),
          checkoutKey: key.slice(0, 100),
        },
      }, { idempotencyKey: payer.buyerId ? `cart-pi/${payer.buyerId}/${key}` : `cart-pi/guest/${firstRowId}` });
    } catch (error) {
      if (payer.buyerId) await releaseHeld(payer.buyerId, held);
      await releaseAll().catch((err) => logger.error({ err }, "Could not undo a checkout whose PaymentIntent failed"));
      logger.error({ err: error }, "Cart PaymentIntent creation failed");
      res.status(502).json({ error: "We couldn't start your payment. You haven't been charged. Try again.", code: "PAYMENT_START_FAILED" });
      return;
    }

    await db.transaction(async (tx) => {
      for (const row of rows) {
        await tx.update(checkoutSessions).set({
          stripePaymentIntentId: intent.id,
          stripeSessionId: `${intent.id}:${row.id}`,
        }).where(eq(checkoutSessions.id, row.id));
      }
      // Link the reservations to the intent so the expiry sweep cancels it first.
      await tx.update(stockReservations).set({ stripePaymentIntentId: intent.id })
        .where(inArray(stockReservations.checkoutSessionId, rows.map((row) => row.id)));
    });

    res.json({
      paymentIntentId: intent.id,
      clientSecret: intent.client_secret,
      status: intent.status,
      amountCents,
      groups: breakdown(priced, rows),
      paymentMethodTypes: intent.payment_method_types ?? ["card"],
      // The only response that carries it; only its hash is stored.
      ...(guestToken ? { guestAccessToken: guestToken } : {}),
    });
  });

  /** The cart's rows this caller may see: their own (signed in), or the guest holding the token. */
  async function ownedGroups(req: Request, intentId: string) {
    if (mode === "buyer") {
      const buyerId = (req as any).clerkUserId as string;
      return db.select().from(checkoutSessions)
        .where(and(eq(checkoutSessions.buyerId, buyerId), eq(checkoutSessions.stripePaymentIntentId, intentId)));
    }
    const supplied = req.body?.guestAccessToken;
    if (typeof supplied !== "string" || supplied.length < 32) return [];
    return db.select().from(checkoutSessions).where(and(
      isNull(checkoutSessions.buyerId),
      eq(checkoutSessions.stripePaymentIntentId, intentId),
      eq(checkoutSessions.guestAccessTokenHash, tokenHash(supplied)),
    ));
  }

  async function status(req: Request, res: Response) {
    const intentId = String(req.params.id);
    const groups = await ownedGroups(req, intentId);
    if (groups.length === 0) {
      res.status(404).json({ error: "Payment not found" });
      return;
    }
    const stripe = requireStripe();
    const intent = await stripe.paymentIntents.retrieve(intentId);
    const made = await db.select({
      id: orders.id, orderNumber: orders.orderNumber, ownerId: orders.ownerId, totalCents: orders.totalCents,
      sessionId: orders.stripeCheckoutSessionId,
    }).from(orders).where(inArray(orders.stripeCheckoutSessionId, groups.map((g) => g.stripeSessionId ?? "")));
    const decline = intent.last_payment_error?.decline_code ?? intent.last_payment_error?.code ?? null;
    res.json({
      status: intent.status,
      paymentStatus: intent.status === "succeeded" ? "paid" : intent.status === "processing" ? "processing" : "unpaid",
      amountTotal: intent.amount,
      declineReason: decline,
      orders: made.map((order) => ({
        orderId: order.id, orderNumber: order.orderNumber, sellerId: order.ownerId, amountTotalCents: order.totalCents,
      })),
      // Every group has an order once the webhook ran for all of them.
      complete: made.length === groups.length,
    });
  }

  if (mode === "buyer") router.get("/:id", status);
  else router.post("/:id/status", validateRequest({ body: guestTokenSchema }), status);

  router.post("/:id/cancel", ...(mode === "guest" ? [validateRequest({ body: guestTokenSchema })] : []), async (req, res) => {
    const intentId = String(req.params.id);
    const groups = await ownedGroups(req, intentId);
    if (groups.length === 0) {
      res.status(404).json({ error: "Payment not found" });
      return;
    }
    const stripe = requireStripe();
    const intent = await stripe.paymentIntents.retrieve(intentId);
    if (intent.status === "succeeded" || intent.status === "processing") {
      res.status(409).json({ error: "This payment already went through.", code: "PAYMENT_ALREADY_SUCCEEDED" });
      return;
    }
    if (intent.status !== "canceled") {
      await stripe.paymentIntents.cancel(intentId, { cancellation_reason: "requested_by_customer" });
    }
    await db.transaction(async (tx) => {
      for (const group of groups) await releaseStockReservation(tx, group.id);
    });
    await releaseCartRewards(groups);
    res.json({ ok: true });
  });

  return router;
}

/** Signed-in mount: /api/buyer/checkout/payment-intent. */
const router = createCheckoutIntentRouter("buyer");
/** Guest mount: /api/guest/checkout/payment-intent (BT-257). */
export const guestCheckoutIntentRouter = createCheckoutIntentRouter("guest");

export default router;
