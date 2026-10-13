import { Router } from "express";
import { db, pushTokens, callPushTokens, users } from "@workspace/db";
import { and, eq, notInArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { cappedUnknown, jsonValue, looseBody, validateBody } from "../middlewares/bodySchemas";
import { isValidTimeZone } from "../lib/push";
import { logger } from "../lib/logger";

const router = Router();

// Shape + size guards; the handlers keep their own required-field checks.
const registerPushBody = looseBody({ token: cappedUnknown(4_096), platform: cappedUnknown(40), accountIds: jsonValue(5_000) });
const deregisterPushBody = looseBody({ token: cappedUnknown(4_096) });

// POST /api/push/register
// Upserts a push token for the authenticated user.
// Body: { token: string, platform?: 'ios' | 'android' | 'web' }
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
router.post("/register", requireAuth, validateBody(registerPushBody), async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { token, platform, accountIds, timezone } = req.body as { token: string; platform?: string; accountIds?: unknown; timezone?: unknown };

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

  if (isValidTimeZone(timezone)) {
    try {
      await db.update(users).set({ quietHoursTimezone: timezone, timezone: timezone as string }).where(eq(users.clerkId, userId));
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
router.delete("/deregister", requireAuth, validateBody(deregisterPushBody), async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { token } = req.body as { token: string };

  if (!token) return res.status(400).json({ error: "token is required" });

  await db
    .delete(pushTokens)
    .where(and(eq(pushTokens.userId, userId), eq(pushTokens.token, token)));

  return res.json({ ok: true });
});

const CALL_TOKEN_RE = /^[a-zA-Z0-9_:.\-]{32,512}$/;
const BUNDLE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9.\-]{2,254}$/;

router.post("/voip-token", requireAuth, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { token, platform, kind, bundleId, environment } = req.body ?? {};
  if (typeof token !== "string" || !CALL_TOKEN_RE.test(token)) {
    return res.status(400).json({ error: "token is invalid", code: "INVALID_TOKEN" });
  }
  if (platform !== "ios" && platform !== "android") {
    return res.status(400).json({ error: "platform must be ios or android", code: "INVALID_PLATFORM" });
  }
  const resolvedKind = kind ?? (platform === "ios" ? "voip" : "fcm");
  if ((platform === "ios" && resolvedKind !== "voip") || (platform === "android" && resolvedKind !== "fcm")) {
    return res.status(400).json({ error: "kind must be voip on ios and fcm on android", code: "INVALID_KIND" });
  }
  if (bundleId !== undefined && bundleId !== null && (typeof bundleId !== "string" || !BUNDLE_ID_RE.test(bundleId))) {
    return res.status(400).json({ error: "bundleId is invalid", code: "INVALID_BUNDLE_ID" });
  }
  if (environment !== undefined && environment !== null && environment !== "sandbox" && environment !== "production") {
    return res.status(400).json({ error: "environment must be sandbox or production", code: "INVALID_ENVIRONMENT" });
  }
  const values = {
    userId, platform, kind: resolvedKind as string, token,
    bundleId: platform === "ios" ? ((bundleId as string | undefined) ?? null) : null,
    environment: platform === "ios" ? ((environment as string | undefined) ?? null) : null,
  };
  await db.insert(callPushTokens).values(values).onConflictDoUpdate({
    target: callPushTokens.token, set: { ...values, updatedAt: new Date() },
  });
  return res.json({ ok: true });
});

router.delete("/voip-token", requireAuth, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { token } = req.body ?? {};
  if (typeof token !== "string" || !token) return res.status(400).json({ error: "token is required", code: "INVALID_TOKEN" });
  await db.delete(callPushTokens).where(and(eq(callPushTokens.userId, userId), eq(callPushTokens.token, token)));
  return res.json({ ok: true });
});

export default router;
