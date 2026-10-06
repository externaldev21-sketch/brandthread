/**
 * Seller analytics reports — product stats, threads and videos, audience,
 * goals, advanced (Pro) and CSV/PDF export.
 *
 * Mounted at /api/analytics/insights (team-context aware, so a team member with
 * the analytics permission sees the owner's store). Every query is scoped to the
 * resolved seller id and only ever returns aggregates; audience buckets below
 * the k-anonymity threshold are hidden.
 *
 * Ranges are the Dashboard pills (today | week | month | year | all), with
 * `tz` = minutes east of UTC so windows land on the seller's local calendar.
 * Every headline total, its previous-period figure and its chart buckets come
 * from the same [start, end) window and the same predicates.
 */
import { Router } from "express";
import PDFDocument from "pdfkit";
import { z } from "@workspace/api-zod";
import { db, sellerGoalTargets, orders, users } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { requireAuth, requirePlan } from "../middlewares/requireAuth";
import { requirePermission } from "../middlewares/requireRole";
import { parseTzOffsetMinutes } from "../lib/analyticsTime";
import {
  GOAL_METRICS,
  GOAL_PERIODS,
  K_ANONYMITY_MIN,
  applyKAnonymity,
  deltaPct,
  funnelRates,
  goalPacing,
  goalWindow,
  locationLabel,
  parseInsightRange,
  rangeLabel,
  rangeWindow,
  type BucketStep,
  type ExportTable,
  type GoalMetric,
  type GoalPeriod,
  type InsightRange,
  type RangeWindow,
} from "../lib/sellerInsights";
import { toCSV } from "./seller-export";

const router = Router();
router.use(requireAuth);
router.use(requirePermission("analytics"));

type Rows = Record<string, any>[];
const rowsOf = (result: unknown): Rows => ((result as { rows?: Rows }).rows ?? []) as Rows;
const PAID = sql`o.status != 'cancelled' AND o.paid_at IS NOT NULL`;
const ts = (d: Date) => sql`${d.toISOString()}::timestamp`;
const between = (col: ReturnType<typeof sql>, w: { start: Date; end: Date }) => sql`${col} >= ${ts(w.start)} AND ${col} < ${ts(w.end)}`;
const n = (v: unknown) => Number(v ?? 0) || 0;

/** First order date (or account creation) — the "All" range starts here. */
async function allTimeAnchor(sellerId: string): Promise<Date | null> {
  const [[firstOrder], [user]] = await Promise.all([
    db.select({ at: sql<Date | null>`min(created_at)` }).from(orders).where(and(eq(orders.ownerId, sellerId), sql`status != 'cancelled'`)),
    db.select({ at: users.createdAt }).from(users).where(eq(users.clerkId, sellerId)).limit(1),
  ]);
  const a = firstOrder?.at ? new Date(firstOrder.at) : null;
  const b = user?.at ? new Date(user.at) : null;
  if (a && b) return a < b ? a : b;
  return a ?? b;
}

interface Ctx { sellerId: string; tz: number; now: Date; window: RangeWindow }

async function ctx(req: any, rangeRaw?: unknown, tzRaw?: unknown): Promise<Ctx> {
  const sellerId = req.clerkUserId as string;
  const range = parseInsightRange(rangeRaw ?? req.query?.range);
  const tz = parseTzOffsetMinutes(tzRaw ?? req.query?.tz);
  const now = new Date();
  const anchor = range === "all" ? await allTimeAnchor(sellerId) : null;
  return { sellerId, tz, now, window: rangeWindow(range, now, tz, anchor) };
}

const windowJson = (w: RangeWindow) => ({ range: w.range, start: w.start.toISOString(), end: w.end.toISOString(), step: w.step });

/**
 * generate_series over the window: one row per bucket, LEFT JOINed by callers.
 * The step is one of four fixed literals (never user input).
 */
function series(w: { start: Date; end: Date; step: BucketStep }) {
  const step = sql.raw(`interval '${w.step}'`);
  return sql`generate_series(${ts(w.start)}, ${ts(w.end)} - ${step}, ${step}) AS series(bucket)`;
}
const inBucket = (col: ReturnType<typeof sql>, step: BucketStep) =>
  sql`${col} >= series.bucket AND ${col} < series.bucket + ${sql.raw(`interval '${step}'`)}`;

// ─── Product stats ───────────────────────────────────────────────────────────

async function productCounts(sellerId: string, w: { start: Date; end: Date }) {
  const [viewRows, cartRows, saleRows] = await Promise.all([
    // Product views reuse store_visits (product_id set); only products that
    // really belong to this seller count, whatever product_id a client sent.
    db.execute(sql`
      SELECT v.product_id, count(*)::int AS views, count(DISTINCT v.viewer_user_id)::int AS unique_viewers
      FROM store_visits v JOIN products p ON p.id = v.product_id AND p.owner_id = ${sellerId}
      WHERE v.seller_id = ${sellerId} AND v.product_id IS NOT NULL AND ${between(sql`v.created_at`, w)}
      GROUP BY v.product_id`),
    db.execute(sql`
      SELECT e.product_id, count(*)::int AS add_to_carts
      FROM seller_product_events e JOIN products p ON p.id = e.product_id AND p.owner_id = ${sellerId}
      WHERE e.seller_id = ${sellerId} AND e.event_type = 'add_to_cart' AND ${between(sql`e.created_at`, w)}
      GROUP BY e.product_id`),
    db.execute(sql`
      SELECT pv.product_id, count(DISTINCT o.id)::int AS purchases,
             coalesce(sum(oi.quantity), 0)::int AS units,
             coalesce(sum(oi.quantity * oi.price_cents), 0)::int AS revenue_cents
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      JOIN product_variants pv ON pv.id = oi.variant_id
      JOIN products p ON p.id = pv.product_id AND p.owner_id = ${sellerId}
      WHERE o.owner_id = ${sellerId} AND ${PAID} AND ${between(sql`o.created_at`, w)}
      GROUP BY pv.product_id`),
  ]);
  const byId = new Map<string, { views: number; uniqueViewers: number; addToCarts: number; purchases: number; units: number; revenueCents: number }>();
  const row = (id: string) => {
    let r = byId.get(id);
    if (!r) { r = { views: 0, uniqueViewers: 0, addToCarts: 0, purchases: 0, units: 0, revenueCents: 0 }; byId.set(id, r); }
    return r;
  };
  for (const r of rowsOf(viewRows)) Object.assign(row(r.product_id), { views: n(r.views), uniqueViewers: n(r.unique_viewers) });
  for (const r of rowsOf(cartRows)) row(r.product_id).addToCarts = n(r.add_to_carts);
  for (const r of rowsOf(saleRows)) Object.assign(row(r.product_id), { purchases: n(r.purchases), units: n(r.units), revenueCents: n(r.revenue_cents) });
  const totals = [...byId.values()].reduce(
    (t, p) => ({ views: t.views + p.views, addToCarts: t.addToCarts + p.addToCarts, purchases: t.purchases + p.purchases, units: t.units + p.units, revenueCents: t.revenueCents + p.revenueCents }),
    { views: 0, addToCarts: 0, purchases: 0, units: 0, revenueCents: 0 },
  );
  return { byId, totals };
}

export async function loadProductStats(sellerId: string, w: RangeWindow) {
  const [current, previous, bucketRows] = await Promise.all([
    productCounts(sellerId, w),
    w.previous ? productCounts(sellerId, w.previous) : null,
    db.execute(sql`
      SELECT series.bucket,
        (SELECT count(*)::int FROM store_visits v JOIN products p ON p.id = v.product_id AND p.owner_id = ${sellerId}
          WHERE v.seller_id = ${sellerId} AND v.product_id IS NOT NULL AND ${inBucket(sql`v.created_at`, w.step)}) AS views,
        (SELECT count(DISTINCT o.id)::int FROM orders o JOIN order_items oi ON oi.order_id = o.id
          JOIN product_variants pv ON pv.id = oi.variant_id JOIN products p ON p.id = pv.product_id AND p.owner_id = ${sellerId}
          WHERE o.owner_id = ${sellerId} AND ${PAID} AND ${inBucket(sql`o.created_at`, w.step)}) AS purchases
      FROM ${series(w)} ORDER BY series.bucket`),
  ]);
  const ids = [...current.byId.keys()];
  const meta = ids.length === 0 ? [] : rowsOf(await db.execute(sql`
    SELECT p.id, p.name, p.images, coalesce(sum(pv.stock), 0)::int AS stock
    FROM products p LEFT JOIN product_variants pv ON pv.product_id = p.id
    WHERE p.owner_id = ${sellerId} AND p.id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
    GROUP BY p.id`));
  const metaById = new Map(meta.map((m) => [String(m.id), m]));
  const products = ids.map((id) => {
    const c = current.byId.get(id)!;
    const m = metaById.get(id);
    const images = Array.isArray(m?.images) ? (m!.images as unknown[]) : [];
    return {
      productId: id,
      name: String(m?.name ?? "Product"),
      imageUrl: typeof images[0] === "string" ? (images[0] as string) : null,
      stock: n(m?.stock),
      ...c,
      ...funnelRates(c),
    };
  })
    .sort((a, b) => b.revenueCents - a.revenueCents || b.views - a.views || a.name.localeCompare(b.name))
    .slice(0, 100);
  const t = current.totals;
  const p = previous?.totals ?? null;
  return {
    totals: { ...t, uniqueViewers: [...current.byId.values()].reduce((a, r) => a + r.uniqueViewers, 0), ...funnelRates(t) },
    previous: p,
    deltas: {
      viewsPct: deltaPct(t.views, p?.views),
      addToCartsPct: deltaPct(t.addToCarts, p?.addToCarts),
      purchasesPct: deltaPct(t.purchases, p?.purchases),
      revenuePct: deltaPct(t.revenueCents, p?.revenueCents),
    },
    buckets: rowsOf(bucketRows).map((r) => ({ bucket: new Date(r.bucket).toISOString(), views: n(r.views), purchases: n(r.purchases) })),
    products,
  };
}

// ─── Threads and videos ──────────────────────────────────────────────────────

const VALID_SECONDS = sql`i.value ~ '^[0-9]+(\\.[0-9]+)?$'`;

async function contentTotals(sellerId: string, w: { start: Date; end: Date }) {
  const inRange = sql`${between(sql`i.created_at`, w)} AND i.user_id != p.user_id`;
  const [totalRows, commentRows, saveRows, orderRows, followRows, profileRows] = await Promise.all([
    db.execute(sql`
      SELECT count(*) FILTER (WHERE i.type = 'view')::int AS views,
        count(DISTINCT i.user_id) FILTER (WHERE i.type = 'view')::int AS unique_viewers,
        count(*) FILTER (WHERE i.type = 'like')::int AS likes,
        count(*) FILTER (WHERE i.type IN ('share', 'repost'))::int AS shares,
        count(*) FILTER (WHERE i.type = 'shop_click')::int AS clicks,
        count(*) FILTER (WHERE i.type = 'add_to_bag')::int AS carts,
        avg(i.value::numeric) FILTER (WHERE i.type = 'watch_time' AND ${VALID_SECONDS}) AS avg_watch,
        count(*) FILTER (WHERE i.type = 'watch_time' AND ${VALID_SECONDS})::int AS watch_samples
      FROM interactions i JOIN posts p ON p.id = i.post_id
      WHERE p.user_id = ${sellerId} AND p.post_status = 'published' AND ${inRange}`),
    db.execute(sql`
      SELECT count(*)::int AS n FROM post_comments c JOIN posts p ON p.id = c.post_id
      WHERE p.user_id = ${sellerId} AND c.author_id != p.user_id AND c.moderation_status = 'visible' AND ${between(sql`c.created_at`, w)}`),
    db.execute(sql`
      SELECT count(*)::int AS n FROM saved_items s JOIN posts p ON p.id::text = s.target_id
      WHERE s.item_type = 'post' AND p.user_id = ${sellerId} AND ${between(sql`s.created_at`, w)}`),
    db.execute(sql`
      SELECT count(*)::int AS purchases, coalesce(sum(o.total_cents), 0)::int AS revenue_cents
      FROM orders o WHERE o.owner_id = ${sellerId} AND o.source_post_id IS NOT NULL AND ${PAID} AND ${between(sql`o.created_at`, w)}`),
    db.execute(sql`SELECT count(*)::int AS n FROM follows WHERE following_id = ${sellerId} AND ${between(sql`created_at`, w)}`),
    db.execute(sql`SELECT count(*)::int AS n FROM store_visits WHERE seller_id = ${sellerId} AND source = 'profile' AND product_id IS NULL AND ${between(sql`created_at`, w)}`),
  ]);
  const t = rowsOf(totalRows)[0] ?? {};
  const o = rowsOf(orderRows)[0] ?? {};
  return {
    views: n(t.views), uniqueViewers: n(t.unique_viewers), likes: n(t.likes), comments: n(rowsOf(commentRows)[0]?.n),
    shares: n(t.shares), saves: n(rowsOf(saveRows)[0]?.n), productClicks: n(t.clicks), addToCarts: n(t.carts),
    purchases: n(o.purchases), revenueCents: n(o.revenue_cents),
    avgWatchSeconds: n(t.watch_samples) > 0 ? Math.round(Number(t.avg_watch) * 10) / 10 : null,
    followerGrowth: n(rowsOf(followRows)[0]?.n), profileVisits: n(rowsOf(profileRows)[0]?.n),
  };
}

export async function loadContent(sellerId: string, w: RangeWindow) {
  const inRange = sql`${between(sql`i.created_at`, w)} AND i.user_id != p.user_id`;
  const [totals, previous, postRows, commentRows, saveRows, orderRows, bucketRows] = await Promise.all([
    contentTotals(sellerId, w),
    w.previous ? contentTotals(sellerId, w.previous) : null,
    db.execute(sql`
      SELECT p.id, p.media_type, p.thumbnail_url, p.media_url, p.caption, coalesce(p.published_at, p.created_at) AS published_at,
        count(i.id) FILTER (WHERE i.type = 'view')::int AS views,
        count(i.id) FILTER (WHERE i.type = 'like')::int AS likes,
        count(i.id) FILTER (WHERE i.type IN ('share', 'repost'))::int AS shares,
        count(i.id) FILTER (WHERE i.type = 'shop_click')::int AS clicks,
        avg(i.value::numeric) FILTER (WHERE i.type = 'watch_time' AND ${VALID_SECONDS}) AS avg_watch
      FROM posts p LEFT JOIN interactions i ON i.post_id = p.id AND ${inRange}
      WHERE p.user_id = ${sellerId} AND p.post_status = 'published'
      GROUP BY p.id HAVING count(i.id) > 0
      ORDER BY views DESC, p.id LIMIT 200`),
    db.execute(sql`
      SELECT c.post_id, count(*)::int AS n FROM post_comments c JOIN posts p ON p.id = c.post_id
      WHERE p.user_id = ${sellerId} AND c.author_id != p.user_id AND c.moderation_status = 'visible' AND ${between(sql`c.created_at`, w)}
      GROUP BY c.post_id`),
    db.execute(sql`
      SELECT s.target_id, count(*)::int AS n FROM saved_items s JOIN posts p ON p.id::text = s.target_id
      WHERE s.item_type = 'post' AND p.user_id = ${sellerId} AND ${between(sql`s.created_at`, w)}
      GROUP BY s.target_id`),
    db.execute(sql`
      SELECT o.source_post_id, count(*)::int AS purchases, coalesce(sum(o.total_cents), 0)::int AS revenue_cents
      FROM orders o WHERE o.owner_id = ${sellerId} AND o.source_post_id IS NOT NULL AND ${PAID} AND ${between(sql`o.created_at`, w)}
      GROUP BY o.source_post_id`),
    db.execute(sql`
      SELECT series.bucket,
        (SELECT count(*)::int FROM interactions i JOIN posts p ON p.id = i.post_id
          WHERE p.user_id = ${sellerId} AND i.user_id != p.user_id AND i.type = 'view' AND ${inBucket(sql`i.created_at`, w.step)}) AS views,
        (SELECT count(*)::int FROM interactions i JOIN posts p ON p.id = i.post_id
          WHERE p.user_id = ${sellerId} AND i.user_id != p.user_id AND i.type = 'like' AND ${inBucket(sql`i.created_at`, w.step)}) AS likes
      FROM ${series(w)} ORDER BY series.bucket`),
  ]);
  const comments = new Map(rowsOf(commentRows).map((r) => [String(r.post_id), n(r.n)]));
  const saves = new Map(rowsOf(saveRows).map((r) => [String(r.target_id), n(r.n)]));
  const sales = new Map(rowsOf(orderRows).map((r) => [String(r.source_post_id), r]));
  const kind = (t: string) => (t === "video" ? "video" : t === "slideshow" ? "slideshow" : "image");
  const posts = rowsOf(postRows).map((r) => {
    const id = String(r.id);
    const type = kind(r.media_type) as "video" | "slideshow" | "image";
    return {
      postId: id, type,
      thumbnailUrl: r.thumbnail_url ?? (type === "image" ? r.media_url ?? null : null),
      caption: r.caption ?? "",
      views: n(r.views), likes: n(r.likes), comments: comments.get(id) ?? 0, saves: saves.get(id) ?? 0, shares: n(r.shares),
      productClicks: n(r.clicks),
      purchases: n(sales.get(id)?.purchases), revenueCents: n(sales.get(id)?.revenue_cents),
      avgWatchSeconds: r.avg_watch === null || r.avg_watch === undefined ? null : Math.round(Number(r.avg_watch) * 10) / 10,
      publishedAt: new Date(r.published_at).toISOString(),
    };
  });
  const p = previous;
  return {
    totals,
    previous: p,
    deltas: {
      viewsPct: deltaPct(totals.views, p?.views),
      likesPct: deltaPct(totals.likes, p?.likes),
      commentsPct: deltaPct(totals.comments, p?.comments),
      sharesPct: deltaPct(totals.shares, p?.shares),
      savesPct: deltaPct(totals.saves, p?.saves),
      followerGrowthPct: deltaPct(totals.followerGrowth, p?.followerGrowth),
      revenuePct: deltaPct(totals.revenueCents, p?.revenueCents),
    },
    buckets: rowsOf(bucketRows).map((r) => ({ bucket: new Date(r.bucket).toISOString(), views: n(r.views), likes: n(r.likes) })),
    byType: (["video", "image", "slideshow"] as const).map((type) => {
      const rows = posts.filter((x) => x.type === type);
      return { type, posts: rows.length, views: rows.reduce((a, x) => a + x.views, 0) };
    }),
    posts,
  };
}

// ─── Audience ────────────────────────────────────────────────────────────────

const buyerKey = sql`coalesce(o.buyer_id, lower(o.guest_email), 'order:' || o.id::text)`;

function split(r: Record<string, any> | undefined) {
  const total = n(r?.total);
  const ret = n(r?.returning);
  const newer = total - ret;
  // Both halves describe groups of people; a half under k is hidden, and so is
  // the total when hiding one half would let the other be subtracted out.
  const shownNew = newer >= K_ANONYMITY_MIN;
  const shownRet = ret >= K_ANONYMITY_MIN;
  const suppressed = !(shownNew && shownRet);
  return {
    suppressed,
    total: suppressed && total < K_ANONYMITY_MIN ? null : total,
    new: shownNew ? newer : null,
    returning: shownRet ? ret : null,
  };
}

export async function loadAudience(sellerId: string, w: RangeWindow) {
  const [followerTotalRow, followerGainRow, prevGainRow, followerBuckets, buyerRows, viewerRows, countryRows, regionRows, deviceRows] = await Promise.all([
    db.execute(sql`SELECT count(*)::int AS n FROM follows WHERE following_id = ${sellerId}`),
    db.execute(sql`SELECT count(*)::int AS n FROM follows WHERE following_id = ${sellerId} AND ${between(sql`created_at`, w)}`),
    w.previous ? db.execute(sql`SELECT count(*)::int AS n FROM follows WHERE following_id = ${sellerId} AND ${between(sql`created_at`, w.previous)}`) : null,
    db.execute(sql`
      SELECT series.bucket, count(f.follower_id)::int AS gained
      FROM ${series(w)}
      LEFT JOIN follows f ON f.following_id = ${sellerId} AND ${inBucket(sql`f.created_at`, w.step)}
      GROUP BY series.bucket ORDER BY series.bucket`),
    db.execute(sql`
      WITH cur AS (
        SELECT DISTINCT ${buyerKey} AS k FROM orders o
        WHERE o.owner_id = ${sellerId} AND ${PAID} AND ${between(sql`o.created_at`, w)}
      )
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM orders o WHERE o.owner_id = ${sellerId} AND ${PAID}
                 AND o.created_at < ${ts(w.start)} AND ${buyerKey} = cur.k))::int AS returning
      FROM cur`),
    db.execute(sql`
      WITH cur AS (
        SELECT DISTINCT viewer_user_id AS k FROM store_visits
        WHERE seller_id = ${sellerId} AND viewer_user_id IS NOT NULL AND ${between(sql`created_at`, w)}
      )
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM store_visits s WHERE s.seller_id = ${sellerId}
                 AND s.viewer_user_id = cur.k AND s.created_at < ${ts(w.start)}))::int AS returning
      FROM cur`),
    db.execute(sql`
      SELECT upper(trim(o.shipping_address->>'country')) AS country, count(DISTINCT ${buyerKey})::int AS people
      FROM orders o
      WHERE o.owner_id = ${sellerId} AND ${PAID} AND ${between(sql`o.created_at`, w)}
        AND coalesce(trim(o.shipping_address->>'country'), '') != ''
      GROUP BY 1`),
    db.execute(sql`
      SELECT upper(trim(o.shipping_address->>'country')) AS country,
             upper(trim(o.shipping_address->>'state')) AS region, count(DISTINCT ${buyerKey})::int AS people
      FROM orders o
      WHERE o.owner_id = ${sellerId} AND ${PAID} AND ${between(sql`o.created_at`, w)}
        AND coalesce(trim(o.shipping_address->>'country'), '') != ''
        AND coalesce(trim(o.shipping_address->>'state'), '') != ''
      GROUP BY 1, 2`),
    db.execute(sql`
      SELECT device, count(*)::int AS visits FROM store_visits
      WHERE seller_id = ${sellerId} AND ${between(sql`created_at`, w)}
      GROUP BY device`),
  ]);

  const clean = (r: Rows) => r.flatMap((x) => {
    const l = locationLabel({ country: x.country, state: x.region });
    return l ? [{ country: l.country, region: l.region, people: n(x.people) }] : [];
  });
  const countries = applyKAnonymity(clean(rowsOf(countryRows)));
  const regions = applyKAnonymity(clean(rowsOf(regionRows)));
  const deviceCounts = new Map(rowsOf(deviceRows).map((r) => [r.device === null ? "unknown" : String(r.device), n(r.visits)]));
  const deviceTotal = [...deviceCounts.values()].reduce((a, b) => a + b, 0);
  const gained = n(rowsOf(followerGainRow)[0]?.n);
  const prevGained = prevGainRow ? n(rowsOf(prevGainRow)[0]?.n) : null;
  return {
    minGroupSize: K_ANONYMITY_MIN,
    followers: {
      total: n(rowsOf(followerTotalRow)[0]?.n),
      gained,
      previousGained: prevGained,
      gainedPct: deltaPct(gained, prevGained),
    },
    buckets: rowsOf(followerBuckets).map((r) => ({ bucket: new Date(r.bucket).toISOString(), followers: n(r.gained) })),
    buyers: split(rowsOf(buyerRows)[0]),
    viewers: split(rowsOf(viewerRows)[0]),
    topCountries: countries.shown.sort((a, b) => b.people - a.people || a.country.localeCompare(b.country)).slice(0, 10)
      .map((c) => ({ country: c.country, people: c.people })),
    topRegions: regions.shown.sort((a, b) => b.people - a.people || `${a.country}${a.region}`.localeCompare(`${b.country}${b.region}`)).slice(0, 10)
      .map((c) => ({ country: c.country, region: c.region, people: c.people })),
    hiddenLocations: countries.hiddenBuckets,
    devices: (["ios", "android", "web", "unknown"] as const)
      .map((device) => ({ device, visits: deviceCounts.get(device) ?? 0, sharePct: deviceTotal > 0 ? Math.round(((deviceCounts.get(device) ?? 0) / deviceTotal) * 1000) / 10 : 0 }))
      .filter((d) => d.visits > 0),
    deviceVisits: deviceTotal,
  };
}

// ─── Goals ───────────────────────────────────────────────────────────────────

async function goalActual(sellerId: string, metric: GoalMetric, w: { start: Date; end: Date }): Promise<number> {
  switch (metric) {
    case "revenue": return n(rowsOf(await db.execute(sql`SELECT coalesce(sum(o.total_cents), 0)::int AS v FROM orders o WHERE o.owner_id = ${sellerId} AND ${PAID} AND ${between(sql`o.created_at`, w)}`))[0]?.v);
    case "orders": return n(rowsOf(await db.execute(sql`SELECT count(*)::int AS v FROM orders o WHERE o.owner_id = ${sellerId} AND ${PAID} AND ${between(sql`o.created_at`, w)}`))[0]?.v);
    case "units": return n(rowsOf(await db.execute(sql`SELECT coalesce(sum(oi.quantity), 0)::int AS v FROM orders o JOIN order_items oi ON oi.order_id = o.id WHERE o.owner_id = ${sellerId} AND ${PAID} AND ${between(sql`o.created_at`, w)}`))[0]?.v);
    case "visits": return n(rowsOf(await db.execute(sql`SELECT count(*)::int AS v FROM storefront_visits WHERE seller_id = ${sellerId} AND ${between(sql`created_at`, w)}`))[0]?.v);
    case "followers": return n(rowsOf(await db.execute(sql`SELECT count(*)::int AS v FROM follows WHERE following_id = ${sellerId} AND ${between(sql`created_at`, w)}`))[0]?.v);
  }
}

export async function loadGoals(sellerId: string, tz: number, now = new Date()) {
  const rows = await db.select().from(sellerGoalTargets).where(eq(sellerGoalTargets.sellerId, sellerId)).orderBy(sellerGoalTargets.createdAt);
  return Promise.all(rows.map(async (g) => {
    const metric = g.metric as GoalMetric;
    const period = g.period as GoalPeriod;
    const window = goalWindow(period, now, tz);
    const actual = await goalActual(sellerId, metric, window);
    return {
      id: g.id, metric, period, target: g.targetValue, actual,
      window: { start: window.start.toISOString(), end: window.end.toISOString() },
      ...goalPacing(actual, g.targetValue, now, window),
    };
  }));
}

// ─── Advanced (Pro) ──────────────────────────────────────────────────────────

async function advancedTotals(sellerId: string, w: { start: Date; end: Date }) {
  const [r] = rowsOf(await db.execute(sql`
    SELECT count(*)::int AS orders,
           coalesce(sum(o.total_cents), 0)::int AS revenue_cents,
           coalesce(sum(o.refunded_cents), 0)::int AS refunded_cents,
           count(*) FILTER (WHERE o.refunded_cents > 0)::int AS refunded_orders,
           count(*) FILTER (WHERE o.discount_amount_cents > 0)::int AS discounted_orders,
           coalesce(sum(o.discount_amount_cents), 0)::int AS discount_cents,
           count(*) FILTER (WHERE o.source_post_id IS NOT NULL)::int AS thread_orders,
           coalesce(sum(o.total_cents) FILTER (WHERE o.source_post_id IS NOT NULL), 0)::int AS thread_revenue_cents,
           count(DISTINCT ${buyerKey})::int AS buyers,
           (SELECT coalesce(sum(oi.quantity), 0)::int FROM order_items oi JOIN orders o2 ON o2.id = oi.order_id
             WHERE o2.owner_id = ${sellerId} AND o2.status != 'cancelled' AND o2.paid_at IS NOT NULL AND ${between(sql`o2.created_at`, w)}) AS units,
           (SELECT count(*)::int FROM storefront_visits WHERE seller_id = ${sellerId} AND ${between(sql`created_at`, w)}) AS visits
    FROM orders o WHERE o.owner_id = ${sellerId} AND ${PAID} AND ${between(sql`o.created_at`, w)}`));
  const orders = n(r?.orders);
  return {
    orders, revenueCents: n(r?.revenue_cents), refundedCents: n(r?.refunded_cents), refundedOrders: n(r?.refunded_orders),
    discountedOrders: n(r?.discounted_orders), discountCents: n(r?.discount_cents),
    threadOrders: n(r?.thread_orders), threadRevenueCents: n(r?.thread_revenue_cents), buyers: n(r?.buyers), units: n(r?.units), visits: n(r?.visits),
    averageOrderCents: orders > 0 ? Math.round(n(r?.revenue_cents) / orders) : 0,
    unitsPerOrder: orders > 0 ? Math.round((n(r?.units) / orders) * 100) / 100 : 0,
    conversionPct: n(r?.visits) > 0 ? Math.round((orders / n(r?.visits)) * 1000) / 10 : 0,
    refundRatePct: orders > 0 ? Math.round((n(r?.refunded_orders) / orders) * 1000) / 10 : 0,
  };
}

export async function loadAdvanced(sellerId: string, w: RangeWindow) {
  const [totals, previous, repeatRows, customerRows, bucketRows] = await Promise.all([
    advancedTotals(sellerId, w),
    w.previous ? advancedTotals(sellerId, w.previous) : null,
    db.execute(sql`
      WITH cur AS (
        SELECT ${buyerKey} AS k, count(*)::int AS c FROM orders o
        WHERE o.owner_id = ${sellerId} AND ${PAID} AND ${between(sql`o.created_at`, w)} GROUP BY 1)
      SELECT count(*)::int AS buyers,
             count(*) FILTER (WHERE c > 1 OR EXISTS (
               SELECT 1 FROM orders o WHERE o.owner_id = ${sellerId} AND ${PAID} AND o.created_at < ${ts(w.start)} AND ${buyerKey} = cur.k))::int AS repeat
      FROM cur`),
    db.execute(sql`
      SELECT ${buyerKey} AS k, max(coalesce(u.display_name, u.name, c.name)) AS name,
             count(*)::int AS orders, coalesce(sum(o.total_cents), 0)::int AS total_cents, max(o.created_at) AS last_order_at
      FROM orders o
      LEFT JOIN users u ON u.clerk_id = o.buyer_id
      LEFT JOIN customers c ON c.id = o.customer_id
      WHERE o.owner_id = ${sellerId} AND ${PAID} AND ${between(sql`o.created_at`, w)}
      GROUP BY 1 ORDER BY total_cents DESC, orders DESC LIMIT 5`),
    db.execute(sql`
      SELECT series.bucket,
             count(o.id)::int AS orders,
             coalesce(sum(o.total_cents), 0)::int AS revenue_cents
      FROM ${series(w)}
      LEFT JOIN orders o ON o.owner_id = ${sellerId} AND o.status != 'cancelled' AND o.paid_at IS NOT NULL AND ${inBucket(sql`o.created_at`, w.step)}
      GROUP BY series.bucket ORDER BY series.bucket`),
  ]);
  const rep = rowsOf(repeatRows)[0] ?? {};
  const buyers = n(rep.buyers);
  const p = previous;
  return {
    totals: { ...totals, repeatBuyers: n(rep.repeat), repeatBuyerPct: buyers > 0 ? Math.round((n(rep.repeat) / buyers) * 1000) / 10 : 0 },
    previous: p,
    deltas: {
      averageOrderPct: deltaPct(totals.averageOrderCents, p?.averageOrderCents),
      conversionPct: deltaPct(totals.conversionPct, p?.conversionPct),
      refundRatePct: deltaPct(totals.refundRatePct, p?.refundRatePct),
      revenuePct: deltaPct(totals.revenueCents, p?.revenueCents),
    },
    channels: [
      { channel: "threads", orders: totals.threadOrders, revenueCents: totals.threadRevenueCents },
      { channel: "store", orders: totals.orders - totals.threadOrders, revenueCents: totals.revenueCents - totals.threadRevenueCents },
    ],
    buckets: rowsOf(bucketRows).map((r) => ({
      bucket: new Date(r.bucket).toISOString(), orders: n(r.orders), revenueCents: n(r.revenue_cents),
      averageOrderCents: n(r.orders) > 0 ? Math.round(n(r.revenue_cents) / n(r.orders)) : 0,
    })),
    topCustomers: rowsOf(customerRows).map((r) => ({
      name: typeof r.name === "string" && r.name.trim() ? r.name : "Customer",
      orders: n(r.orders), totalCents: n(r.total_cents), lastOrderAt: new Date(r.last_order_at).toISOString(),
    })),
  };
}

// ─── Endpoints ───────────────────────────────────────────────────────────────

function fail(res: any, req: any, err: unknown, what: string) {
  req.log?.error?.({ err }, `Failed to load ${what}`);
  res.status(500).json({ error: `Failed to load ${what}` });
}

router.get("/products", async (req, res) => {
  try {
    const c = await ctx(req);
    res.json({ window: windowJson(c.window), ...(await loadProductStats(c.sellerId, c.window)) });
  } catch (err) { fail(res, req, err, "product stats"); }
});

router.get("/content", async (req, res) => {
  try {
    const c = await ctx(req);
    res.json({ window: windowJson(c.window), ...(await loadContent(c.sellerId, c.window)) });
  } catch (err) { fail(res, req, err, "content stats"); }
});

router.get("/audience", async (req, res) => {
  try {
    const c = await ctx(req);
    res.json({ window: windowJson(c.window), ...(await loadAudience(c.sellerId, c.window)) });
  } catch (err) { fail(res, req, err, "audience"); }
});

router.get("/advanced", requirePlan("pro"), async (req, res) => {
  try {
    const c = await ctx(req);
    res.json({ window: windowJson(c.window), ...(await loadAdvanced(c.sellerId, c.window)) });
  } catch (err) { fail(res, req, err, "advanced analytics"); }
});

const MAX_GOALS = 10;
const goalSchema = z.object({
  metric: z.enum(GOAL_METRICS),
  period: z.enum(GOAL_PERIODS).default("month"),
  target: z.number().int().positive(),
}).superRefine((g, c) => {
  const max = g.metric === "revenue" ? 1_000_000_000 : 1_000_000; // revenue in cents
  if (g.target > max) c.addIssue({ code: "custom", path: ["target"], message: "Target is too large" });
});
const GOAL_INPUT_ERROR = "Choose a metric, a period and a positive whole-number target";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get("/goals", async (req, res) => {
  try {
    const c = await ctx(req);
    res.json({ goals: await loadGoals(c.sellerId, c.tz, c.now) });
  } catch (err) { fail(res, req, err, "goals"); }
});

router.post("/goals", async (req, res) => {
  const parsed = goalSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: GOAL_INPUT_ERROR, code: "VALIDATION_ERROR" }); return; }
  try {
    const c = await ctx(req, undefined, req.body?.tz);
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(sellerGoalTargets).where(eq(sellerGoalTargets.sellerId, c.sellerId));
    if (count >= MAX_GOALS) { res.status(400).json({ error: `You can keep up to ${MAX_GOALS} goals`, code: "GOAL_LIMIT" }); return; }
    const [row] = await db.insert(sellerGoalTargets)
      .values({ sellerId: c.sellerId, metric: parsed.data.metric, period: parsed.data.period, targetValue: parsed.data.target })
      .returning({ id: sellerGoalTargets.id });
    const goals = await loadGoals(c.sellerId, c.tz, c.now);
    res.status(201).json({ goal: goals.find((g) => g.id === row.id) ?? null, goals });
  } catch (err) { fail(res, req, err, "goal"); }
});

router.put("/goals/:id", async (req, res) => {
  const id = String(req.params.id);
  const parsed = goalSchema.safeParse(req.body);
  if (!UUID_RE.test(id)) { res.status(404).json({ error: "Goal not found" }); return; }
  if (!parsed.success) { res.status(400).json({ error: GOAL_INPUT_ERROR, code: "VALIDATION_ERROR" }); return; }
  try {
    const c = await ctx(req, undefined, req.body?.tz);
    const updated = await db.update(sellerGoalTargets)
      .set({ metric: parsed.data.metric, period: parsed.data.period, targetValue: parsed.data.target, updatedAt: new Date() })
      .where(and(eq(sellerGoalTargets.id, id), eq(sellerGoalTargets.sellerId, c.sellerId)))
      .returning({ id: sellerGoalTargets.id });
    if (updated.length === 0) { res.status(404).json({ error: "Goal not found" }); return; }
    const goals = await loadGoals(c.sellerId, c.tz, c.now);
    res.json({ goal: goals.find((g) => g.id === id) ?? null, goals });
  } catch (err) { fail(res, req, err, "goal"); }
});

router.delete("/goals/:id", async (req, res) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) { res.status(404).json({ error: "Goal not found" }); return; }
  try {
    const sellerId = (req as any).clerkUserId as string;
    const deleted = await db.delete(sellerGoalTargets)
      .where(and(eq(sellerGoalTargets.id, id), eq(sellerGoalTargets.sellerId, sellerId)))
      .returning({ id: sellerGoalTargets.id });
    if (deleted.length === 0) { res.status(404).json({ error: "Goal not found" }); return; }
    res.json({ ok: true });
  } catch (err) { fail(res, req, err, "goal"); }
});

// ─── Export ──────────────────────────────────────────────────────────────────

export const EXPORT_SECTIONS = ["orders", "products", "analytics", "content", "audience", "goals"] as const;
export type ExportSectionKey = (typeof EXPORT_SECTIONS)[number];
const exportSchema = z.object({
  format: z.enum(["csv", "pdf"]).default("csv"),
  range: z.enum(["today", "week", "month", "year", "all"]).default("month"),
  sections: z.array(z.enum(EXPORT_SECTIONS)).min(1).max(EXPORT_SECTIONS.length),
  tz: z.number().optional(),
});

const money = (c: number) => (c / 100).toFixed(2);
const pct = (v: number | null) => (v === null ? "" : v);
const day = (d: Date | string) => new Date(d).toISOString().slice(0, 10);
const GOAL_LABEL: Record<GoalMetric, string> = { revenue: "Revenue", orders: "Orders", visits: "Visits", followers: "New followers", units: "Units sold" };

export async function buildExportTables(sellerId: string, w: RangeWindow, tz: number, sections: ExportSectionKey[], now = new Date()): Promise<ExportTable[]> {
  const tables: ExportTable[] = [];
  for (const key of EXPORT_SECTIONS.filter((s) => sections.includes(s))) {
    if (key === "orders") {
      const rows = rowsOf(await db.execute(sql`
        SELECT o.order_number, o.created_at, o.status, o.paid_at, o.subtotal_cents, o.shipping_cents, o.tax_cents,
               o.discount_amount_cents, o.total_cents, o.refunded_cents, o.discount_code, o.source_post_id,
               upper(trim(o.shipping_address->>'country')) AS country, upper(trim(o.shipping_address->>'state')) AS region,
               (SELECT coalesce(sum(oi.quantity), 0)::int FROM order_items oi WHERE oi.order_id = o.id) AS units
        FROM orders o WHERE o.owner_id = ${sellerId} AND o.status != 'cancelled' AND ${between(sql`o.created_at`, w)}
        ORDER BY o.created_at DESC LIMIT 5000`));
      tables.push({
        title: "Orders",
        headers: ["Order", "Date", "Status", "Paid", "Units", "Subtotal", "Shipping", "Tax", "Discount", "Total", "Refunded", "Discount code", "Channel", "Country", "Region"],
        fields: ["order", "date", "status", "paid", "units", "subtotal", "shipping", "tax", "discount", "total", "refunded", "code", "channel", "country", "region"],
        rows: rows.map((r) => ({
          order: r.order_number, date: new Date(r.created_at).toISOString(), status: r.status, paid: r.paid_at ? "yes" : "no", units: n(r.units),
          subtotal: money(n(r.subtotal_cents)), shipping: money(n(r.shipping_cents)), tax: money(n(r.tax_cents)), discount: money(n(r.discount_amount_cents)),
          total: money(n(r.total_cents)), refunded: money(n(r.refunded_cents)), code: r.discount_code ?? "", channel: r.source_post_id ? "threads" : "store",
          country: r.country ?? "", region: r.region ?? "",
        })),
      });
    } else if (key === "products") {
      const d = await loadProductStats(sellerId, w);
      tables.push({
        title: "Products",
        headers: ["Product", "Views", "Unique viewers", "Add to cart", "Purchases", "Units", "Revenue", "View to cart %", "Cart to purchase %", "In stock"],
        fields: ["name", "views", "uniqueViewers", "addToCarts", "purchases", "units", "revenue", "v2c", "c2p", "stock"],
        rows: d.products.map((p) => ({
          name: p.name, views: p.views, uniqueViewers: p.uniqueViewers, addToCarts: p.addToCarts, purchases: p.purchases, units: p.units,
          revenue: money(p.revenueCents), v2c: pct(p.viewToCartPct), c2p: pct(p.cartToPurchasePct), stock: p.stock,
        })),
      });
    } else if (key === "analytics") {
      const rows = rowsOf(await db.execute(sql`
        SELECT series.bucket,
          (SELECT count(*)::int FROM storefront_visits v WHERE v.seller_id = ${sellerId} AND ${inBucket(sql`v.created_at`, w.step)}) AS visits,
          (SELECT count(*)::int FROM store_visits v WHERE v.seller_id = ${sellerId} AND v.product_id IS NOT NULL AND ${inBucket(sql`v.created_at`, w.step)}) AS product_views,
          (SELECT count(*)::int FROM orders o WHERE o.owner_id = ${sellerId} AND ${PAID} AND ${inBucket(sql`o.created_at`, w.step)}) AS orders,
          (SELECT coalesce(sum(o.total_cents), 0)::int FROM orders o WHERE o.owner_id = ${sellerId} AND ${PAID} AND ${inBucket(sql`o.created_at`, w.step)}) AS revenue_cents,
          (SELECT coalesce(sum(o.total_cents - coalesce(o.refunded_cents, 0)), 0)::int FROM orders o WHERE o.owner_id = ${sellerId} AND ${PAID} AND ${inBucket(sql`o.created_at`, w.step)}) AS net_cents,
          (SELECT count(*)::int FROM follows f WHERE f.following_id = ${sellerId} AND ${inBucket(sql`f.created_at`, w.step)}) AS followers
        FROM ${series(w)} ORDER BY series.bucket`));
      tables.push({
        title: "Analytics",
        note: `One row per ${w.step.replace("1 ", "")}.`,
        headers: ["Period start", "Visits", "Product views", "Orders", "Revenue", "Net revenue", "New followers"],
        fields: ["bucket", "visits", "productViews", "orders", "revenue", "net", "followers"],
        rows: rows.map((r) => ({
          bucket: new Date(r.bucket).toISOString(), visits: n(r.visits), productViews: n(r.product_views), orders: n(r.orders),
          revenue: money(n(r.revenue_cents)), net: money(n(r.net_cents)), followers: n(r.followers),
        })),
      });
    } else if (key === "content") {
      const d = await loadContent(sellerId, w);
      tables.push({
        title: "Threads and videos",
        headers: ["Post", "Type", "Published", "Views", "Likes", "Comments", "Saves", "Shares", "Product clicks", "Purchases", "Revenue", "Avg watch (s)"],
        fields: ["caption", "type", "published", "views", "likes", "comments", "saves", "shares", "productClicks", "purchases", "revenue", "avgWatch"],
        rows: d.posts.map((p) => ({ ...p, published: day(p.publishedAt), revenue: money(p.revenueCents), avgWatch: p.avgWatchSeconds ?? "" })),
      });
    } else if (key === "audience") {
      const d = await loadAudience(sellerId, w);
      const rows: Record<string, unknown>[] = [
        { group: "Followers (total)", people: d.followers.total },
        { group: "New followers", people: d.followers.gained },
      ];
      if (d.buyers.new !== null) rows.push({ group: "New buyers", people: d.buyers.new });
      if (d.buyers.returning !== null) rows.push({ group: "Returning buyers", people: d.buyers.returning });
      if (d.viewers.new !== null) rows.push({ group: "New viewers", people: d.viewers.new });
      if (d.viewers.returning !== null) rows.push({ group: "Returning viewers", people: d.viewers.returning });
      for (const c of d.topCountries) rows.push({ group: `Country: ${c.country}`, people: c.people });
      for (const r of d.topRegions) rows.push({ group: `Region: ${r.country} ${r.region}`, people: r.people });
      for (const dv of d.devices) rows.push({ group: `Device: ${dv.device}`, people: dv.visits });
      tables.push({
        title: "Audience",
        note: `Groups with fewer than ${K_ANONYMITY_MIN} people are not shown. Device rows count visits, not people.`,
        headers: ["Group", "Count"], fields: ["group", "people"], rows,
      });
    } else if (key === "goals") {
      const goals = await loadGoals(sellerId, tz, now);
      const f = (metric: GoalMetric, v: number) => (metric === "revenue" ? money(v) : v);
      tables.push({
        title: "Goals",
        note: goals.length ? undefined : "No goals are set.",
        headers: ["Goal", "Period", "Target", "Actual", "Progress %", "Projected", "Status"],
        fields: ["metric", "period", "target", "actual", "progress", "projected", "status"],
        rows: goals.map((g) => ({
          metric: GOAL_LABEL[g.metric], period: g.period, target: f(g.metric, g.target), actual: f(g.metric, g.actual), progress: g.progressPct,
          projected: g.projected === null ? "" : f(g.metric, g.projected), status: g.status.replace("_", " "),
        })),
      });
    }
  }
  return tables;
}

export function renderPdf(tables: ExportTable[], meta: { rangeLabel: string; generatedAt: string }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.font("Helvetica-Bold").fontSize(20).fillColor("#000").text("Brandthread analytics");
    doc.font("Helvetica").fontSize(10).fillColor("#555").text(`${meta.rangeLabel}  |  Generated ${meta.generatedAt}`);
    doc.moveDown(1);
    const usable = doc.page.width - 96;
    for (const t of tables) {
      if (doc.y > doc.page.height - 140) doc.addPage();
      doc.font("Helvetica-Bold").fontSize(13).fillColor("#000").text(t.title);
      if (t.note) doc.font("Helvetica").fontSize(9).fillColor("#555").text(t.note);
      doc.moveDown(0.4);
      if (t.rows.length > 0) {
        const colW = usable / t.fields.length;
        const line = (cells: string[], bold: boolean) => {
          if (doc.y > doc.page.height - 80) doc.addPage();
          const y = doc.y;
          doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(7).fillColor("#000");
          let h = 0;
          cells.forEach((c, i) => {
            const before = doc.y;
            doc.text(c.length > 40 ? `${c.slice(0, 37)}...` : c, 48 + i * colW, y, { width: colW - 4 });
            h = Math.max(h, doc.y - before);
          });
          doc.y = y + h + 3;
        };
        line(t.headers, true);
        for (const r of t.rows.slice(0, 300)) line(t.fields.map((f) => String(r[f] ?? "")), false);
      } else {
        doc.font("Helvetica").fontSize(9).fillColor("#555").text("No rows for this range.");
      }
      doc.moveDown(1);
    }
    doc.end();
  });
}

router.post("/export", async (req, res) => {
  const parsed = exportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a format, a date range and at least one section", code: "VALIDATION_ERROR" });
    return;
  }
  const { format, range, sections } = parsed.data;
  try {
    const c = await ctx(req, range, parsed.data.tz);
    const tables = await buildExportTables(c.sellerId, c.window, c.tz, sections, c.now);
    const meta = { rangeLabel: rangeLabel(range as InsightRange), generatedAt: c.now.toISOString() };
    const stamp = c.now.toISOString().slice(0, 10);
    if (format === "csv") {
      const parts = [`Brandthread analytics export\nRange: ${meta.rangeLabel}\nGenerated: ${meta.generatedAt}\n`];
      for (const t of tables) {
        parts.push(`${t.title}${t.note ? `\n${t.note}` : ""}\n${toCSV(t.rows, t.fields).replace(/^[^\n]*/, t.headers.join(","))}\n`);
      }
      res.json({ filename: `brandthread-analytics-${range}-${stamp}.csv`, mimeType: "text/csv", encoding: "utf8", data: parts.join("\n") });
      return;
    }
    const pdf = await renderPdf(tables, meta);
    res.json({ filename: `brandthread-analytics-${range}-${stamp}.pdf`, mimeType: "application/pdf", encoding: "base64", data: pdf.toString("base64") });
  } catch (err) { fail(res, req, err, "export"); }
});

export default router;
