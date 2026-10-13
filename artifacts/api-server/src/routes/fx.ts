/**
 * Item 107: display currency.
 *
 * GET   /api/fx/rates            public: USD reference rates for "≈" display lines
 *                                ({ enabled: false } when FX_RATES_ENABLED is off)
 * PATCH /api/fx/display-currency signed-in: remember the buyer's display currency
 *
 * Display only — nothing here changes what is charged (always USD).
 */
import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, users } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { fxRatesEnabled, getFxRates } from "../lib/intl/fxRates";

const router = Router();

router.get("/rates", async (_req, res) => {
  if (!fxRatesEnabled()) {
    res.json({ enabled: false, base: "USD", rates: {} });
    return;
  }
  const snapshot = await getFxRates();
  if (!snapshot) {
    res.json({ enabled: true, available: false, base: "USD", rates: {} });
    return;
  }
  res.set("Cache-Control", "public, max-age=3600");
  res.json({ enabled: true, available: true, ...snapshot });
});

router.get("/display-currency", requireAuth, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const [row] = await db.select({ displayCurrency: users.displayCurrency }).from(users)
    .where(eq(users.clerkId, userId)).limit(1);
  res.json({ displayCurrency: row?.displayCurrency ?? null });
});

router.patch("/display-currency", requireAuth, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const raw = req.body?.displayCurrency;
  const code = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  if (!/^[A-Z]{3}$/.test(code)) {
    res.status(400).json({ error: "displayCurrency must be a 3-letter ISO 4217 code" });
    return;
  }
  await db.update(users).set({ displayCurrency: code }).where(eq(users.clerkId, userId));
  res.json({ displayCurrency: code });
});

export default router;
