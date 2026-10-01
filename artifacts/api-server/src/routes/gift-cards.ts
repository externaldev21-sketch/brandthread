/**
 * Store gift cards.
 * Mounted at /api/gift-cards.
 *
 * Public
 *   GET  /store/:sellerId            does this store sell gift cards, and at which amounts
 * Buyer (signed in)
 *   POST /purchase                   start buying a card: creates the PaymentIntent (Brandthread balance)
 *   POST /purchase/:id/confirm       after paying: activate the card (covers a slow webhook), returns the code once
 *   POST /lookup                     balance of a card by code (rate limited)
 *   POST /claim                      add a card to my wallet by code (rate limited)
 *   GET  /mine                       my cards (owned + ones I bought) with balances
 *   GET  /mine/:id                   one card with its history
 * Seller (marketing permission)
 *   GET  /seller/settings            PUT /seller/settings
 *   GET  /seller/cards               every card the store issued or sold
 *   POST /seller/issue               issue a card directly (no payment)
 *   POST /seller/cards/:id/void      void a card (its balance goes to 0)
 *
 * Codes are generated server-side and stored only as a hash; the plaintext is
 * returned exactly once (purchase confirm / seller issue) and emailed.
 */
import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, giftCards } from "@workspace/db";
import { z } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requirePermission } from "../middlewares/requireRole";
import { requestPrimitives, validateRequest } from "../middlewares/validateRequest";
import { requireStripe } from "../lib/stripe";
import { logger } from "../lib/logger";
import {
  GiftCardError, assertValidAmount, claimCard, effectiveStatus, findCardByCode, issueSellerCard, listBuyerCards, listSellerCards,
  listTransactions, presentCard, voidCard,
} from "../lib/giftCards/service";
import { getGiftCardSettings, saveGiftCardSettings, expiryFromMonths } from "../lib/giftCards/settings";
import { confirmGiftCardPurchase, createGiftCardPurchase, deliverGiftCard, storeNameFor } from "../lib/giftCards/purchase";
import { guardCodeLookup } from "../lib/giftCards/checkout";
import { looksLikeGiftCardCode } from "../lib/giftCards/codes";

const router = Router();

function fail(res: Response, error: unknown): boolean {
  if (error instanceof GiftCardError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return true;
  }
  return false;
}

function stripeOr503(res: Response) {
  try {
    return requireStripe();
  } catch {
    res.status(503).json({ error: "Payments are unavailable right now.", code: "STRIPE_NOT_CONFIGURED" });
    return null;
  }
}

// ─── Public ──────────────────────────────────────────────────────────────────

router.get("/store/:sellerId", async (req, res) => {
  const sellerId = String(req.params.sellerId);
  const settings = await getGiftCardSettings(sellerId);
  res.json({
    sellerId,
    storeName: await storeNameFor(sellerId),
    enabled: settings.enabled,
    denominations: settings.enabled ? settings.denominations : [],
    allowCustom: settings.enabled && settings.allowCustom,
    minCents: settings.minCents,
    maxCents: settings.maxCents,
  });
});

router.use(requireAuth);

// ─── Buyer ───────────────────────────────────────────────────────────────────

const purchaseSchema = z.object({
  sellerId: requestPrimitives.id,
  amountCents: z.coerce.number().int(),
  recipientEmail: requestPrimitives.email,
  recipientName: z.string().trim().max(80).optional(),
  message: z.string().trim().max(300).optional(),
  forSelf: z.boolean().optional(),
  clientIdempotencyKey: z.string().trim().min(8).max(120),
});

router.post("/purchase", validateRequest({ body: purchaseSchema }), async (req, res) => {
  const buyerId = (req as any).clerkUserId as string;
  const body = req.body as z.infer<typeof purchaseSchema>;
  const stripe = stripeOr503(res);
  if (!stripe) return;
  try {
    const result = await createGiftCardPurchase(stripe, { ...body, buyerId });
    res.json(result);
  } catch (error) {
    if (fail(res, error)) return;
    throw error;
  }
});

router.post("/purchase/:id/confirm", async (req, res) => {
  const buyerId = (req as any).clerkUserId as string;
  const stripe = stripeOr503(res);
  if (!stripe) return;
  try {
    const result = await confirmGiftCardPurchase(stripe, buyerId, String(req.params.id));
    res.json({
      status: result.status,
      card: presentCard(result.card, "purchaser"),
      // Shown once, to the buyer who just paid, so they can also share it themselves.
      code: result.code,
    });
  } catch (error) {
    if (fail(res, error)) return;
    throw error;
  }
});

const codeSchema = z.object({ code: z.string().trim().min(4).max(64) });

router.post("/lookup", validateRequest({ body: codeSchema }), async (req, res) => {
  const buyerId = (req as any).clerkUserId as string;
  try {
    await guardCodeLookup(buyerId);
    const card = looksLikeGiftCardCode(req.body.code) ? await findCardByCode(db, req.body.code) : null;
    if (!card || card.status === "pending_payment" || (card.ownerId && card.ownerId !== buyerId)) {
      res.status(404).json({ error: "We couldn't find that gift card.", code: "GIFT_CARD_NOT_FOUND" });
      return;
    }
    res.json({ card: presentCard(card, "owner"), storeName: await storeNameFor(card.sellerId) });
  } catch (error) {
    if (fail(res, error)) return;
    throw error;
  }
});

router.post("/claim", validateRequest({ body: codeSchema }), async (req, res) => {
  const buyerId = (req as any).clerkUserId as string;
  try {
    await guardCodeLookup(buyerId);
    const found = looksLikeGiftCardCode(req.body.code) ? await findCardByCode(db, req.body.code) : null;
    if (!found || found.status === "pending_payment") {
      res.status(404).json({ error: "We couldn't find that gift card.", code: "GIFT_CARD_NOT_FOUND" });
      return;
    }
    const card = await db.transaction((tx) => claimCard(tx, found.id, buyerId));
    res.json({ card: presentCard(card, "owner"), storeName: await storeNameFor(card.sellerId) });
  } catch (error) {
    if (fail(res, error)) return;
    throw error;
  }
});

router.get("/mine", async (req, res) => {
  const buyerId = (req as any).clerkUserId as string;
  const cards = await listBuyerCards(buyerId);
  const names = new Map<string, string>();
  for (const sellerId of new Set(cards.map((c) => c.sellerId))) names.set(sellerId, await storeNameFor(sellerId));
  res.json({
    cards: cards.map((card) => ({
      ...presentCard(card, card.ownerId === buyerId ? "owner" : "purchaser"),
      storeName: names.get(card.sellerId) ?? "",
    })),
    // Spendable money across every card I own, by store.
    totalCents: cards.filter((c) => c.ownerId === buyerId && effectiveStatus(c) === "active")
      .reduce((sum, c) => sum + c.balanceCents, 0),
  });
});

router.get("/mine/:id", async (req, res) => {
  const buyerId = (req as any).clerkUserId as string;
  const [card] = await db.select().from(giftCards).where(eq(giftCards.id, String(req.params.id))).limit(1);
  if (!card || (card.ownerId !== buyerId && card.purchaserId !== buyerId)) {
    res.status(404).json({ error: "Gift card not found.", code: "NOT_FOUND" });
    return;
  }
  const history = await listTransactions(card.id);
  res.json({
    card: { ...presentCard(card, card.ownerId === buyerId ? "owner" : "purchaser"), storeName: await storeNameFor(card.sellerId) },
    history: history.map((h) => ({ id: h.id, type: h.type, amountCents: h.amountCents, balanceAfterCents: h.balanceAfterCents, note: h.note, createdAt: h.createdAt })),
  });
});

// ─── Seller ──────────────────────────────────────────────────────────────────

const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  denominations: z.array(z.coerce.number().int()).min(1).max(6).optional(),
  allowCustom: z.boolean().optional(),
  expiryMonths: z.number().int().min(1).max(120).nullable().optional(),
});

router.get("/seller/settings", requirePermission("marketing"), async (req, res) => {
  res.json(await getGiftCardSettings((req as any).clerkUserId as string));
});

router.put("/seller/settings", requirePermission("marketing"), validateRequest({ body: settingsSchema }), async (req, res) => {
  try {
    res.json(await saveGiftCardSettings((req as any).clerkUserId as string, req.body));
  } catch (error) {
    if (fail(res, error)) return;
    throw error;
  }
});

router.get("/seller/cards", requirePermission("marketing"), async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const cards = await listSellerCards(sellerId);
  res.json({
    cards: cards.map((card) => presentCard(card, "seller")),
    outstandingCents: cards.filter((c) => effectiveStatus(c) === "active").reduce((sum, c) => sum + c.balanceCents, 0),
  });
});

const issueSchema = z.object({
  amountCents: z.coerce.number().int(),
  recipientEmail: requestPrimitives.email,
  recipientName: z.string().trim().max(80).optional(),
  message: z.string().trim().max(300).optional(),
});

router.post("/seller/issue", requirePermission("marketing"), validateRequest({ body: issueSchema }), async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const body = req.body as z.infer<typeof issueSchema>;
  try {
    assertValidAmount(body.amountCents);
    const settings = await getGiftCardSettings(sellerId);
    const { card, code } = await db.transaction((tx) => issueSellerCard(tx, {
      sellerId,
      amountCents: body.amountCents,
      purchaserId: null,
      recipientEmail: body.recipientEmail,
      recipientName: body.recipientName ?? null,
      message: body.message ?? null,
      expiresAt: expiryFromMonths(settings.expiryMonths),
      actorId: sellerId,
    }));
    const emailed = await deliverGiftCard(card, code, null).catch((err) => {
      logger.error({ err, cardId: card.id }, "Seller-issued gift card email failed");
      return false;
    });
    // The code is returned once so the seller can share it if the email didn't send.
    res.status(201).json({ card: presentCard(card, "seller"), code, emailed });
  } catch (error) {
    if (fail(res, error)) return;
    throw error;
  }
});

router.post("/seller/cards/:id/void", requirePermission("marketing"), async (req: Request, res: Response) => {
  const sellerId = (req as any).clerkUserId as string;
  try {
    const card = await db.transaction((tx) => voidCard(tx, String(req.params.id), sellerId, sellerId));
    res.json({ card: presentCard(card, "seller") });
  } catch (error) {
    if (fail(res, error)) return;
    throw error;
  }
});

export default router;
