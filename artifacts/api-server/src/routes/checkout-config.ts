/**
 * GET /api/public/checkout-config (no auth): is checkout live, and which
 * wallets are on. See lib/checkoutConfig.ts. Never returns a key.
 */
import { Router } from "express";
import { checkoutConfig } from "../lib/checkoutConfig";

const router = Router();

router.get("/checkout-config", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=60");
  res.json(checkoutConfig());
});

export default router;
