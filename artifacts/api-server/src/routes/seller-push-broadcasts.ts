/**
 * Seller follower push broadcasts.
 * Mounted at /api/seller/push-broadcasts (team context applied in routes/index.ts).
 *
 * GET  /            -> { canSendNow, nextSendAt, audience, history[] }
 * POST /preview     -> validates + moderates, returns the rendered notification and audience size (sends nothing)
 * POST /            -> sends (1 per seller per rolling 24h, enforced atomically)
 * GET  /:id         -> results for one broadcast (recipients, sent, opened)
 */
import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, sellerPushBroadcasts } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { requirePermission } from "../middlewares/requireRole";
import { rateLimit } from "../middlewares/rateLimit";
import {
  broadcastWindow,
  claimBroadcastSlot,
  countOpens,
  deeplinkBelongsToSeller,
  deliverBroadcast,
  latestBroadcast,
  moderateBroadcastText,
  resolveAudience,
  validateBroadcastInput,
  BROADCAST_BODY_MAX,
  BROADCAST_TITLE_MAX,
  type BroadcastInput,
} from "../lib/sellerPushBroadcast";

const router = Router();
router.use(requireAuth);

function adapt(row: typeof sellerPushBroadcasts.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    deeplinkType: row.deeplinkType,
    deeplinkId: row.deeplinkId,
    status: row.status,
    recipientCount: row.recipientCount,
    sentCount: row.sentCount,
    skippedCount: row.skippedCount,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

async function parseAndCheck(sellerId: string, raw: unknown):
  Promise<{ ok: true; value: BroadcastInput } | { ok: false; status: number; error: string; code?: string }> {
  const parsed = validateBroadcastInput(raw);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error, code: "INVALID_BROADCAST" };
  const moderation = moderateBroadcastText(parsed.value);
  if (!moderation.ok) {
    return { ok: false, status: 422, error: "This message can't be sent because it breaks the community guidelines. Edit it and try again.", code: "CONTENT_REJECTED" };
  }
  if (parsed.value.deeplinkType && parsed.value.deeplinkId) {
    const owns = await deeplinkBelongsToSeller(sellerId, parsed.value.deeplinkType, parsed.value.deeplinkId);
    if (!owns) return { ok: false, status: 400, error: "You can only link to your own product, drop or post.", code: "INVALID_LINK" };
  }
  return { ok: true, value: parsed.value };
}

router.get("/", requirePermission("marketing"), async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const [history, audience] = await Promise.all([
      db.select().from(sellerPushBroadcasts)
        .where(eq(sellerPushBroadcasts.sellerId, sellerId))
        .orderBy(desc(sellerPushBroadcasts.createdAt)).limit(20),
      resolveAudience(sellerId),
    ]);
    const window = broadcastWindow(history[0]?.createdAt);
    res.json({
      canSendNow: window.canSend,
      nextSendAt: window.nextAt?.toISOString() ?? null,
      limits: { titleMax: BROADCAST_TITLE_MAX, bodyMax: BROADCAST_BODY_MAX },
      audience: { followers: audience.followers, recipients: audience.recipientIds.length },
      history: history.map(adapt),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load seller push broadcasts");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/preview", requirePermission("marketing"), rateLimit("mutation"), async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const checked = await parseAndCheck(sellerId, req.body);
    if (!checked.ok) { res.status(checked.status).json({ error: checked.error, code: checked.code }); return; }
    const [audience, last] = await Promise.all([resolveAudience(sellerId), latestBroadcast(sellerId)]);
    const window = broadcastWindow(last?.createdAt);
    res.json({
      notification: { title: checked.value.title, body: checked.value.body },
      deeplinkType: checked.value.deeplinkType,
      deeplinkId: checked.value.deeplinkId,
      audience: { followers: audience.followers, recipients: audience.recipientIds.length },
      canSendNow: window.canSend,
      nextSendAt: window.nextAt?.toISOString() ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to preview seller push broadcast");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", requirePermission("marketing"), rateLimit("mutation"), async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const checked = await parseAndCheck(sellerId, req.body);
    if (!checked.ok) { res.status(checked.status).json({ error: checked.error, code: checked.code }); return; }

    const claim = await claimBroadcastSlot(sellerId, checked.value);
    if (!claim.ok) {
      res.setHeader("Retry-After", String(claim.retryAfterSec));
      res.status(429).json({
        error: "You can send one follower push every 24 hours.",
        code: "BROADCAST_RATE_LIMITED",
        nextSendAt: claim.nextAt.toISOString(),
        retryAfterSec: claim.retryAfterSec,
      });
      return;
    }

    const delivery = await deliverBroadcast(claim.id, sellerId, checked.value);
    const [row] = await db.select().from(sellerPushBroadcasts).where(eq(sellerPushBroadcasts.id, claim.id)).limit(1);
    res.status(201).json({
      broadcast: adapt(row),
      delivery,
      nextSendAt: new Date(claim.createdAt.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to send seller push broadcast");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id", requirePermission("marketing"), async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const id = String(req.params.id);
    if (!/^[0-9a-f-]{36}$/i.test(id)) { res.status(404).json({ error: "Broadcast not found" }); return; }
    const [row] = await db.select().from(sellerPushBroadcasts)
      .where(and(eq(sellerPushBroadcasts.id, id), eq(sellerPushBroadcasts.sellerId, sellerId))).limit(1);
    if (!row) { res.status(404).json({ error: "Broadcast not found" }); return; }
    const opened = await countOpens(sellerId, row.createdAt);
    res.json({ ...adapt(row), opened });
  } catch (err) {
    req.log.error({ err }, "Failed to load seller push broadcast");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
