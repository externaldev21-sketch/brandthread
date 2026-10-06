import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "../lib/logger";

const INTERVAL_MS = 5 * 60 * 1000;
/** A product-tag tap counts toward an order placed up to this long afterwards. */
export const ATTRIBUTION_WINDOW_DAYS = 7;
/** Only recently paid orders are (re)considered, so each run stays cheap. */
const LOOKBACK_HOURS = 48;

/**
 * Post → order attribution for seller Content Analytics.
 *
 * `orders.source_post_id` drives a post's "conversions" and attributed
 * revenue (GET /api/posts/:id/analytics, the Content Analytics report), but
 * neither checkout path carries the post a buyer shopped from — so the
 * column was always null and every post showed 0 sales.
 *
 * Every product-tag tap on a post records an `interactions` row
 * (type `shop_click`, value = the tapped product id; see
 * ShopProductSheet). This job credits a paid order to the post whose tag
 * the SAME buyer tapped most recently, for a product in that order, owned
 * by the order's seller, within ATTRIBUTION_WINDOW_DAYS before payment —
 * last-click attribution, the same rule Instagram/TikTok Shop use for
 * "orders from this post". Idempotent and safe to run on several
 * instances at once: it only ever fills a NULL column.
 */
export async function runOrderPostAttribution(now = new Date()): Promise<number> {
  const result = await db.execute(sql`
    UPDATE orders o
       SET source_post_id = pick.post_id::text
      FROM (
        SELECT DISTINCT ON (o2.id) o2.id AS order_id, i.post_id
          FROM orders o2
          JOIN order_items oi ON oi.order_id = o2.id
          JOIN product_variants pv ON pv.id = oi.variant_id
          JOIN interactions i
            ON i.user_id = o2.buyer_id
           AND i.type = 'shop_click'
           AND i.value = pv.product_id::text
           AND i.created_at <= o2.paid_at
           AND i.created_at >= o2.paid_at - make_interval(days => ${ATTRIBUTION_WINDOW_DAYS})
          JOIN posts p ON p.id = i.post_id AND p.user_id = o2.owner_id
         WHERE o2.source_post_id IS NULL
           AND o2.buyer_id IS NOT NULL
           AND o2.paid_at IS NOT NULL
           AND o2.paid_at >= ${now}::timestamp - make_interval(hours => ${LOOKBACK_HOURS})
         ORDER BY o2.id, i.created_at DESC
      ) pick
     WHERE o.id = pick.order_id
       AND o.source_post_id IS NULL
  `);
  const updated = Number((result as { rowCount?: number }).rowCount ?? 0);
  if (updated > 0) logger.info({ job: "orderPostAttribution", updated }, "Orders attributed to source posts");
  return updated;
}

export function startOrderPostAttributionJob(): void {
  const run = () => void runOrderPostAttribution().catch((err) =>
    logger.error({ err, job: "orderPostAttribution" }, "Order post attribution job failed"));
  setTimeout(run, 45_000).unref?.();
  setInterval(run, INTERVAL_MS).unref?.();
  logger.info({ job: "orderPostAttribution", intervalMs: INTERVAL_MS }, "Order post attribution job scheduled");
}
