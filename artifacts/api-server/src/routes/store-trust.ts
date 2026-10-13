/**
 * Public store trust signals, mounted at /api/public/store-trust.
 *
 * GET /:sellerId  → { processingDays, details }
 *   processingDays: business days the store takes to ship (null when the
 *                   seller hasn't set shipping up — the app then shows nothing)
 *   details:        shipping-speed and item-as-described rating averages
 */
import { Router } from "express";
import { resolveToClerkId } from "./public";
import { emptyDetailRatings, sellerDetailRatings, storeProcessingDays } from "../lib/storeTrust";

const router = Router();

router.get("/:sellerId", async (req, res) => {
  const sellerId = await resolveToClerkId(String(req.params.sellerId ?? ""), "seller");
  if (!sellerId) { res.json({ processingDays: null, details: emptyDetailRatings() }); return; }
  try {
    const [processingDays, details] = await Promise.all([
      storeProcessingDays(sellerId),
      sellerDetailRatings(sellerId),
    ]);
    res.set("Cache-Control", "public, max-age=60");
    res.json({ processingDays, details });
  } catch (err) {
    req.log?.error({ err, sellerId }, "Store trust lookup failed");
    res.status(500).json({ error: "Could not load this store's shipping and ratings" });
  }
});

export default router;
