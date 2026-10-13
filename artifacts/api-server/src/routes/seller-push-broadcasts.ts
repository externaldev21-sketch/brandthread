/**
 * Seller push broadcasts: to followers, or to past buyers.
 * Mounted at /api/seller/push-broadcasts (team context applied in routes/index.ts).
 *
 * GET  /            -> { canSendNow, nextSendAt, audience, pastBuyers, history[] }
 *                      (top-level canSendNow/nextSendAt/audience are the follower push, unchanged)
 * POST /preview     -> validates + moderates, returns the rendered notification and audience size (sends nothing)
 * POST /            -> sends. `audience`: 'followers' (default; 1 per seller per rolling 24h) or
 *                      'past_buyers' (1 per seller per rolling 7 days, at most PAST_BUYER_RECIPIENT_CAP
 *                      recipients). Each cap is enforced atomically.
 * GET  /:id         -> results for one broadcast (recipients, sent, opened)
 */
import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, sellerPushBroadcasts } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { requirePermission } from "../middlewares/requireRole";
import { rateLimit } from "../middlewares/rateLimit";
import {
  audienceSummary,
  audienceWindowMs,
  broadcastWindow,
  claimBroadcastSlot,
  countOpens,
  deeplinkBelongsToSeller,
  deliverBroadcast,
  latestBroadcast,
  moderateBroadcastText,
  parseAudience,
  validateBroadcastInput,
  BROADCAST_BODY_MAX,
  BROADCAST_TITLE_MAX,
  PAST_BUYER_RECIPIENT_CAP,
  type BroadcastAudience,
  type BroadcastInput,
} from "../lib/sellerPushBroadcast";
import { boundedBody, cappedUnknown, validateBody } from "../middlewares/bodySchemas";

const router = Router();

// Shape + size guards; validateBroadcastInput keeps the title/body/deeplink rules.
const broadcastBody = boundedBody({
  title:        cappedUnknown(5_000),
  body:         cappedUnknown(20_000),
  deeplinkType: cappedUnknown(100),
  deeplinkId:   cappedUnknown(200),
}, 100_000);
router.use(requireAuth);

function adapt(row: typeof sellerPushBroadcasts.$inferSelect) {
  return {
    id: row.id,
    audience: row.audience,
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
  Promise<{ ok: true; value: BroadcastInput; audience: BroadcastAudience } | { ok: false; status: number; error: string; code?: string }> {
  const audience = parseAudience((raw as Record<string, unknown> | null)?.audience);
  if (!audience) return { ok: false, status: 400, error: "Choose followers or past buyers.", code: "INVALID_AUDIENCE" };
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
  return { ok: true, value: parsed.value, audience };
}

router.get("/", requirePermission("marketing"), async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const [history, followers, pastBuyers, lastFollowers, lastPastBuyers] = await Promise.all([
      db.select().from(sellerPushBroadcasts)
        .where(eq(sellerPushBroadcasts.sellerId, sellerId))
        .orderBy(desc(sellerPushBroadcasts.createdAt)).limit(20),
      audienceSummary(sellerId, "followers"),
      audienceSummary(sellerId, "past_buyers"),
      latestBroadcast(sellerId, "followers"),
      latestBroadcast(sellerId, "past_buyers"),
    ]);
    const window = broadcastWindow(lastFollowers?.createdAt);
    const pbWindow = broadcastWindow(lastPastBuyers?.createdAt, new Date(), audienceWindowMs("past_buyers"));
    res.json({
      canSendNow: window.canSend,
      nextSendAt: window.nextAt?.toISOString() ?? null,
      limits: { titleMax: BROADCAST_TITLE_MAX, bodyMax: BROADCAST_BODY_MAX, pastBuyerRecipientCap: PAST_BUYER_RECIPIENT_CAP },
      audience: followers,
      pastBuyers: {
        canSendNow: pbWindow.canSend,
        nextSendAt: pbWindow.nextAt?.toISOString() ?? null,
        audience: pastBuyers,
      },
      history: history.map(adapt),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load seller push broadcasts");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/preview", requirePermission("marketing"), rateLimit("mutation"), validateBody(broadcastBody), async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const checked = await parseAndCheck(sellerId, req.body);
    if (!checked.ok) { res.status(checked.status).json({ error: checked.error, code: checked.code }); return; }
    const [audience, last] = await Promise.all([
      audienceSummary(sellerId, checked.audience),
      latestBroadcast(sellerId, checked.audience),
    ]);
    const window = broadcastWindow(last?.createdAt, new Date(), audienceWindowMs(checked.audience));
    res.json({
      notification: { title: checked.value.title, body: checked.value.body },
      deeplinkType: checked.value.deeplinkType,
      deeplinkId: checked.value.deeplinkId,
      audienceType: checked.audience,
      audience,
      canSendNow: window.canSend,
      nextSendAt: window.nextAt?.toISOString() ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to preview seller push broadcast");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", requirePermission("marketing"), rateLimit("mutation"), validateBody(broadcastBody), async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const checked = await parseAndCheck(sellerId, req.body);
    if (!checked.ok) { res.status(checked.status).json({ error: checked.error, code: checked.code }); return; }

    const claim = await claimBroadcastSlot(sellerId, checked.value, new Date(), checked.audience);
    if (!claim.ok) {
      res.setHeader("Retry-After", String(claim.retryAfterSec));
      res.status(429).json({
        error: checked.audience === "past_buyers"
          ? "You can message past buyers once every 7 days."
          : "You can send one follower push every 24 hours.",
        code: "BROADCAST_RATE_LIMITED",
        audienceType: checked.audience,
        nextSendAt: claim.nextAt.toISOString(),
        retryAfterSec: claim.retryAfterSec,
      });
      return;
    }

    const delivery = await deliverBroadcast(claim.id, sellerId, checked.value, checked.audience);
    const [row] = await db.select().from(sellerPushBroadcasts).where(eq(sellerPushBroadcasts.id, claim.id)).limit(1);
    res.status(201).json({
      broadcast: adapt(row),
      delivery,
      audienceType: checked.audience,
      nextSendAt: new Date(claim.createdAt.getTime() + audienceWindowMs(checked.audience)).toISOString(),
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
    const opened = await countOpens(sellerId, row.createdAt, {
      title: row.title,
      body: row.body,
      audience: row.audience === "past_buyers" ? "past_buyers" : "followers",
    });
    res.json({ ...adapt(row), opened });
  } catch (err) {
    req.log.error({ err }, "Failed to load seller push broadcast");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
