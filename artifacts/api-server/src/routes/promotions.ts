/**
 * Sponsored (promoted) threads in For You — viewer-facing.
 *
 * GET  /api/promotions/sponsored?sessionId=&organicOffset=&organicCount=
 *        Sponsored slots for one page of the viewer's For You feed. `afterIndex`
 *        is the page-local organic index each Sponsored post goes after.
 * POST /api/promotions/sponsored/impression   { boostId, sessionId }
 *        Called once the Sponsored post is actually on screen; bills the boost.
 *
 * Policy (frequency cap, eligibility, pacing) is lib/promotions/sponsored.ts.
 */
import { Router } from "express";
import express from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { rateLimit } from "../middlewares/rateLimit";
import { recordSponsoredImpression, serveSponsoredSlots } from "../lib/promotions/sponsoredService";

const router = Router();
router.use(requireAuth);

const SESSION_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function intParam(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}

router.get("/sponsored", rateLimit("feed-event"), async (req, res) => {
  const viewerId = (req as any).clerkUserId as string;
  const sessionId = req.query.sessionId;
  const organicOffset = intParam(req.query.organicOffset, 0, 100_000);
  const organicCount = intParam(req.query.organicCount, 0, 50);
  if (typeof sessionId !== "string" || !SESSION_ID_RE.test(sessionId) || organicOffset === null || organicCount === null) {
    return res.status(400).json({ error: "sessionId, organicOffset and organicCount are required", code: "VALIDATION_ERROR" });
  }
  try {
    const slots = await serveSponsoredSlots({ viewerId, sessionId, organicOffset, organicCount });
    return res.json({
      slots: slots.map((s) => ({
        afterIndex: s.afterIndex,
        boostId: s.boostId,
        label: "Sponsored" as const,
        post: { ...s.post, sponsored: true, boostId: s.boostId },
      })),
    });
  } catch (err) {
    req.log?.error?.({ err, viewerId }, "Failed to load sponsored slots");
    // Sponsored content is optional: a failure must never break the feed.
    return res.json({ slots: [] });
  }
});

router.post("/sponsored/impression", express.json({ limit: "2kb" }), async (req, res) => {
  const viewerId = (req as any).clerkUserId as string;
  const { boostId, sessionId } = (req.body ?? {}) as { boostId?: unknown; sessionId?: unknown };
  if (typeof boostId !== "string" || !UUID_RE.test(boostId) || typeof sessionId !== "string" || !SESSION_ID_RE.test(sessionId)) {
    return res.status(400).json({ error: "boostId and sessionId are required", code: "VALIDATION_ERROR" });
  }
  try {
    const result = await recordSponsoredImpression({ viewerId, boostId, sessionId });
    return res.json(result);
  } catch (err) {
    req.log?.error?.({ err, viewerId, boostId }, "Failed to record sponsored impression");
    return res.status(500).json({ error: "Failed to record impression" });
  }
});

export default router;
