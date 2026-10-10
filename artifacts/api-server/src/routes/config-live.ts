/**
 * GET /api/config/live -> { liveAvailable: boolean }
 *
 * Public (no auth, no secrets: only whether Agora is configured). The mobile
 * app reads it via lib/useLiveAvailable.ts and hides Go Live when false.
 */
import { Router } from "express";
import { liveConfigPayload } from "../lib/liveAvailability";

const router = Router();

router.get("/", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  res.json(liveConfigPayload());
});

export default router;
