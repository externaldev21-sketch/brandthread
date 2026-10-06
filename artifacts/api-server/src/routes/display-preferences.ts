/**
 * Account display preferences (lib/displayPreferences.ts, migration 120).
 *
 * GET   /api/display-preferences — my translation language, auto-translate,
 *                                  text size and high-contrast icons
 * PATCH /api/display-preferences — { translationLanguage?, autoTranslateCaptions?,
 *                                    textSize?, highContrastIcons? }
 */
import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { validateRequest } from "../middlewares/validateRequest";
import {
  displayPreferencesPatchSchema,
  loadDisplayPreferences,
  saveDisplayPreferences,
} from "../lib/displayPreferences";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  try {
    res.json({ preferences: await loadDisplayPreferences(userId) });
  } catch (err) {
    req.log?.error({ err }, "Failed to load display preferences");
    res.status(500).json({ error: "Could not load your settings. Try again." });
  }
});

router.patch("/", validateRequest({ body: displayPreferencesPatchSchema }), async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  try {
    res.json({ preferences: await saveDisplayPreferences(userId, req.body ?? {}) });
  } catch (err) {
    req.log?.error({ err }, "Failed to save display preferences");
    res.status(500).json({ error: "Could not save your settings. Try again." });
  }
});

export default router;
