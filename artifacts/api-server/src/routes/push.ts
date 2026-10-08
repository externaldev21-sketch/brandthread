import { Router } from "express";
import { callPushTokens, db, pushTokens } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();

// POST /api/push/register
// Upserts a push token for the authenticated user.
// Body: { token: string, platform?: 'ios' | 'android' | 'web' }
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

// POST /api/push/voip-token
// Registers a native call-ringing token (lib/voipPush.ts): an iOS PushKit
// VoIP token (kind 'voip') or an Android FCM registration token (kind 'fcm').
// Body: { token, platform: 'ios' | 'android', kind?: 'voip' | 'fcm',
//         bundleId?: string, environment?: 'sandbox' | 'production' }
// A token re-registered by another account moves to that account.
const VOIP_TOKEN_RE = /^[A-Za-z0-9:_\-.]{16,4096}$/;
const BUNDLE_ID_RE = /^[A-Za-z0-9.-]{3,155}$/;

router.post("/voip-token", requireAuth, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { token, platform, kind, bundleId, environment } = (req.body ?? {}) as Record<string, unknown>;
  if (typeof token !== "string" || !VOIP_TOKEN_RE.test(token)) {
    return res.status(400).json({ error: "token is required", code: "INVALID_TOKEN" });
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
    userId,
    platform,
    kind: resolvedKind as string,
    token,
    bundleId: platform === "ios" ? ((bundleId as string | undefined) ?? null) : null,
    environment: platform === "ios" ? ((environment as string | undefined) ?? null) : null,
  };
  await db.insert(callPushTokens)
    .values(values)
    .onConflictDoUpdate({
      target: callPushTokens.token,
      set: { ...values, updatedAt: new Date() },
    });
  return res.json({ ok: true });
});

// DELETE /api/push/voip-token
// Removes this account's native call token (sign-out).
// Body: { token: string }
router.delete("/voip-token", requireAuth, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { token } = (req.body ?? {}) as { token?: unknown };
  if (typeof token !== "string" || !token) return res.status(400).json({ error: "token is required", code: "INVALID_TOKEN" });
  await db.delete(callPushTokens)
    .where(and(eq(callPushTokens.userId, userId), eq(callPushTokens.token, token)));
  return res.json({ ok: true });
});

export default router;
