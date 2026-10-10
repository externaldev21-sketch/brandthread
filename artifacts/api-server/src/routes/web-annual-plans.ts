/**
 * GET /api/public/web-annual-plans: the optional web-only yearly seller
 * prices for the public /pricing page (lib/webAnnualPrices.ts).
 *
 * Public on purpose: no account data, only prices anyone can see on /pricing.
 * Returns { plans: [] } without calling Stripe until Dev sets a
 * STRIPE_PRICE_<TIER>_ANNUAL_WEB, so by default it costs nothing.
 */
import { Router } from "express";
import { stripe } from "../lib/stripe";
import { hasAnyWebAnnualPrice, listWebAnnualOffers } from "../lib/webAnnualPrices";

export const publicWebAnnualPlansRouter = Router();

publicWebAnnualPlansRouter.get("/web-annual-plans", async (_req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  if (!stripe || !hasAnyWebAnnualPrice()) {
    res.json({ plans: [] });
    return;
  }
  res.json({ plans: await listWebAnnualOffers(stripe as any) });
});
