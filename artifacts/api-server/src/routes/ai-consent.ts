/**
 * AI data-sharing consent (App Store Review Guideline 5.1.2(i)).
 *
 * GET    /api/ai-consent  -> { consented, consentedAt, provider }
 * POST   /api/ai-consent  -> { accept: true } records consent (idempotent)
 * DELETE /api/ai-consent  -> withdraws consent
 *
 * The mobile consent sheet (components/AiConsentSheet.tsx) reads and writes
 * this. middlewares/requireAiConsent.ts enforces it on AI routes.
 */
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import {
  AI_CONSENT_PROVIDER,
  readAiConsent,
  recordAiConsent,
  withdrawAiConsent,
} from "../lib/aiConsent";

export function consentPayload(at: Date | null) {
  return {
    consented: !!at,
    consentedAt: at ? at.toISOString() : null,
    provider: AI_CONSENT_PROVIDER,
  };
}

const router = Router();
router.use(requireAuth);

router.get("/", async (req: Request, res: Response) => {
  const userId = (req as any).clerkUserId as string;
  res.setHeader("Cache-Control", "no-store");
  res.json(consentPayload(await readAiConsent(userId)));
});

router.post("/", async (req: Request, res: Response) => {
  const userId = (req as any).clerkUserId as string;
  if (req.body?.accept !== true) {
    res.status(400).json({ error: "accept must be true" });
    return;
  }
  const at = await recordAiConsent(userId);
  if (!at) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  res.json(consentPayload(at));
});

router.delete("/", async (req: Request, res: Response) => {
  const userId = (req as any).clerkUserId as string;
  await withdrawAiConsent(userId);
  res.json(consentPayload(null));
});

export default router;
