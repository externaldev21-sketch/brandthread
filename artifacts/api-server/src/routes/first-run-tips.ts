/**
 * First-run tips (migration 110) — server-side "seen" tracking for the
 * reusable <FirstRunTip> system (gesture hints, spotlight coach marks,
 * anchored cards, full-screen gesture sheets). Source of truth so a tip
 * already dismissed on one device never replays after a reinstall or on a
 * new device. See artifacts/mobile/lib/firstRunTips for the client-side
 * local cache + reconcile logic.
 *
 * Mounted at /api/first-run-tips.
 *   GET  /seen        — { seenTipIds: string[], skipAll: boolean }
 *   POST /:tipId/seen — mark one tip id as seen for this account (idempotent)
 *   POST /skip-all     — suppress every future first-run tip for this account
 *   POST /reset         — "Replay tips": clears all seen state and skipAll
 */
import { Router } from "express";
import { db, firstRunTipsSeen, firstRunTipsSettings } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();
router.use(requireAuth);

router.get("/seen", async (req, res) => {
  const userId = (req as any).clerkUserId as string;

  const [seenRows, [settingsRow]] = await Promise.all([
    db.select({ tipId: firstRunTipsSeen.tipId }).from(firstRunTipsSeen)
      .where(eq(firstRunTipsSeen.userId, userId)),
    db.select({ skipAll: firstRunTipsSettings.skipAll }).from(firstRunTipsSettings)
      .where(eq(firstRunTipsSettings.userId, userId)).limit(1),
  ]);

  return res.json({
    seenTipIds: seenRows.map((r) => r.tipId),
    skipAll: settingsRow?.skipAll ?? false,
  });
});

router.post("/:tipId/seen", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { tipId } = req.params;
  if (!tipId) return res.status(400).json({ error: "tipId required" });

  await db.insert(firstRunTipsSeen)
    .values({ userId, tipId })
    .onConflictDoNothing({ target: [firstRunTipsSeen.userId, firstRunTipsSeen.tipId] });

  return res.status(204).end();
});

router.post("/skip-all", async (req, res) => {
  const userId = (req as any).clerkUserId as string;

  await db.insert(firstRunTipsSettings)
    .values({ userId, skipAll: true })
    .onConflictDoUpdate({
      target: firstRunTipsSettings.userId,
      set: { skipAll: true, updatedAt: new Date() },
    });

  return res.status(204).end();
});

router.post("/reset", async (req, res) => {
  const userId = (req as any).clerkUserId as string;

  await Promise.all([
    db.delete(firstRunTipsSeen).where(eq(firstRunTipsSeen.userId, userId)),
    db.insert(firstRunTipsSettings)
      .values({ userId, skipAll: false })
      .onConflictDoUpdate({
        target: firstRunTipsSettings.userId,
        set: { skipAll: false, updatedAt: new Date() },
      }),
  ]);

  return res.status(204).end();
});

export default router;
