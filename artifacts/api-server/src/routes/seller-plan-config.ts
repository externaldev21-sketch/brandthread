/**
 * GET /api/config/seller-plans — the one shared plan config the app reads for
 * the onboarding plan screen and the Plan settings: trial length, reminder
 * lead time, monthly prices and how checkout runs (lib/planCatalogue.ts).
 * Public on purpose: it holds no account data, only what the plan screen shows.
 */
import { Router } from "express";
import { publicSellerPlanConfig } from "../lib/planCatalogue";
import { platformFeeBpsForPlan } from "../lib/planPerks";
import { MONTHLY_ALLOWANCE } from "../lib/aiCredits/catalogue";

const router = Router();

router.get("/", (_req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  const config = publicSellerPlanConfig();
  // Joined from the modules that enforce them, so the plan screen never states
  // a rate or allowance the server doesn't apply: the commission checkout
  // charges (lib/planPerks.ts) and the monthly AI credits
  // (lib/aiCredits/catalogue.ts; an unlimited allowance is left out).
  res.json({
    ...config,
    plans: config.plans.map((p) => {
      const ai = MONTHLY_ALLOWANCE[p.id];
      return {
        ...p,
        commissionPercent: platformFeeBpsForPlan(p.id) / 100,
        limits: { ...p.limits, ...(typeof ai === "number" ? { aiCreditsPerMonth: ai } : {}) },
      };
    }),
  });
});

export default router;
