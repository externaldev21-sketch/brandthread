/**
 * Notification preference routes for sellers and buyers.
 * Mounted at /api/seller/notification-prefs
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

// ── GET /api/seller/notification-prefs ───────────────────────────────────────
router.get("/", async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  try {
    const [row] = await db
      .select({ digest: sql<string>`notification_digest` })
      .from(users)
      .where(eq(users.clerkId, clerkId))
      .limit(1);

    res.json({ digest: (row?.digest ?? "realtime") as DigestMode });
  } catch (err) {
    console.error("GET /notification-prefs error:", err);
    res.status(500).json({ error: "Failed to fetch notification preferences" });
  }
});

// ── PUT /api/seller/notification-prefs ───────────────────────────────────────
router.put("/", async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const { digest } = req.body as { digest?: string };

  if (!digest || !VALID_DIGEST.includes(digest as DigestMode)) {
    res.status(400).json({ error: `digest must be one of: ${VALID_DIGEST.join(", ")}` });
    return;
  }

  try {
    await db
      .update(users)
      .set({ updatedAt: new Date() })
      .where(eq(users.clerkId, clerkId));

    // Use raw SQL for the new column (not yet in the typed schema columns)
    await db.execute(
      sql`UPDATE users SET notification_digest = ${digest} WHERE clerk_id = ${clerkId}`
    );

    res.json({ digest });
  } catch (err) {
    console.error("PUT /notification-prefs error:", err);
    res.status(500).json({ error: "Failed to update notification preferences" });
  }
});

export default router;
