/**
 * Account app settings (privacy, content, accessibility, security).
 * GET   /api/me/settings                        — { settings, updatedAt } (defaults when none saved)
 * PATCH /api/me/settings                        — partial update (see lib/userAppSettings.ts)
 * POST  /api/me/settings/reset-recommendations  — forget the learned For You taste profile
 */
import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { rateLimit } from "../middlewares/rateLimit";
import { userAppSettingsPatchSchema } from "../lib/userAppSettings";
import { getUserAppSettings, resetRecommendations, updateUserAppSettings } from "../lib/userAppSettingsStore";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  res.json(await getUserAppSettings(userId));
});

router.patch("/", rateLimit("mutation"), async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const parsed = userAppSettingsPatchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid settings",
      code: "VALIDATION_ERROR",
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
    return;
  }
  try {
    res.json(await updateUserAppSettings(userId, parsed.data));
  } catch (err) {
    (req as any).log?.error?.({ err }, "user app settings save failed");
    res.status(500).json({ error: "Couldn't save your settings. Try again." });
  }
});

router.post("/reset-recommendations", rateLimit("mutation"), async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  try {
    await resetRecommendations(userId);
    res.json({ ok: true });
  } catch (err) {
    (req as any).log?.error?.({ err }, "reset recommendations failed");
    res.status(500).json({ error: "Couldn't reset your suggestions. Try again." });
  }
});

export default router;
