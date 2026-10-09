import { Router } from "express";
import { db, pushTokens } from "@workspace/db";
import { and, eq, notInArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();

const MAX_ACCOUNTS = 10;

/**
 * Accounts to keep on this device: the caller plus any other accounts the app
 * says are still signed in (account switcher). Anything else registered to the
 * same token is a stale sign-in and is removed.
 */
export function accountsToKeep(callerId: string, signedInAccountIds: unknown): string[] {
  const others = Array.isArray(signedInAccountIds)
    ? signedInAccountIds.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 128)
    : [];
  return [...new Set([callerId, ...others])].slice(0, MAX_ACCOUNTS);
}

// POST /api/push/register
// Registers this device's push token for the authenticated user.
// Body: { token: string, platform?: 'ios' | 'android' | 'web', accountIds?: string[] }
//
// A device can be signed in to several accounts; each keeps its own row for
// the same token (unique per token + user, migration 281) so pushes for the
// account that isn't active still arrive, labelled with that account.
// `accountIds` lists every account still signed in on the device; rows for
// any other account on this token are removed (signed out elsewhere, or the
// device changed hands). Older app builds don't send it, and then only the
// caller is kept — the previous hand-off behavior.
router.post("/register", requireAuth, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { token, platform, accountIds } = req.body as { token: string; platform?: string; accountIds?: unknown };

  if (!token) return res.status(400).json({ error: "token is required" });

  const keep = accountsToKeep(userId, accountIds);
  await db.delete(pushTokens).where(and(eq(pushTokens.token, token), notInArray(pushTokens.userId, keep)));
  await db
    .insert(pushTokens)
    .values({ userId, token, platform: platform ?? "unknown" })
    .onConflictDoUpdate({
      target: [pushTokens.token, pushTokens.userId],
      set: {
        platform: platform ?? "unknown",
        isActive: true,
        deactivatedAt: null,
        deactivatedReason: null,
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      },
    });

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
