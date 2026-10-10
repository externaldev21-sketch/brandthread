/**
 * GET /api/ai-consent  — { granted, version, grantedAt, providers }
 * PUT /api/ai-consent  — { granted: boolean } allow or withdraw (QA-0043)
 */
import express, { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { AI_PROVIDERS, getAiConsent, setAiConsent, AI_CONSENT_PROVIDER } from "../lib/aiConsent";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  try {
    res.setHeader("Cache-Control", "no-store");
    const state = await getAiConsent(clerkUserId);
    res.json({ ...state, ...consentPayload(state.granted && state.grantedAt ? new Date(state.grantedAt) : null), providers: AI_PROVIDERS });
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

export function consentPayload(at: Date | null) { return { consented: !!at, consentedAt: at ? at.toISOString() : null, provider: AI_CONSENT_PROVIDER }; }
router.post("/", express.json({ limit: "1kb" }), async (req, res) => {
  if (req.body?.accept !== true) { res.status(400).json({ error: "accept must be true" }); return; }
  const state = await setAiConsent((req as any).clerkUserId, true);
  res.json({ ...state, ...consentPayload(state.granted && state.grantedAt ? new Date(state.grantedAt) : null), providers: AI_PROVIDERS });
});
router.delete("/", async (req, res) => {
  const state = await setAiConsent((req as any).clerkUserId, false);
  res.json({ ...state, ...consentPayload(null), providers: AI_PROVIDERS });
});
export default router;
