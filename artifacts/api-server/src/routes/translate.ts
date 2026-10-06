/**
 * POST /api/translate — { texts: string[], targetLanguage } →
 *   { targetLanguage, translations: [{ text, translatedText, detectedLanguage, sameLanguage }] }
 *
 * Signed-in only; rate limited by the "expensive" policy (middlewares/rateLimit.ts
 * EXPENSIVE_PATH). Cached per text + language in translation_cache
 * (lib/translation.ts). 503 TRANSLATION_NOT_CONFIGURED when the OpenAI
 * integration env is missing; 502 TRANSLATION_FAILED when the model fails.
 */
import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { validateRequest } from "../middlewares/validateRequest";
import {
  TranslationNotConfiguredError,
  translateBodySchema,
  translateTexts,
  type TranslationLanguageCode,
} from "../lib/translation";

const router = Router();
router.use(requireAuth);

router.post("/", validateRequest({ body: translateBodySchema }), async (req, res) => {
  const { texts, targetLanguage } = req.body as { texts: string[]; targetLanguage: TranslationLanguageCode };
  try {
    const translations = await translateTexts(texts, targetLanguage);
    res.json({ targetLanguage, translations });
  } catch (err) {
    if (err instanceof TranslationNotConfiguredError) {
      res.status(503).json({ error: "Translation isn't available right now.", code: "TRANSLATION_NOT_CONFIGURED" });
      return;
    }
    req.log?.error({ err }, "Translation failed");
    res.status(502).json({ error: "Couldn't translate this. Try again.", code: "TRANSLATION_FAILED" });
  }
});

export default router;
