/**
 * GET /api/config/seller-plans — the one shared plan config the app reads for
 * the onboarding plan screen and the Plan settings: trial length, reminder
 * lead time, monthly prices and how checkout runs (lib/planCatalogue.ts).
 * Public on purpose: it holds no account data, only what the plan screen shows.
 */
import { Router } from "express";
import { publicSellerPlanConfig } from "../lib/planCatalogue";

const router = Router();

router.get("/", (_req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  res.json(publicSellerPlanConfig());
});

export default router;
