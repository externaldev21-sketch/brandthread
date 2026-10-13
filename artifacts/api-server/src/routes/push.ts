import { Router } from "express";
import { db, pushTokens, users } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { isValidTimeZone } from "../lib/userTimezone";

const router = Router();

// POST /api/push/register
// Upserts a push token for the authenticated user.
// Body: { token: string, platform?: 'ios' | 'android' | 'web', timezone?: string }
// timezone is the device's IANA name; a valid one is stored on users.timezone
// (local-time retention pushes). An invalid one is ignored, never an error.
router.post("/register", requireAuth, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { token, platform } = req.body as { token: string; platform?: string };

  if (!token) return res.status(400).json({ error: "token is required" });

  // Upsert: if this token exists for any user, re-assign it to the current user
  // (handles device handoff when a new user logs in on the same device).
  await db
    .insert(pushTokens)
    .values({ userId, token, platform: platform ?? "unknown" })
    .onConflictDoUpdate({
      target: pushTokens.token,
      set: { userId, platform: platform ?? "unknown", updatedAt: new Date() },
    });

  const timezone = (req.body as { timezone?: unknown }).timezone;
  if (isValidTimeZone(timezone)) {
    await db.update(users).set({ timezone: timezone.trim() }).where(eq(users.clerkId, userId));
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
