/**
 * Paid ad campaign delivery — buyer-facing (signed-in only; the signed-out
 * preview never calls these).
 *
 * GET  /api/ads/serve?surface=following|for_you|discover&sessionId=&organicOffset=&organicCount=
 *        Sponsored ad slots for one page of organic items. `afterIndex` is the
 *        page-local organic index each ad goes after; each slot carries a
 *        one-time `token`.
 * POST /api/ads/impression  { token }
 *        Client confirms the ad was viewable (>=50% on screen for ~1s). Bills
 *        one CPM impression, once per token.
 * POST /api/ads/click       { token }
 *        Records the click (once per impression) and returns the CTA destination.
 *
 * Policy: lib/promotions/sponsored.ts (caps, pacing, placement) +
 * lib/ads/adDelivery.ts (ad-specific rules). Accounting: lib/ads/adDeliveryService.ts.
 */
import express, { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { rateLimit } from "../middlewares/rateLimit";
import { isAdSurface } from "../lib/ads/adDelivery";
import { recordAdClick, recordAdImpression, serveAds } from "../lib/ads/adDeliveryService";

const router = Router();
router.use(requireAuth);

const SESSION_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

function intParam(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}

function viewerId(req: express.Request): string {
  return (req as any).clerkUserId as string;
}

router.get("/serve", rateLimit("feed-event"), async (req, res) => {
  const viewer = viewerId(req);
  const { surface, sessionId } = req.query;
  const organicOffset = intParam(req.query.organicOffset, 0, 100_000);
  const organicCount = intParam(req.query.organicCount, 0, 60);
  if (!isAdSurface(surface) || typeof sessionId !== "string" || !SESSION_ID_RE.test(sessionId)
      || organicOffset === null || organicCount === null) {
    return res.status(400).json({
      error: "surface, sessionId, organicOffset and organicCount are required",
      code: "VALIDATION_ERROR",
    });
  }
  try {
    const ads = await serveAds({ viewerId: viewer, surface, sessionId, organicOffset, organicCount });
    return res.json({ ads });
  } catch (err) {
    req.log?.error?.({ err, viewer, surface }, "Failed to serve ads");
    // Ads are optional: a failure must never break the feed.
    return res.json({ ads: [] });
  }
});

function readToken(body: unknown): string | null {
  const token = (body as { token?: unknown } | undefined)?.token;
  return typeof token === "string" && TOKEN_RE.test(token) ? token : null;
}

router.post("/impression", rateLimit("post-interact"), express.json({ limit: "2kb" }), async (req, res) => {
  const token = readToken(req.body);
  if (!token) return res.status(400).json({ error: "token is required", code: "VALIDATION_ERROR" });
  try {
    return res.json(await recordAdImpression({ viewerId: viewerId(req), token }));
  } catch (err) {
    req.log?.error?.({ err }, "Failed to record ad impression");
    return res.status(500).json({ error: "Failed to record impression" });
  }
});

router.post("/click", rateLimit("post-interact"), express.json({ limit: "2kb" }), async (req, res) => {
  const token = readToken(req.body);
  if (!token) return res.status(400).json({ error: "token is required", code: "VALIDATION_ERROR" });
  try {
    const result = await recordAdClick({ viewerId: viewerId(req), token });
    if (!result.ok) return res.status(404).json({ error: "Ad not found", code: "NOT_SERVED" });
    return res.json({ counted: result.counted, destination: result.destination });
  } catch (err) {
    req.log?.error?.({ err }, "Failed to record ad click");
    return res.status(500).json({ error: "Failed to record click" });
  }
});

export default router;
