/**
 * Notification preference routes for sellers and buyers.
 * Mounted at /api/notification-prefs and /api/seller/notification-prefs.
 *
 * Endpoints
 * ─────────
 * GET  /api/seller/notification-prefs   → { digest: 'realtime' | 'daily' }
 * PUT  /api/seller/notification-prefs   ← { digest: 'realtime' | 'daily' }
 *
 * `promotionalPush` (boolean, default false) is the explicit opt-in for
 * promotional/marketing pushes (App Store 4.5.4); see lib/pushPolicy.ts.
 */

import { Router } from "express";
import { db, users } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { channelView, parseChannelKey, channelPrefKey } from "../lib/notificationChannels";
import { cappedUnknown, jsonValue, looseBody, validateBody } from "../middlewares/bodySchemas";

const router = Router();

// Shape + size guards; the handler keeps its per-key / enum / boolean checks.
const updateNotificationPrefsBody = looseBody({
  digest:          cappedUnknown(40),
  categories:      jsonValue(20_000),
  channels:        jsonValue(50_000),
  pushEnabled:     cappedUnknown(10),
  promotionalPush: cappedUnknown(10),
  quietHours:      jsonValue(1_000),
});
router.use(requireAuth);

const VALID_DIGEST = ["realtime", "daily"] as const;
type DigestMode = typeof VALID_DIGEST[number];
const BUYER_DEFAULTS = {
  new_drops: true,
  messages: true,
  order_updates: true,
  friend_activity: true,
  price_alerts: true,
  return_updates: true,
  cart_reminders: true,
  seller_announcements: true,
};
const SELLER_DEFAULTS = {
  new_orders: true,
  production_milestones: true,
  payout_confirmations: true,
  customer_messages: true,
  disputes: true,
  subscription_trial: true,
  inventory_alerts: true,
  seller_announcements: true,
};

function defaultsFor(accountType: string | null | undefined) {
  return accountType === "seller" ? SELLER_DEFAULTS : BUYER_DEFAULTS;
}

/** Separate read so a deploy before migration 260 reports false instead of failing the screen. */
async function readPromoOptIn(clerkId: string): Promise<boolean> {
  try {
    const [r] = await db.select({ v: users.promoPushOptIn }).from(users).where(eq(users.clerkId, clerkId)).limit(1);
    return r?.v === true;
  } catch {
    return false;
  }
}

const HHMM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function isValidTimeOfDay(value: unknown): value is string {
  return typeof value === "string" && HHMM_PATTERN.test(value);
}

// ── GET /api/seller/notification-prefs ───────────────────────────────────────
router.get("/", async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  try {
    const [row] = await db
      .select({
        digest: sql<string>`notification_digest`,
        accountType: users.accountType,
        preferences: users.notificationPreferences,
        pushEnabled: users.pushEnabled,
        quietHoursStart: users.quietHoursStart,
        quietHoursEnd: users.quietHoursEnd,
        quietHoursTimezone: users.quietHoursTimezone,
      })
      .from(users)
      .where(eq(users.clerkId, clerkId))
      .limit(1);

    const role = row?.accountType === "seller" ? "seller" : "buyer";
    return res.json({
      digest: (row?.digest ?? "realtime") as DigestMode,
      role,
      pushEnabled: row?.pushEnabled ?? true,
      promotionalPush: await readPromoOptIn(clerkId),
      quietHours: {
        start: row?.quietHoursStart ?? null,
        end: row?.quietHoursEnd ?? null,
        timezone: row?.quietHoursTimezone ?? "UTC",
      },
      categories: { ...defaultsFor(row?.accountType), ...(row?.preferences ?? {}) },
      channels: channelView(row?.accountType, row?.preferences),
    });
  } catch (err) {
    req.log.error({ err, clerkId }, "Failed to fetch notification preferences");
    return res.status(500).json({ error: "Failed to fetch notification preferences" });
  }
});

// ── PUT /api/seller/notification-prefs ───────────────────────────────────────
router.put("/", validateBody(updateNotificationPrefsBody), async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const { digest, categories, channels, pushEnabled, promotionalPush, quietHours } = req.body as {
    digest?: string;
    categories?: Record<string, unknown>;
    /** { inApp?: { [type]: boolean }, email?: { [type]: boolean } } */
    channels?: Record<string, unknown>;
    pushEnabled?: unknown;
    promotionalPush?: unknown;
    quietHours?: { start?: unknown; end?: unknown; timezone?: unknown } | null;
  };
  if (digest !== undefined && !VALID_DIGEST.includes(digest as DigestMode)) {
    res.status(400).json({ error: `digest must be one of: ${VALID_DIGEST.join(", ")}` });
    return;
  }
  if (categories !== undefined && (!categories || typeof categories !== "object" || Array.isArray(categories))) {
    return res.status(400).json({ error: "categories must be an object" });
  }
  if (channels !== undefined && (!channels || typeof channels !== "object" || Array.isArray(channels))) {
    return res.status(400).json({ error: "channels must be an object" });
  }
  if (pushEnabled !== undefined && typeof pushEnabled !== "boolean") {
    return res.status(400).json({ error: "pushEnabled must be a boolean" });
  }
  if (promotionalPush !== undefined && typeof promotionalPush !== "boolean") {
    return res.status(400).json({ error: "promotionalPush must be a boolean" });
  }
  let quietHoursPatch: { start: string | null; end: string | null; timezone?: string } | undefined;
  if (quietHours !== undefined) {
    if (quietHours === null) {
      quietHoursPatch = { start: null, end: null };
    } else {
      const { start, end, timezone } = quietHours;
      const bothUnset = start === null && end === null;
      if (!bothUnset && (!isValidTimeOfDay(start) || !isValidTimeOfDay(end))) {
        return res.status(400).json({ error: "quietHours.start and quietHours.end must be \"HH:MM\" (or both null to disable)" });
      }
      if (timezone !== undefined && typeof timezone !== "string") {
        return res.status(400).json({ error: "quietHours.timezone must be a string" });
      }
      quietHoursPatch = {
        start: bothUnset ? null : (start as string),
        end: bothUnset ? null : (end as string),
        timezone: typeof timezone === "string" ? timezone : undefined,
      };
    }
  }
  if (digest === undefined && categories === undefined && channels === undefined && pushEnabled === undefined && promotionalPush === undefined && quietHoursPatch === undefined) {
    return res.status(400).json({ error: "digest, categories, channels, pushEnabled, promotionalPush, or quietHours is required" });
  }

  try {
    const [current] = await db
      .select({ accountType: users.accountType, preferences: users.notificationPreferences })
      .from(users)
      .where(eq(users.clerkId, clerkId))
      .limit(1);
    if (!current) return res.status(404).json({ error: "User not found" });

    const defaults = defaultsFor(current.accountType);
    const allowed = new Set(Object.keys(defaults));
    const patch: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(categories ?? {})) {
      if (!allowed.has(key) || typeof value !== "boolean") {
        return res.status(400).json({ error: `Invalid notification category: ${key}` });
      }
      patch[key] = value;
    }
    for (const [channelName, map] of Object.entries(channels ?? {})) {
      if ((channelName !== "inApp" && channelName !== "email") || !map || typeof map !== "object" || Array.isArray(map)) {
        return res.status(400).json({ error: `Invalid notification channel: ${channelName}` });
      }
      for (const [typeKey, value] of Object.entries(map as Record<string, unknown>)) {
        const parsed = parseChannelKey(current.accountType, typeKey);
        if (!parsed || typeof value !== "boolean") {
          return res.status(400).json({ error: `Invalid notification type: ${typeKey}` });
        }
        patch[channelPrefKey(channelName, parsed.key)] = value;
      }
    }
    const merged = { ...defaults, ...(current.preferences ?? {}), ...patch };

    const updates: Record<string, unknown> = {
      notificationPreferences: merged,
      updatedAt: new Date(),
    };
    if (pushEnabled !== undefined) updates.pushEnabled = pushEnabled;
    if (promotionalPush !== undefined) updates.promoPushOptIn = promotionalPush;
    if (quietHoursPatch !== undefined) {
      updates.quietHoursStart = quietHoursPatch.start;
      updates.quietHoursEnd = quietHoursPatch.end;
      if (quietHoursPatch.timezone !== undefined) updates.quietHoursTimezone = quietHoursPatch.timezone;
    }
    await db.update(users).set(updates).where(eq(users.clerkId, clerkId));

    // Use raw SQL for the new column (not yet in the typed schema columns)
    if (digest !== undefined) {
      await db.execute(
        sql`UPDATE users SET notification_digest = ${digest} WHERE clerk_id = ${clerkId}`
      );
    }

    const [saved] = await db
      .select({
        digest: sql<string>`notification_digest`,
        pushEnabled: users.pushEnabled,
        quietHoursStart: users.quietHoursStart,
        quietHoursEnd: users.quietHoursEnd,
        quietHoursTimezone: users.quietHoursTimezone,
      })
      .from(users)
      .where(eq(users.clerkId, clerkId))
      .limit(1);

    return res.json({
      digest: (saved?.digest ?? digest ?? "realtime") as DigestMode,
      role: current.accountType === "seller" ? "seller" : "buyer",
      pushEnabled: saved?.pushEnabled ?? true,
      promotionalPush: await readPromoOptIn(clerkId),
      quietHours: {
        start: saved?.quietHoursStart ?? null,
        end: saved?.quietHoursEnd ?? null,
        timezone: saved?.quietHoursTimezone ?? "UTC",
      },
      categories: merged,
      channels: channelView(current.accountType, merged),
    });
  } catch (err) {
    req.log.error({ err, clerkId }, "Failed to update notification preferences");
    return res.status(500).json({ error: "Failed to update notification preferences" });
  }
});

export default router;
