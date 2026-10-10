/**
 * AI credits (balance + history + packs).
 *
 * GET /api/ai/credits            — plan, billing state, balance, allowance, rollover, packs, tool prices
 * GET /api/ai/credits/history    — ledger, newest first (?limit=&before=ISO)
 * POST /api/ai/credits/packs/:packId/checkout — Stripe Checkout for a pack (web)
 * POST /api/ai/credits/purchases/verify       — confirms a paid session and credits it once
 * Native (iOS/Android) packs are store consumables credited by the RevenueCat webhook.
 */
import express, { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { creditToolPrices, packsForPlan } from "../lib/aiCredits/catalogue";
import { getAccount, listHistory } from "../lib/aiCredits/ledger";
import { createPackCheckout, fulfilCreditCheckoutSession, isAllowedCreditsReturnUrl, stripeConfigured } from "../lib/aiCredits/purchases";
import { findPack } from "../lib/aiCredits/catalogue";
import { requireStripe } from "../lib/stripe";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res, next) => {
  try {
    const userId = (req as any).clerkUserId as string;
    const account = await getAccount(userId);
    // Every plan, Pro included, has a finite balance (`unlimited` is always false).
    res.json({
      plan: account.plan,
      unlimited: account.unlimited,
      resetsAt: account.resetsAt,
      billing: account.billing,
      balance: account.balance,
      monthlyAllowance: account.monthlyAllowance,
      rolloverBalance: account.rolloverBalance,
      monthlyBalance: account.monthlyBalance,
      purchasedBalance: account.purchasedBalance,
      lowCreditsThreshold: account.lowCreditsThreshold,
      isLow: account.isLow,
      packs: packsForPlan(account.plan),
      purchase: { stripe: stripeConfigured() },
      tools: creditToolPrices(),
    });
  } catch (err) { next(err); }
});

router.get("/history", async (req, res, next) => {
  try {
    const userId = (req as any).clerkUserId as string;
    const limit = Number.parseInt(String(req.query.limit ?? "30"), 10);
    const before = typeof req.query.before === "string" ? req.query.before : undefined;
    res.json(await listHistory(userId, { limit: Number.isFinite(limit) ? limit : 30, before }));
  } catch (err) { next(err); }
});

router.post("/packs/:packId/checkout", express.json({ limit: "4kb" }), async (req, res) => {
  try {
    const userId = (req as any).clerkUserId as string;
    // Price and credits come only from the server catalogue, never from the request.
    const pack = findPack(req.params.packId);
    if (!pack) return res.status(404).json({ error: "Credit pack not found" });
    if (!(await getAccount(userId)).packsEligible) {
      return res.status(403).json({ error: "Credit packs are available on Starter and Growth", code: "packs_unavailable" });
    }
    const { returnUrl } = (req.body ?? {}) as { returnUrl?: unknown };
    if (!isAllowedCreditsReturnUrl(returnUrl)) {
      return res.status(400).json({ error: "returnUrl must be an allowed Brandthread AI credits callback URL" });
    }
    if (!stripeConfigured()) return res.status(503).json({ error: "Card payments are not available right now", code: "stripe_unavailable" });
    const out = await createPackCheckout(requireStripe(), { clerkUserId: userId, pack, returnUrl });
    return res.json(out);
  } catch (err: any) {
    if (err?.status === 503) return res.status(503).json({ error: "Card payments are not available right now", code: "stripe_unavailable" });
    req.log?.error?.({ err }, "AI credits checkout failed");
    return res.status(500).json({ error: "Failed to create checkout session. Please try again." });
  }
});

router.post("/purchases/verify", express.json({ limit: "4kb" }), async (req, res) => {
  try {
    const userId = (req as any).clerkUserId as string;
    const { sessionId } = (req.body ?? {}) as { sessionId?: unknown };
    if (typeof sessionId !== "string" || !/^cs_[A-Za-z0-9_]{5,200}$/.test(sessionId)) {
      return res.status(400).json({ error: "sessionId is required" });
    }
    if (!stripeConfigured()) return res.status(503).json({ error: "Card payments are not available right now", code: "stripe_unavailable" });
    const session = await requireStripe().checkout.sessions.retrieve(sessionId);
    const result = await fulfilCreditCheckoutSession(session, userId);
    if (!result.ok) {
      const status = result.code === "unpaid" ? 402 : 403;
      return res.status(status).json({ error: "Payment could not be confirmed", code: result.code });
    }
    return res.json({ credited: true, newlyGranted: result.granted, credits: result.credits, balance: (await getAccount(userId)).balance });
  } catch (err: any) {
    if (err?.status === 503) return res.status(503).json({ error: "Card payments are not available right now", code: "stripe_unavailable" });
    req.log?.error?.({ err }, "AI credits verify failed");
    return res.status(500).json({ error: "Failed to verify payment. Please try again." });
  }
});

export default router;
