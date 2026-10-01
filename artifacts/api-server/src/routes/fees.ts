/**
 * Fee transparency endpoints. Derived only from lib/money/fees.ts.
 *
 *   GET  /api/finance/fees         fee schedule (signed-in)
 *   POST /api/finance/fees/quote   what a seller receives for a price (signed-in)
 *   GET  /api/public/fee-schedule  same schedule, no auth (static, cacheable)
 *
 * Mounted BEFORE the finance router so these do not need payout permissions:
 * any signed-in seller (or team member) may see what they will be charged.
 */
import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { MoneyError } from "../lib/money/fees";
import { getFeeSchedule, quoteSale } from "../lib/money/feeSchedule";

export const financeFeesRouter = Router();
financeFeesRouter.use(requireAuth);

financeFeesRouter.get("/", (_req, res) => {
  res.json(getFeeSchedule());
});

financeFeesRouter.post("/quote", (req, res) => {
  try {
    const { priceCents, quantity, shippingCents } = (req.body ?? {}) as Record<string, unknown>;
    res.json(quoteSale({ priceCents, quantity, shippingCents }));
  } catch (err) {
    if (err instanceof MoneyError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

export const publicFeeScheduleRouter = Router();
publicFeeScheduleRouter.get("/fee-schedule", (_req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  res.json(getFeeSchedule());
});
