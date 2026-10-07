/**
 * Live purchase attribution: which live stream an order was bought from.
 *
 * The app sends the stream id with a checkout started from a live (the
 * in-stream purchase sheet, the live Shop sheet, or a cart line added from a
 * live). The id is never trusted as-is. It is attributed only when:
 *   - the stream exists;
 *   - it belongs to the order's seller, or that seller was an accepted
 *     co-host of it (co-host rows record when they joined and left);
 *   - the purchase happened while the stream (and, for a co-host, their
 *     time on stage) was live, or within LIVE_ATTRIBUTION_GRACE_MS after.
 * Anything else is silently dropped — a bad or stale id never fails a
 * checkout. Checked when the checkout is created (stored on
 * checkout_sessions) and again with the payment time by the paid webhook,
 * which copies it onto orders.source_live_stream_id.
 *
 * Once the order exists, announceLivePurchase() tells the live room
 * (`{ type: "purchase" }` over ws/liveHub.ts): the host sees
 * "<first name> bought <product>", viewers see it as social proof.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { broadcastToRoom } from "../ws/liveHub";
import { logger } from "./logger";

/** How long after a live (or a co-host's time on stage) ends a purchase still counts. */
export const LIVE_ATTRIBUTION_GRACE_MS = 30 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AttributionStream {
  sellerId: string;
  status: string;
  startedAt: Date;
  endedAt: Date | null;
}

export interface AttributionCohostWindow {
  /** When the co-host accepted (went on stage). */
  respondedAt: Date | null;
  /** When they left / were removed / the stream ended them; null while on stage. */
  endedAt: Date | null;
}

export type AttributionDecision =
  | { ok: true; role: "host" | "cohost" }
  | { ok: false; reason: "seller" | "before_start" | "after_grace" };

function withinWindow(at: number, start: number, end: number | null, graceMs: number): "ok" | "before_start" | "after_grace" {
  if (at < start) return "before_start";
  if (end != null && at > end + graceMs) return "after_grace";
  return "ok";
}

/** Pure decision (unit-tested): may an order of `orderSellerId` paid at `at` be attributed to this stream? */
export function decideLiveAttribution(input: {
  stream: AttributionStream;
  orderSellerId: string;
  cohostWindows: AttributionCohostWindow[];
  at: Date;
  graceMs?: number;
}): AttributionDecision {
  const grace = input.graceMs ?? LIVE_ATTRIBUTION_GRACE_MS;
  const at = input.at.getTime();
  const streamEnd = input.stream.endedAt ? input.stream.endedAt.getTime() : null;
  if (input.stream.status !== "live" && streamEnd == null) return { ok: false, reason: "after_grace" };
  const streamWindow = withinWindow(at, input.stream.startedAt.getTime(), streamEnd, grace);
  if (streamWindow !== "ok") return { ok: false, reason: streamWindow };
  if (input.stream.sellerId === input.orderSellerId) return { ok: true, role: "host" };

  let lastReason: "seller" | "before_start" | "after_grace" = "seller";
  for (const w of input.cohostWindows) {
    if (!w.respondedAt) continue;
    const end = w.endedAt ? w.endedAt.getTime() : streamEnd;
    const verdict = withinWindow(at, w.respondedAt.getTime(), end, grace);
    if (verdict === "ok") return { ok: true, role: "cohost" };
    lastReason = verdict;
  }
  return { ok: false, reason: lastReason };
}

/**
 * Returns the stream id when an order of `sellerId` made at `at` may be
 * attributed to `streamId`, otherwise null. Never throws for bad input.
 */
export async function resolveLiveAttribution(streamId: unknown, sellerId: string, at: Date = new Date()): Promise<string | null> {
  if (typeof streamId !== "string" || !UUID_RE.test(streamId) || !sellerId) return null;
  try {
    const [stream] = await db.execute(sql`
      SELECT seller_id, status, started_at, ended_at FROM live_streams WHERE id = ${streamId}::uuid LIMIT 1
    `).then((r) => r.rows as Array<{ seller_id: string; status: string; started_at: string | Date; ended_at: string | Date | null }>);
    if (!stream) return null;
    let cohostWindows: AttributionCohostWindow[] = [];
    if (stream.seller_id !== sellerId) {
      const rows = await db.execute(sql`
        SELECT responded_at, ended_at FROM live_cohosts
        WHERE stream_id = ${streamId}::uuid AND cohost_id = ${sellerId}
          AND status IN ('accepted', 'removed', 'left') AND responded_at IS NOT NULL
      `);
      cohostWindows = (rows.rows as any[]).map((r) => ({
        respondedAt: r.responded_at ? new Date(r.responded_at) : null,
        endedAt: r.ended_at ? new Date(r.ended_at) : null,
      }));
      if (cohostWindows.length === 0) return null;
    }
    const decision = decideLiveAttribution({
      stream: {
        sellerId: stream.seller_id,
        status: stream.status,
        startedAt: new Date(stream.started_at),
        endedAt: stream.ended_at ? new Date(stream.ended_at) : null,
      },
      orderSellerId: sellerId,
      cohostWindows,
      at,
    });
    return decision.ok ? streamId : null;
  } catch (err) {
    logger.warn({ err, streamId }, "Live attribution check failed; order not attributed");
    return null;
  }
}

/** First stream id found among checkout items' per-line live source (cart lines added from a live). */
export function liveStreamIdFromItems(items: unknown): string | null {
  if (!Array.isArray(items)) return null;
  for (const item of items) {
    const id = (item as any)?.sourceLiveStreamId;
    if (typeof id === "string" && UUID_RE.test(id)) return id;
  }
  return null;
}

/**
 * Tells the live room a purchase from it was just paid. Buyer first name
 * only (never a surname, handle or amount paid). Safe to call for any order:
 * a no-op unless the order carries a source live stream.
 */
export async function announceLivePurchase(orderId: string): Promise<void> {
  try {
    const [row] = await db.execute(sql`
      SELECT o.source_live_stream_id AS stream_id, o.owner_id, o.buyer_id,
             COALESCE(NULLIF(split_part(trim(COALESCE(NULLIF(u.display_name, ''), u.name, '')), ' ', 1), ''), 'Someone') AS first_name,
             (SELECT oi.product_name FROM order_items oi WHERE oi.order_id = o.id ORDER BY oi.price_cents * oi.quantity DESC LIMIT 1) AS product_name,
             (SELECT COALESCE(SUM(oi.quantity), 0)::int FROM order_items oi WHERE oi.order_id = o.id) AS units
      FROM orders o LEFT JOIN users u ON u.clerk_id = o.buyer_id
      WHERE o.id = ${orderId}::uuid AND o.source_live_stream_id IS NOT NULL
      LIMIT 1
    `).then((r) => r.rows as any[]);
    if (!row?.stream_id) return;
    broadcastToRoom(String(row.stream_id), {
      type: "purchase",
      purchase: {
        id: orderId,
        buyerFirstName: String(row.first_name),
        productName: row.product_name ? String(row.product_name) : "an item",
        units: Number(row.units) || 1,
        sellerId: String(row.owner_id),
        at: new Date().toISOString(),
      },
    });
  } catch (err) {
    logger.warn({ err, orderId }, "Live purchase announcement failed");
  }
}
