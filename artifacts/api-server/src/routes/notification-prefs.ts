/**
 * Notification preference routes for sellers and buyers.
 * Mounted at /api/notification-prefs and /api/seller/notification-prefs.
 *
 * Endpoints
 * ─────────
 * GET  /api/seller/notification-prefs   → { digest: 'realtime' | 'daily' }
 * PUT  /api/seller/notification-prefs   ← { digest: 'realtime' | 'daily' }
 */

import { Router } from "express";
import { db, users } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();
router.use(requireAuth);

const VALID_DIGEST = ["realtime", "daily"] as const;
type DigestMode = typeof VALID_DIGEST[number];
const BUYER_DEFAULTS = {
  new_drops: true,
  messages: true,
  order_updates: true,
  friend_activity: true,
};
const SELLER_DEFAULTS = {
  new_orders: true,
  production_milestones: true,
  payout_confirmations: true,
  customer_messages: true,
  disputes: true,
};

function defaultsFor(accountType: string | null | undefined) {
  return accountType === "seller" ? SELLER_DEFAULTS : BUYER_DEFAULTS;
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
      })
      .from(users)
      .where(eq(users.clerkId, clerkId))
      .limit(1);

    const role = row?.accountType === "seller" ? "seller" : "buyer";
    return res.json({
      digest: (row?.digest ?? "realtime") as DigestMode,
      role,
      categories: { ...defaultsFor(row?.accountType), ...(row?.preferences ?? {}) },
    });
  } catch (err) {
    console.error("GET /notification-prefs error:", err);
    return res.status(500).json({ error: "Failed to fetch notification preferences" });
  }
});

// ── PUT /api/seller/notification-prefs ───────────────────────────────────────
router.put("/", async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const { digest, categories } = req.body as {
    digest?: string;
    categories?: Record<string, unknown>;
  };
  if (digest !== undefined && !VALID_DIGEST.includes(digest as DigestMode)) {
    res.status(400).json({ error: `digest must be one of: ${VALID_DIGEST.join(", ")}` });
    return;
  }
  if (categories !== undefined && (!categories || typeof categories !== "object" || Array.isArray(categories))) {
    return res.status(400).json({ error: "categories must be an object" });
  }
  if (digest === undefined && categories === undefined) {
    return res.status(400).json({ error: "digest or categories is required" });
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
    const merged = { ...defaults, ...(current.preferences ?? {}), ...patch };

    await db.update(users).set({
      notificationPreferences: merged,
      updatedAt: new Date(),
    }).where(eq(users.clerkId, clerkId));

    // Use raw SQL for the new column (not yet in the typed schema columns)
    if (digest !== undefined) {
      await db.execute(
        sql`UPDATE users SET notification_digest = ${digest} WHERE clerk_id = ${clerkId}`
      );
    }

    return res.json({
      digest: (digest ?? "realtime") as DigestMode,
      role: current.accountType === "seller" ? "seller" : "buyer",
      categories: merged,
    });
  } catch (err) {
    console.error("PUT /notification-prefs error:", err);
    return res.status(500).json({ error: "Failed to update notification preferences" });
  }
});

export default router;
