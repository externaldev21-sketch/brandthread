/**
 * GET /api/geo/postal/US/:zip → { postalCode, city, state, country }
 *
 * Public (guests check out too) and rate-limited. Lets the checkout fill
 * City and State as soon as a ZIP is typed (lib/addressLookup.ts). 404 when
 * the ZIP is unknown or the lookup is unavailable; the app then leaves the
 * fields to the buyer.
 */
import { Router } from "express";
import { rateLimit } from "../middlewares/rateLimit";
import { lookupUsZip } from "../lib/addressLookup";

const router = Router();

router.get("/postal/:country/:code", rateLimit("public-read"), async (req, res) => {
  const country = String(req.params.country).toUpperCase();
  const code = String(req.params.code);
  if (country !== "US" || !/^\d{5}(-\d{4})?$/.test(code)) {
    res.status(400).json({ error: "Only 5-digit US ZIP codes are supported" });
    return;
  }
  const found = await lookupUsZip(code);
  if (!found) {
    res.status(404).json({ error: "ZIP code not found" });
    return;
  }
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.json(found);
});

export default router;
