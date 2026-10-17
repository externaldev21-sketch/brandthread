/**
 * Account settings that follow the signed-in user across devices.
 * GET   /api/me/settings — { settings, updatedAt } ({} / null when none saved)
 * PATCH /api/me/settings — shallow merge of allowlisted keys (see lib/userSettings.ts)
 */
import { Router } from "express";
import { db, userSettings, users } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { accountPrivacyFromAppSettings, mirrorAccountPrivacy } from "../lib/privacySettings";
import { requireAuth } from "../middlewares/requireAuth";
import { rateLimit } from "../middlewares/rateLimit";
import { resetRecommendations } from "../lib/userAppSettingsStore";
import {
  mergeUserSettings, parseUserSettingsPatch, storedSizeOk, toUserSettingsDto,
} from "../lib/userSettings";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  try {
    const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
    const dto = toUserSettingsDto(row);
    // Preserve the generic KV wire contract (including {} on first load).
    // Policy consumers and typed settings clients resolve their own defaults.
    res.json(dto);
  } catch (err) {
    (req as any).log?.error?.({ err }, "user settings read failed");
    res.status(500).json({ error: "Couldn't load your settings. Try again." });
  }
});

router.patch("/", rateLimit("mutation"), async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const parsed = parseUserSettingsPatch(req.body);
  if (!parsed.ok) {
    res.status(parsed.status).json({ error: parsed.error, ...(parsed.issues ? { issues: parsed.issues } : {}) });
    return;
  }
  try {
    const result = await db.transaction(async (tx) => {
      const privacyPatch = accountPrivacyFromAppSettings(parsed.patch);
      if (Object.keys(privacyPatch).length) {
        await tx.select({ id: users.id }).from(users).where(eq(users.clerkId, userId)).limit(1).for("update");
      }
      const [existing] = await tx.select().from(userSettings)
        .where(eq(userSettings.userId, userId)).limit(1).for("update");
      const settings = mergeUserSettings(existing?.settings ?? {}, parsed.patch);
      if (!storedSizeOk(settings)) return null;
      if (Object.keys(privacyPatch).length) {
        await tx.update(users).set({
          privacySettings: sql`COALESCE(${users.privacySettings}, '{}'::jsonb) || ${JSON.stringify(privacyPatch)}::jsonb`,
          ...(privacyPatch.readReceiptsEnabled !== undefined ? { readReceiptsEnabled: privacyPatch.readReceiptsEnabled } : {}),
          ...(privacyPatch.activityStatusVisible !== undefined ? { showActivityStatus: privacyPatch.activityStatusVisible } : {}),
        }).where(eq(users.clerkId, userId));
      }
      const updatedAt = new Date();
      const [row] = await tx.insert(userSettings).values({ userId, settings, updatedAt })
        .onConflictDoUpdate({ target: userSettings.userId, set: { settings, updatedAt } }).returning();
      await mirrorAccountPrivacy(tx, userId, privacyPatch);
      if (Object.keys(privacyPatch).length) {
        const [merged] = await tx.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
        return merged;
      }
      return row;
    });
    if (!result) {
      res.status(413).json({ error: "Settings payload too large" });
      return;
    }
    const dto = toUserSettingsDto(result);
    res.json(dto);
  } catch (err) {
    (req as any).log?.error?.({ err }, "user settings save failed");
    res.status(500).json({ error: "Couldn't save your settings. Try again." });
  }
});

router.post("/reset-recommendations", rateLimit("mutation"), async (req, res) => {
  await resetRecommendations((req as any).clerkUserId);
  res.json({ ok: true });
});

export default router;
