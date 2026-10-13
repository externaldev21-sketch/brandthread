/**
 * Weekly followed-brands digest — Sunday 18:00–18:59 in the buyer's own
 * timezone (lib/userTimezone.ts).
 *
 * Every 10 minutes: page through buyers who follow at least one seller, have
 * an active push token and have opted in to promotional pushes (the digest is
 * promotional, lib/pushPolicy.ts). For those whose local time is in the
 * window, count the last 7 days of new published products, drops and posts
 * from the sellers they follow (a few grouped queries per page, never one per
 * follower) and send one push. Buyers with nothing new are skipped: no empty
 * digest.
 *
 * Claim-before-notify: a retention_push_log row (user, 'weekly_digest',
 * buyer-local ISO week) is inserted before sending. Only the run that inserts
 * it sends, so overlapping runs and replicas never double-send. A failed send
 * releases the claim so the next run in the window retries.
 */
import { db, retentionPushLog } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { publishNotification } from "../routes/notifications-feed";
import { buildWeeklyDigestCopy, type BrandActivity } from "../lib/retentionPushCopy";
import { isoWeekKey, isWeeklyDigestWindow, resolveUserTimezone } from "../lib/userTimezone";

const INTERVAL_MS = 10 * 60 * 1000;
const PAGE_SIZE = 1000;
export const DIGEST_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
export const WEEKLY_DIGEST_KIND = "weekly_digest";

type Candidate = { userId: string; userTimezone: string | null; streakTimezone: string | null; quietHoursTimezone: string | null };

/** Seller accounts that can still be shown: not deleted, suspended or leaving. */
const LIVE_SELLER = sql`su.account_type IN ('seller', 'both')
  AND su.deleted_at IS NULL AND su.suspended_at IS NULL AND su.deletion_requested_at IS NULL`;

async function candidatePage(afterId: string): Promise<Candidate[]> {
  const result = await db.execute(sql`
    SELECT u.clerk_id AS "userId", u.timezone AS "userTimezone",
           s.timezone AS "streakTimezone", u.quiet_hours_timezone AS "quietHoursTimezone"
    FROM users u
    LEFT JOIN thread_cash_streaks s ON s.buyer_id = u.clerk_id
    WHERE u.clerk_id > ${afterId}
      AND COALESCE(u.account_type, 'buyer') <> 'seller'
      AND u.deleted_at IS NULL AND u.suspended_at IS NULL AND u.deletion_requested_at IS NULL
      AND u.push_enabled = true AND u.promo_push_opt_in = true
      AND EXISTS (SELECT 1 FROM push_tokens pt WHERE pt.user_id = u.clerk_id AND pt.is_active = true)
      AND EXISTS (
        SELECT 1 FROM follows f JOIN users su ON su.clerk_id = f.following_id
        WHERE f.follower_id = u.clerk_id AND ${LIVE_SELLER}
      )
    ORDER BY u.clerk_id
    LIMIT ${PAGE_SIZE}
  `);
  return result.rows as Candidate[];
}

/** Followed, visible, unblocked sellers per buyer, with display names. */
async function followedSellers(userIds: string[]): Promise<Array<{ userId: string; sellerId: string; name: string }>> {
  const result = await db.execute(sql`
    SELECT f.follower_id AS "userId", f.following_id AS "sellerId",
           COALESCE(NULLIF(su.brand_name, ''), NULLIF(su.display_name, ''), su.name) AS "name"
    FROM follows f
    JOIN users su ON su.clerk_id = f.following_id
    WHERE f.follower_id IN (${sql.join(userIds.map((id) => sql`${id}`), sql`, `)})
      AND f.following_id <> f.follower_id
      AND ${LIVE_SELLER}
      AND NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b.blocker_id = f.follower_id AND b.blocked_id = f.following_id)
           OR (b.blocker_id = f.following_id AND b.blocked_id = f.follower_id)
      )
  `);
  return result.rows as Array<{ userId: string; sellerId: string; name: string }>;
}

/** Last-7-days counts per seller: published products, released drops, published posts. */
async function sellerActivity(sellerIds: string[], since: Date, now: Date): Promise<Map<string, { products: number; posts: number; drops: number }>> {
  const ids = sql.join(sellerIds.map((id) => sql`${id}`), sql`, `);
  const sinceIso = since.toISOString();
  const nowIso = now.toISOString();
  // Timestamp-without-zone columns hold UTC wall time (drizzle writes them
  // that way), so they're converted with AT TIME ZONE 'UTC' before comparing.
  const result = await db.execute(sql`
    SELECT owner_id AS "sellerId", 'products' AS "kind", count(*)::int AS "n"
    FROM products p
    LEFT JOIN product_launches pl ON pl.product_id = p.id
    WHERE p.owner_id IN (${ids}) AND p.status = 'active' AND p.deleted_at IS NULL
      AND COALESCE(pl.launch_at, p.created_at AT TIME ZONE 'UTC') >= ${sinceIso}::timestamptz
      AND COALESCE(pl.launch_at, p.created_at AT TIME ZONE 'UTC') <= ${nowIso}::timestamptz
    GROUP BY owner_id
    UNION ALL
    SELECT owner_id, 'drops', count(*)::int
    FROM drops d
    WHERE d.owner_id IN (${ids}) AND d.status <> 'draft'
      AND (COALESCE(d.release_at, d.created_at) AT TIME ZONE 'UTC') >= ${sinceIso}::timestamptz
      AND (COALESCE(d.release_at, d.created_at) AT TIME ZONE 'UTC') <= ${nowIso}::timestamptz
    GROUP BY owner_id
    UNION ALL
    SELECT user_id, 'posts', count(*)::int
    FROM posts po
    WHERE po.user_id IN (${ids}) AND po.post_status = 'published'
      AND COALESCE(po.published_at, po.created_at AT TIME ZONE 'UTC') >= ${sinceIso}::timestamptz
      AND COALESCE(po.published_at, po.created_at AT TIME ZONE 'UTC') <= ${nowIso}::timestamptz
    GROUP BY user_id
  `);
  const bySeller = new Map<string, { products: number; posts: number; drops: number }>();
  for (const row of result.rows as Array<{ sellerId: string; kind: "products" | "posts" | "drops"; n: number }>) {
    const entry = bySeller.get(row.sellerId) ?? { products: 0, posts: 0, drops: 0 };
    entry[row.kind] = Number(row.n);
    bySeller.set(row.sellerId, entry);
  }
  return bySeller;
}

async function claim(userId: string, periodKey: string, now: Date): Promise<boolean> {
  const rows = await db.insert(retentionPushLog)
    .values({ userId, kind: WEEKLY_DIGEST_KIND, periodKey, sentAt: now })
    .onConflictDoNothing()
    .returning({ id: retentionPushLog.id });
  return rows.length > 0;
}

async function release(userId: string, periodKey: string): Promise<void> {
  await db.delete(retentionPushLog).where(and(
    eq(retentionPushLog.userId, userId),
    eq(retentionPushLog.kind, WEEKLY_DIGEST_KIND),
    eq(retentionPushLog.periodKey, periodKey),
  ));
}

async function processPage(candidates: Candidate[], now: Date): Promise<number> {
  const due = new Map<string, string>(); // userId -> ISO week key
  for (const c of candidates) {
    const tz = resolveUserTimezone(c);
    if (isWeeklyDigestWindow(now, tz)) due.set(c.userId, isoWeekKey(now, tz));
  }
  if (due.size === 0) return 0;

  // Drop buyers already sent this week before doing any activity work.
  const already = await db.execute(sql`
    SELECT user_id AS "userId", period_key AS "periodKey" FROM retention_push_log
    WHERE kind = ${WEEKLY_DIGEST_KIND}
      AND user_id IN (${sql.join([...due.keys()].map((id) => sql`${id}`), sql`, `)})
  `);
  for (const row of already.rows as Array<{ userId: string; periodKey: string }>) {
    if (due.get(row.userId) === row.periodKey) due.delete(row.userId);
  }
  if (due.size === 0) return 0;

  const pairs = await followedSellers([...due.keys()]);
  if (pairs.length === 0) return 0;
  const activity = await sellerActivity([...new Set(pairs.map((p) => p.sellerId))], new Date(now.getTime() - DIGEST_LOOKBACK_MS), now);

  const byUser = new Map<string, BrandActivity[]>();
  for (const p of pairs) {
    const counts = activity.get(p.sellerId);
    if (!counts) continue;
    const list = byUser.get(p.userId) ?? [];
    list.push({ sellerId: p.sellerId, name: p.name, ...counts });
    byUser.set(p.userId, list);
  }

  let sent = 0;
  for (const [userId, brands] of byUser) {
    const copy = buildWeeklyDigestCopy(brands);
    const periodKey = due.get(userId);
    if (!copy || !periodKey) continue;
    if (!(await claim(userId, periodKey, now))) continue;
    try {
      await publishNotification({
        userId,
        // Same placement and switch as "a brand you follow just listed …"
        // (activityEvents.notifyNewProduct): Activity's social feed, push
        // gated by the buyer's New drops preference.
        category: "social",
        pushCategory: "drop",
        type: "digest",
        title: copy.title,
        body: copy.body,
        targetType: "following_feed",
        cta: "See what's new",
      });
      sent += 1;
    } catch (err) {
      await release(userId, periodKey).catch(() => {});
      logger.warn({ err, userId, job: "weeklyDigest" }, "Weekly digest push failed; will retry");
    }
  }
  return sent;
}

export async function runWeeklyDigest(now: Date = new Date()): Promise<{ sent: number }> {
  let sent = 0;
  try {
    let afterId = "";
    for (;;) {
      const page = await candidatePage(afterId);
      if (page.length === 0) break;
      sent += await processPage(page, now);
      if (page.length < PAGE_SIZE) break;
      afterId = page[page.length - 1]!.userId;
    }
    if (sent > 0) logger.info({ job: "weeklyDigest", sent }, "Weekly digests sent");
  } catch (err) {
    logger.error({ err, job: "weeklyDigest" }, "Weekly digest job failed");
  }
  return { sent };
}

export function startWeeklyDigestJob(): void {
  setInterval(() => void runWeeklyDigest(), INTERVAL_MS);
  logger.info({ job: "weeklyDigest", intervalMs: INTERVAL_MS }, "Weekly digest job scheduled");
}
