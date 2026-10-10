/**
 * iOS Live Activity push-token registration (lib/liveActivityPush.ts).
 *
 *  POST   /api/live-activities/tokens         { kind, targetId, token } — upsert
 *  DELETE /api/live-activities/tokens/:token  deactivate the caller's token
 *
 * kind 'order': targetId is an order the caller bought.
 * kind 'live':  targetId is a live stream the caller is hosting.
 *
 * Mounted without team context: an order tracker belongs to the buyer
 * themself, and a stream to the account that started it.
 */
import { Router } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, liveActivityTokens, liveStreams, orders } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

const router = Router();

export const registerLiveActivityTokenSchema = z.object({
  kind: z.enum(["order", "live"]),
  targetId: z.string().uuid(),
  // ActivityKit push tokens are hex strings (currently 64–160 chars).
  token: z.string().trim().regex(/^[0-9a-fA-F]{32,512}$/, "token must be a hex APNs push token"),
}).strict();

async function callerOwnsTarget(userId: string, kind: "order" | "live", targetId: string): Promise<boolean> {
  if (kind === "order") {
    const [order] = await db.select({ buyerId: orders.buyerId })
      .from(orders).where(eq(orders.id, targetId)).limit(1);
    return !!order && order.buyerId === userId;
  }
  const [stream] = await db.select({ sellerId: liveStreams.sellerId })
    .from(liveStreams).where(eq(liveStreams.id, targetId)).limit(1);
  return !!stream && stream.sellerId === userId;
}

router.post("/tokens", requireAuth, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const parsed = registerLiveActivityTokenSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid Live Activity token", issues: parsed.error.issues });
    return;
  }
  const { kind, targetId } = parsed.data;
  const token = parsed.data.token.toLowerCase();
  try {
    if (!(await callerOwnsTarget(userId, kind, targetId))) {
      res.status(404).json({ error: kind === "order" ? "Order not found" : "Live stream not found" });
      return;
    }
    // A token is unique per activity; re-registering moves it to this
    // caller/target and reactivates it.
    await db.insert(liveActivityTokens)
      .values({ userId, kind, targetId, token })
      .onConflictDoUpdate({
        target: liveActivityTokens.token,
        set: { userId, kind, targetId, active: true, updatedAt: new Date() },
      });
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, kind }, "Live Activity token registration failed");
    res.status(500).json({ error: "Could not register Live Activity token" });
  }
});

router.delete("/tokens/:token", requireAuth, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const token = String(req.params.token ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{32,512}$/.test(token)) {
    res.status(400).json({ error: "token must be a hex APNs push token" });
    return;
  }
  try {
    await db.update(liveActivityTokens)
      .set({ active: false, updatedAt: new Date() })
      .where(and(eq(liveActivityTokens.token, token), eq(liveActivityTokens.userId, userId)));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Live Activity token deactivation failed");
    res.status(500).json({ error: "Could not deactivate Live Activity token" });
  }
});

export default router;
