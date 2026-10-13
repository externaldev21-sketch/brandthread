/**
 * "X just bought …" in a live.
 *
 * 1. Checkout (routes/checkout-intent.ts, routes/buyer.ts) already receives the
 *    live the buyer is shopping from (`liveStreamId`). recordLiveCheckout()
 *    links that checkout to the live — only when the group's seller is selling
 *    in that live right now (the host, or a co-host on stage).
 * 2. When the order is paid (routes/webhooks.ts handleCheckoutPaid),
 *    announceLivePurchase() stamps the link once and broadcasts a `purchase`
 *    event to the live's room. Pager clients that poll read the same rows via
 *    listLiveActivity().
 *
 * Privacy: only a first name or @handle and the product title are shown.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { broadcastToRoom } from "../ws/liveHub";
import { logger } from "./logger";
import { isSellerInLive } from "./liveBag";
import { giftText, publicBuyerName, purchaseText } from "./liveShopping";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function recordLiveCheckout(input: {
  checkoutSessionId: string;
  streamId: string | null | undefined;
  buyerId: string | null | undefined;
  sellerId: string;
}): Promise<boolean> {
  const { checkoutSessionId, streamId, buyerId, sellerId } = input;
  if (!streamId || !UUID_RE.test(streamId) || !buyerId) return false;
  try {
    if (!(await isSellerInLive(streamId, sellerId))) return false;
    await db.execute(sql`
      INSERT INTO live_stream_orders (checkout_session_id, stream_id, buyer_id, seller_id)
      VALUES (${checkoutSessionId}::uuid, ${streamId}::uuid, ${buyerId}, ${sellerId})
      ON CONFLICT (checkout_session_id) DO NOTHING
    `);
    return true;
  } catch (err) {
    logger.warn({ err, checkoutSessionId }, "Could not link checkout to live");
    return false;
  }
}

export interface LiveActivity {
  id: string;
  kind: "purchase" | "gift";
  name: string;
  text: string;
  at: string;
}

/**
 * Called once an order exists for a paid checkout. Idempotent: the link is
 * stamped the first time only, so a webhook retry never announces twice.
 */
export async function announceLivePurchase(checkoutSessionId: string, orderId: string): Promise<LiveActivity | null> {
  try {
    const claimed = await db.execute(sql`
      UPDATE live_stream_orders SET order_id = ${orderId}::uuid, announced_at = now()
      WHERE checkout_session_id = ${checkoutSessionId}::uuid AND announced_at IS NULL
      RETURNING id, stream_id, buyer_id, announced_at
    `);
    const link = claimed.rows[0] as any;
    if (!link) return null;
    const detail = await db.execute(sql`
      SELECT u.display_name, u.name, u.username, cs.items
      FROM checkout_sessions cs LEFT JOIN users u ON u.clerk_id = ${link.buyer_id}
      WHERE cs.id = ${checkoutSessionId}::uuid
    `);
    const d = detail.rows[0] as any;
    const items: Array<{ productName?: string }> = Array.isArray(d?.items) ? d.items : [];
    const activity: LiveActivity = {
      id: `purchase-${link.id}`,
      kind: "purchase",
      name: publicBuyerName({ displayName: d?.display_name ?? d?.name, username: d?.username }),
      text: purchaseText(items.map((i) => String(i.productName ?? ""))),
      at: new Date(link.announced_at).toISOString(),
    };
    broadcastToRoom(String(link.stream_id), { type: "purchase", purchase: activity });
    return activity;
  } catch (err) {
    logger.warn({ err, checkoutSessionId }, "Live purchase announcement failed");
    return null;
  }
}

/** Purchases and gifts in a live after `since` (oldest first, at most 20). */
export async function listLiveActivity(streamId: string, since: Date): Promise<LiveActivity[]> {
  const rows = await db.execute(sql`
    SELECT * FROM (
      SELECT 'purchase' AS kind, lso.id::text AS id, lso.announced_at AS at,
             u.display_name, u.name, u.username, cs.items::jsonb AS items, NULL::int AS gross_cents
      FROM live_stream_orders lso
      JOIN checkout_sessions cs ON cs.id = lso.checkout_session_id
      LEFT JOIN users u ON u.clerk_id = lso.buyer_id
      WHERE lso.stream_id = ${streamId}::uuid AND lso.announced_at > ${since.toISOString()}::timestamptz
      UNION ALL
      SELECT 'gift' AS kind, f.id::text AS id, f.created_at AS at,
             u.display_name, u.name, u.username, NULL::jsonb AS items, f.gross_cents
      FROM live_gift_platform_fees f
      LEFT JOIN users u ON u.clerk_id = f.buyer_id
      WHERE f.stream_id = ${streamId} AND f.created_at > ${since.toISOString()}::timestamptz
    ) a
    ORDER BY at ASC
    LIMIT 20
  `);
  return (rows.rows as any[]).map((r) => {
    const name = publicBuyerName({ displayName: r.display_name ?? r.name, username: r.username });
    if (r.kind === "gift") {
      return { id: `gift-${r.id}`, kind: "gift" as const, name, text: giftText(Number(r.gross_cents)), at: new Date(r.at).toISOString() };
    }
    const items: Array<{ productName?: string }> = Array.isArray(r.items) ? r.items : [];
    return {
      id: `purchase-${r.id}`, kind: "purchase" as const, name,
      text: purchaseText(items.map((i) => String(i.productName ?? ""))), at: new Date(r.at).toISOString(),
    };
  });
}

export { giftText };
