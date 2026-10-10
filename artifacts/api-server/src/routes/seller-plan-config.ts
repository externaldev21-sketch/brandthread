/**
 * GET /api/config/seller-plans — the one shared plan config the app reads for
 * the onboarding plan screen, the cap-hit sheet and Settings → Plan: trial
 * length, reminder lead time, prices, product caps, staff seats, tier gates
 * and how checkout runs (lib/planCatalogue.ts via lib/sellerPlanConfig.ts).
 * Public on purpose: it holds no account data, only what the plan screen shows.
 */
import { Router } from "express";
import { publicSellerPlanConfig } from "../lib/sellerPlanConfig";

const router = Router();

router.get("/", (_req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  res.json(publicSellerPlanConfig());
});

export default router;
