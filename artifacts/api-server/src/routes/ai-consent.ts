/**
 * GET /api/ai-consent  — { granted, version, grantedAt, providers }
 * PUT /api/ai-consent  — { granted: boolean } allow or withdraw (QA-0043)
 */
import express, { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { AI_PROVIDERS, getAiConsent, setAiConsent } from "../lib/aiConsent";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  try {
    res.json({ ...(await getAiConsent(clerkUserId)), providers: AI_PROVIDERS });
  } catch (err) {
    req.log?.error?.({ err }, "Failed to read AI consent");
    res.status(500).json({ error: "Couldn't load your AI data sharing setting." });
  }
});

router.put("/", express.json({ limit: "1kb" }), async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const granted = (req.body ?? {}).granted;
  if (typeof granted !== "boolean") {
    res.status(400).json({ error: "granted must be true or false", code: "VALIDATION_ERROR" });
    return;
  }
  try {
    res.json({ ...(await setAiConsent(clerkUserId, granted)), providers: AI_PROVIDERS });
  } catch (err) {
    req.log?.error?.({ err }, "Failed to save AI consent");
    res.status(500).json({ error: "Couldn't save your AI data sharing setting." });
  }
});

export default router;
