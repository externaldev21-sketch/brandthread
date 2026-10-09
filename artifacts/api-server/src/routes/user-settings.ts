/**
 * Account settings that follow the signed-in user across devices.
 * GET   /api/me/settings — { settings, updatedAt } ({} / null when none saved)
 * PATCH /api/me/settings — shallow merge of allowlisted keys (see lib/userSettings.ts)
 */
import { Router } from "express";
import { db, userSettings } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import {
  mergeUserSettings, parseUserSettingsPatch, storedSizeOk, toUserSettingsDto,
} from "../lib/userSettings";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  try {
    const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
    res.json(toUserSettingsDto(row));
  } catch (err) {
    (req as any).log?.error?.({ err }, "user settings read failed");
    res.status(500).json({ error: "Couldn't load your settings. Try again." });
  }
});

router.patch("/", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const parsed = parseUserSettingsPatch(req.body);
  if (!parsed.ok) {
    res.status(parsed.status).json({ error: parsed.error, ...(parsed.issues ? { issues: parsed.issues } : {}) });
    return;
  }
  try {
    const result = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(userSettings)
        .where(eq(userSettings.userId, userId)).limit(1).for("update");
      const settings = mergeUserSettings(existing?.settings ?? {}, parsed.patch);
      if (!storedSizeOk(settings)) return null;
      const updatedAt = new Date();
      const [row] = await tx.insert(userSettings).values({ userId, settings, updatedAt })
        .onConflictDoUpdate({ target: userSettings.userId, set: { settings, updatedAt } }).returning();
      return row;
    });
    if (!result) {
      res.status(413).json({ error: "Settings payload too large" });
      return;
    }
    res.json(toUserSettingsDto(result));
  } catch (err) {
    (req as any).log?.error?.({ err }, "user settings save failed");
    res.status(500).json({ error: "Couldn't save your settings. Try again." });
  }
});

export default router;
