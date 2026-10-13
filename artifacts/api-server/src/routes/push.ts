import { Router } from "express";
import { db, pushTokens, users } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { isValidTimeZone } from "../lib/push";
import { logger } from "../lib/logger";

const router = Router();

// POST /api/push/register
// Upserts a push token for the authenticated user.
// Body: { token: string, platform?: 'ios' | 'android' | 'web', timezone?: IANA name }
// `timezone` is the device's zone; quiet hours are evaluated in it.
router.post("/register", requireAuth, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { token, platform, timezone } = req.body as { token: string; platform?: string; timezone?: unknown };

  if (!token) return res.status(400).json({ error: "token is required" });
  if (timezone !== undefined && !isValidTimeZone(timezone)) {
    return res.status(400).json({ error: "timezone must be an IANA time zone" });
  }

  // Upsert: if this token exists for any user, re-assign it to the current user
  // (handles device handoff when a new user logs in on the same device).
  await db
    .insert(pushTokens)
    .values({ userId, token, platform: platform ?? "unknown" })
    .onConflictDoUpdate({
      target: pushTokens.token,
      set: { userId, platform: platform ?? "unknown", updatedAt: new Date() },
    });

  if (timezone !== undefined) {
    try {
      await db.update(users).set({ quietHoursTimezone: timezone }).where(eq(users.clerkId, userId));
    } catch (err) {
      // The token is registered; a missed timezone refresh retries next launch.
      logger.warn({ err }, "Could not store device timezone");
    }
  }

  return res.json({ ok: true });
});

// DELETE /api/push/deregister
// Removes a push token on logout.
// Body: { token: string }
router.delete("/deregister", requireAuth, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { token } = req.body as { token: string };

  if (!token) return res.status(400).json({ error: "token is required" });

  await db
    .delete(pushTokens)
    .where(and(eq(pushTokens.userId, userId), eq(pushTokens.token, token)));

  return res.json({ ok: true });
});

export default router;
