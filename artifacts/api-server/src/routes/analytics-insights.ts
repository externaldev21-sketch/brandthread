/**
 * Seller analytics insights — product funnel, thread/video stats, audience,
 * best time to post, monthly goals and CSV/PDF export.
 *
 * Mounted at /api/analytics/insights (team-context aware, so a team member with
 * the analytics permission sees the owner's store). Every query is scoped to the
 * resolved seller id and only ever returns aggregates; audience buckets below
 * the k-anonymity threshold are hidden.
 */
import { Router } from "express";
import PDFDocument from "pdfkit";
import { z } from "@workspace/api-zod";
import { db, sellerGoals } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requirePermission } from "../middlewares/requireRole";
import { parseTzOffsetMinutes } from "../lib/analyticsTime";
import {
  GOAL_METRICS,
  K_ANONYMITY_MIN,
  MIN_EVENTS_FOR_RECOMMENDATION,
  RANGE_DAYS,
  applyKAnonymity,
  buildHeatmap,
  emptyGrid,
  funnelRates,
  goalPacing,
  locationLabel,
  monthWindow,
  parseInsightRange,
  rangeWindow,
  rankSlots,
  type ExportTable,
  type InsightRange,
} from "../lib/sellerInsights";
import { toCSV } from "./seller-export";

const router = Router();
router.use(requireAuth);
router.use(requirePermission("analytics"));

type Rows = Record<string, any>[];
const rowsOf = (result: unknown): Rows => ((result as { rows?: Rows }).rows ?? []) as Rows;
const PAID = sql`o.status != 'cancelled' AND o.paid_at IS NOT NULL`;

function ctx(req: any) {
  const sellerId = req.clerkUserId as string;
  const range = parseInsightRange(req.query?.range ?? req.body?.range);
  const tz = parseTzOffsetMinutes(req.query?.tz ?? req.body?.tz);
  const now = new Date();
  const { start, end } = rangeWindow(range, now, tz);
  return { sellerId, range, tz, now, start, end };
}

// ─── Loaders (shared by the JSON endpoints and the exporter) ─────────────────

export async function loadProductStats(sellerId: string, start: Date, end: Date) {
  const [viewRows, cartRows, saleRows] = await Promise.all([
    // Product views reuse store_visits (product_id set); only products that
    // really belong to this seller count, whatever product_id a client sent.
    db.execute(sql`
      SELECT v.product_id, p.name, count(*)::int AS views,
             count(DISTINCT v.viewer_user_id)::int AS unique_viewers
      FROM store_visits v
      JOIN products p ON p.id = v.product_id AND p.owner_id = ${sellerId}
      WHERE v.seller_id = ${sellerId} AND v.product_id IS NOT NULL
        AND v.created_at >= ${start.toISOString()}::timestamp AND v.created_at < ${end.toISOString()}::timestamp
      GROUP BY v.product_id, p.name`),
    db.execute(sql`
      SELECT e.product_id, p.name, count(*)::int AS add_to_carts,
             count(DISTINCT e.viewer_key)::int AS unique_carters
      FROM seller_product_events e
      JOIN products p ON p.id = e.product_id AND p.owner_id = ${sellerId}
      WHERE e.seller_id = ${sellerId} AND e.event_type = 'add_to_cart'
        AND e.created_at >= ${start.toISOString()}::timestamp AND e.created_at < ${end.toISOString()}::timestamp
      GROUP BY e.product_id, p.name`),
    db.execute(sql`
      SELECT pv.product_id, p.name,
             count(DISTINCT o.id)::int AS purchases,
             coalesce(sum(oi.quantity), 0)::int AS units,
             coalesce(sum(oi.quantity * oi.price_cents), 0)::int AS revenue_cents
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      JOIN product_variants pv ON pv.id = oi.variant_id
      JOIN products p ON p.id = pv.product_id AND p.owner_id = ${sellerId}
      WHERE o.owner_id = ${sellerId} AND ${PAID}
        AND o.created_at >= ${start.toISOString()}::timestamp AND o.created_at < ${end.toISOString()}::timestamp
      GROUP BY pv.product_id, p.name`),
  ]);

  const byId = new Map<string, any>();
  const row = (id: string, name: string) => {
    let r = byId.get(id);
    if (!r) {
      r = { productId: id, name, views: 0, uniqueViewers: 0, addToCarts: 0, purchases: 0, units: 0, revenueCents: 0 };
      byId.set(id, r);
    }
    return r;
  };
  for (const r of rowsOf(viewRows)) Object.assign(row(r.product_id, r.name), { views: r.views, uniqueViewers: r.unique_viewers });
  for (const r of rowsOf(cartRows)) row(r.product_id, r.name).addToCarts = r.add_to_carts;
  for (const r of rowsOf(saleRows)) Object.assign(row(r.product_id, r.name), { purchases: r.purchases, units: r.units, revenueCents: r.revenue_cents });

  const products = [...byId.values()]
    .map((p) => ({ ...p, ...funnelRates(p) }))
    .sort((a, b) => b.revenueCents - a.revenueCents || b.views - a.views || a.name.localeCompare(b.name))
    .slice(0, 100);
  const totals = products.reduce(
    (t, p) => ({
      views: t.views + p.views, addToCarts: t.addToCarts + p.addToCarts, purchases: t.purchases + p.purchases,
      units: t.units + p.units, revenueCents: t.revenueCents + p.revenueCents,
    }),
    { views: 0, addToCarts: 0, purchases: 0, units: 0, revenueCents: 0 },
  );
  return { totals: { ...totals, ...funnelRates(totals) }, products };
}

export async function loadAudience(sellerId: string, start: Date, end: Date) {
  const buyerKey = sql`coalesce(o.buyer_id, lower(o.guest_email), 'order:' || o.id::text)`;
  const [buyerRows, viewerRows, countryRows, regionRows] = await Promise.all([
    db.execute(sql`
      WITH cur AS (
        SELECT DISTINCT ${buyerKey} AS k FROM orders o
        WHERE o.owner_id = ${sellerId} AND ${PAID} AND o.created_at >= ${start.toISOString()}::timestamp AND o.created_at < ${end.toISOString()}::timestamp
      )
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM orders o WHERE o.owner_id = ${sellerId} AND ${PAID}
                 AND o.created_at < ${start.toISOString()}::timestamp AND ${buyerKey} = cur.k))::int AS returning
      FROM cur`),
    db.execute(sql`
      WITH cur AS (
        SELECT DISTINCT viewer_user_id AS k FROM store_visits
        WHERE seller_id = ${sellerId} AND viewer_user_id IS NOT NULL AND created_at >= ${start.toISOString()}::timestamp AND created_at < ${end.toISOString()}::timestamp
      )
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM store_visits s WHERE s.seller_id = ${sellerId}
                 AND s.viewer_user_id = cur.k AND s.created_at < ${start.toISOString()}::timestamp))::int AS returning
      FROM cur`),
    db.execute(sql`
      SELECT upper(trim(o.shipping_address->>'country')) AS country, count(DISTINCT ${buyerKey})::int AS people
      FROM orders o
      WHERE o.owner_id = ${sellerId} AND ${PAID} AND o.created_at >= ${start.toISOString()}::timestamp AND o.created_at < ${end.toISOString()}::timestamp
        AND coalesce(trim(o.shipping_address->>'country'), '') != ''
      GROUP BY 1`),
    db.execute(sql`
      SELECT upper(trim(o.shipping_address->>'country')) AS country,
             upper(trim(o.shipping_address->>'state')) AS region, count(DISTINCT ${buyerKey})::int AS people
      FROM orders o
      WHERE o.owner_id = ${sellerId} AND ${PAID} AND o.created_at >= ${start.toISOString()}::timestamp AND o.created_at < ${end.toISOString()}::timestamp
        AND coalesce(trim(o.shipping_address->>'country'), '') != ''
        AND coalesce(trim(o.shipping_address->>'state'), '') != ''
      GROUP BY 1, 2`),
  ]);

  const split = (r: Record<string, any> | undefined) => {
    const total = Number(r?.total ?? 0);
    const ret = Number(r?.returning ?? 0);
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
  };

  const clean = (r: Rows) => r.flatMap((x) => {
    const l = locationLabel({ country: x.country, state: x.region });
    return l ? [{ country: l.country, region: l.region, people: Number(x.people) }] : [];
  });
  const countries = applyKAnonymity(clean(rowsOf(countryRows)));
  const regions = applyKAnonymity(clean(rowsOf(regionRows)));
  return {
    minGroupSize: K_ANONYMITY_MIN,
    buyers: split(rowsOf(buyerRows)[0]),
    viewers: split(rowsOf(viewerRows)[0]),
    topCountries: countries.shown.sort((a, b) => b.people - a.people || a.country.localeCompare(b.country)).slice(0, 10)
      .map((c) => ({ country: c.country, people: c.people })),
    topRegions: regions.shown.sort((a, b) => b.people - a.people || `${a.country}${a.region}`.localeCompare(`${b.country}${b.region}`)).slice(0, 10)
      .map((c) => ({ country: c.country, region: c.region, people: c.people })),
    hiddenLocations: countries.hiddenBuckets,
  };
}

export async function loadBestTime(sellerId: string, start: Date, end: Date, tz: number) {
  const res = await db.execute(sql`
    SELECT extract(dow FROM t + (${tz} * interval '1 minute'))::int AS dow,
           extract(hour FROM t + (${tz} * interval '1 minute'))::int AS hr,
           count(*)::int AS n
    FROM (
      SELECT i.created_at AS t
      FROM interactions i JOIN posts p ON p.id = i.post_id
      WHERE p.user_id = ${sellerId} AND i.user_id != ${sellerId}
        AND i.type IN ('view', 'like', 'comment', 'repost', 'share', 'shop_click', 'add_to_bag')
        AND i.created_at >= ${start.toISOString()}::timestamp AND i.created_at < ${end.toISOString()}::timestamp
      UNION ALL
      SELECT v.created_at FROM store_visits v
      WHERE v.seller_id = ${sellerId} AND v.created_at >= ${start.toISOString()}::timestamp AND v.created_at < ${end.toISOString()}::timestamp
    ) ev
    GROUP BY 1, 2`);
  const grid = emptyGrid();
  let total = 0;
  for (const r of rowsOf(res)) {
    if (r.dow >= 0 && r.dow <= 6 && r.hr >= 0 && r.hr <= 23) { grid[r.dow][r.hr] = r.n; total += r.n; }
  }
  return {
    grid,
    totalEvents: total,
    minEventsForRecommendation: MIN_EVENTS_FOR_RECOMMENDATION,
    recommended: rankSlots(grid),
  };
}

const VALID_SECONDS = sql`i.value ~ '^[0-9]+(\\.[0-9]+)?$'`;

export async function loadContent(sellerId: string, start: Date, end: Date) {
  const inRange = sql`i.created_at >= ${start.toISOString()}::timestamp AND i.created_at < ${end.toISOString()}::timestamp AND i.user_id != p.user_id`;
  const [postRows, totalRows, saveRows, orderRows, followRows, profileRows] = await Promise.all([
    db.execute(sql`
      SELECT p.id, p.media_type, p.thumbnail_url, p.caption, coalesce(p.published_at, p.created_at) AS published_at,
        count(i.id) FILTER (WHERE i.type = 'view')::int AS views,
        count(i.id) FILTER (WHERE i.type = 'like')::int AS likes,
        count(i.id) FILTER (WHERE i.type = 'comment')::int AS comments,
        count(i.id) FILTER (WHERE i.type IN ('share', 'repost'))::int AS shares,
        count(i.id) FILTER (WHERE i.type = 'shop_click')::int AS clicks
      FROM posts p
      LEFT JOIN interactions i ON i.post_id = p.id AND ${inRange}
      WHERE p.user_id = ${sellerId} AND p.post_status = 'published'
      GROUP BY p.id
      HAVING count(i.id) > 0
      ORDER BY views DESC, p.id
      LIMIT 500`),
    db.execute(sql`
      SELECT count(*) FILTER (WHERE i.type = 'view')::int AS views,
        count(DISTINCT i.user_id) FILTER (WHERE i.type = 'view')::int AS unique_viewers,
        count(*) FILTER (WHERE i.type = 'like')::int AS likes,
        count(*) FILTER (WHERE i.type = 'comment')::int AS comments,
        count(*) FILTER (WHERE i.type IN ('share', 'repost'))::int AS shares,
        count(*) FILTER (WHERE i.type = 'shop_click')::int AS clicks,
        count(*) FILTER (WHERE i.type = 'add_to_bag')::int AS carts,
        avg(i.value::numeric) FILTER (WHERE i.type = 'watch_time' AND ${VALID_SECONDS}) AS avg_watch,
        count(*) FILTER (WHERE i.type = 'watch_time' AND ${VALID_SECONDS})::int AS watch_samples
      FROM interactions i JOIN posts p ON p.id = i.post_id
      WHERE p.user_id = ${sellerId} AND p.post_status = 'published' AND ${inRange}`),
    db.execute(sql`
      SELECT s.target_id, count(*)::int AS n
      FROM saved_items s JOIN posts p ON p.id::text = s.target_id
      WHERE s.item_type = 'post' AND p.user_id = ${sellerId}
        AND s.created_at >= ${start.toISOString()}::timestamp AND s.created_at < ${end.toISOString()}::timestamp
      GROUP BY s.target_id`),
    db.execute(sql`
      SELECT o.source_post_id, count(*)::int AS purchases, coalesce(sum(o.total_cents), 0)::int AS revenue_cents
      FROM orders o
      WHERE o.owner_id = ${sellerId} AND o.source_post_id IS NOT NULL AND ${PAID}
        AND o.created_at >= ${start.toISOString()}::timestamp AND o.created_at < ${end.toISOString()}::timestamp
      GROUP BY o.source_post_id`),
    db.execute(sql`SELECT count(*)::int AS n FROM follows WHERE following_id = ${sellerId} AND created_at >= ${start.toISOString()}::timestamp AND created_at < ${end.toISOString()}::timestamp`),
    db.execute(sql`SELECT count(*)::int AS n FROM store_visits WHERE seller_id = ${sellerId} AND source = 'profile' AND product_id IS NULL AND created_at >= ${start.toISOString()}::timestamp AND created_at < ${end.toISOString()}::timestamp`),
  ]);

  const saves = new Map(rowsOf(saveRows).map((r) => [String(r.target_id), Number(r.n)]));
  const sales = new Map(rowsOf(orderRows).map((r) => [String(r.source_post_id), r]));
  const kind = (t: string) => (t === "video" ? "video" : t === "slideshow" ? "slideshow" : "image");
  const posts = rowsOf(postRows).map((r) => ({
    postId: String(r.id),
    type: kind(r.media_type) as "video" | "slideshow" | "image",
    thumbnailUrl: r.thumbnail_url ?? null,
    caption: r.caption ?? "",
    views: r.views, likes: r.likes, comments: r.comments, saves: saves.get(String(r.id)) ?? 0,
    shares: r.shares, productClicks: r.clicks,
    purchases: Number(sales.get(String(r.id))?.purchases ?? 0),
    revenueCents: Number(sales.get(String(r.id))?.revenue_cents ?? 0),
    // Completion needs the media duration, which is not stored anywhere yet.
    completionRate: null as number | null,
    publishedAt: new Date(r.published_at).toISOString(),
  }));
  // Orders attributed to a post that had no in-range interactions still count.
  const attributed = rowsOf(orderRows);
  const t = rowsOf(totalRows)[0] ?? {};
  return {
    totals: {
      views: Number(t.views ?? 0), uniqueViewers: Number(t.unique_viewers ?? 0), likes: Number(t.likes ?? 0),
      comments: Number(t.comments ?? 0), shares: Number(t.shares ?? 0), productClicks: Number(t.clicks ?? 0),
      addToCarts: Number(t.carts ?? 0),
      saves: [...saves.values()].reduce((a, b) => a + b, 0),
      purchases: attributed.reduce((a, r) => a + Number(r.purchases), 0),
      revenueCents: attributed.reduce((a, r) => a + Number(r.revenue_cents), 0),
      avgWatchSeconds: Number(t.watch_samples ?? 0) > 0 ? Math.round(Number(t.avg_watch) * 10) / 10 : null,
      completionRate: null as number | null,
      followerGrowth: Number(rowsOf(followRows)[0]?.n ?? 0),
      profileVisits: Number(rowsOf(profileRows)[0]?.n ?? 0),
    },
    posts,
    completionNote: "Completion rate needs each post's media duration, which is not recorded yet.",
  };
}

export async function loadGoal(sellerId: string, tz: number, now = new Date()) {
  const [goal] = await db.select().from(sellerGoals).where(eq(sellerGoals.sellerId, sellerId)).limit(1);
  if (!goal) return null;
  const month = monthWindow(now, tz);
  const res = await db.execute(sql`
    SELECT coalesce(sum(o.total_cents), 0)::int AS revenue, count(*)::int AS orders
    FROM orders o
    WHERE o.owner_id = ${sellerId} AND ${PAID} AND o.created_at >= ${month.start.toISOString()}::timestamp AND o.created_at < ${month.end.toISOString()}::timestamp`);
  const r = rowsOf(res)[0] ?? {};
  const actual = Number(goal.metric === "revenue" ? r.revenue : r.orders) || 0;
  return {
    metric: goal.metric as "revenue" | "orders",
    target: goal.targetValue,
    actual,
    month: { start: month.start.toISOString(), end: month.end.toISOString(), daysInMonth: month.daysInMonth },
    ...goalPacing(actual, goal.targetValue, now, month),
  };
}

// ─── Endpoints ───────────────────────────────────────────────────────────────

function fail(res: any, req: any, err: unknown, what: string) {
  req.log?.error?.({ err }, `Failed to load ${what}`);
  res.status(500).json({ error: `Failed to load ${what}` });
}

router.get("/products", async (req, res) => {
  const { sellerId, range, start, end } = ctx(req);
  try {
    res.json({ range, days: RANGE_DAYS[range], ...(await loadProductStats(sellerId, start, end)) });
  } catch (err) { fail(res, req, err, "product stats"); }
});

router.get("/content", async (req, res) => {
  const { sellerId, range, start, end } = ctx(req);
  try {
    res.json({ range, ...(await loadContent(sellerId, start, end)) });
  } catch (err) { fail(res, req, err, "content stats"); }
});

router.get("/audience", async (req, res) => {
  const { sellerId, range, start, end } = ctx(req);
  try {
    res.json({ range, ...(await loadAudience(sellerId, start, end)) });
  } catch (err) { fail(res, req, err, "audience"); }
});

router.get("/best-time", async (req, res) => {
  const { sellerId, range, start, end, tz } = ctx(req);
  try {
    res.json({ range, tzOffsetMinutes: tz, ...(await loadBestTime(sellerId, start, end, tz)) });
  } catch (err) { fail(res, req, err, "best time to post"); }
});

const goalSchema = z.object({
  metric: z.enum(GOAL_METRICS),
  target: z.number().int().positive(),
}).superRefine((g, c) => {
  const max = g.metric === "revenue" ? 1_000_000_000 : 1_000_000; // revenue in cents
  if (g.target > max) c.addIssue({ code: "custom", path: ["target"], message: "Target is too large" });
});

router.get("/goals", async (req, res) => {
  const { sellerId, tz } = ctx(req);
  try {
    res.json({ goal: await loadGoal(sellerId, tz) });
  } catch (err) { fail(res, req, err, "goal"); }
});

router.put("/goals", async (req, res) => {
  const { sellerId, tz } = ctx(req);
  const parsed = goalSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose revenue or orders and a positive whole-number target", code: "VALIDATION_ERROR" });
    return;
  }
  try {
    await db.insert(sellerGoals)
      .values({ sellerId, metric: parsed.data.metric, targetValue: parsed.data.target })
      .onConflictDoUpdate({
        target: sellerGoals.sellerId,
        set: { metric: parsed.data.metric, targetValue: parsed.data.target, updatedAt: new Date() },
      });
    res.json({ goal: await loadGoal(sellerId, tz) });
  } catch (err) { fail(res, req, err, "goal"); }
});

router.delete("/goals", async (req, res) => {
  const { sellerId } = ctx(req);
  try {
    await db.delete(sellerGoals).where(eq(sellerGoals.sellerId, sellerId));
    res.json({ ok: true });
  } catch (err) { fail(res, req, err, "goal"); }
});

// ─── Export ──────────────────────────────────────────────────────────────────

const EXPORT_SECTIONS = ["products", "content", "audience", "best_time", "goal"] as const;
type ExportSectionKey = (typeof EXPORT_SECTIONS)[number];
const exportSchema = z.object({
  format: z.enum(["csv", "pdf"]),
  range: z.enum(["7d", "30d", "90d"]).default("30d"),
  sections: z.array(z.enum(EXPORT_SECTIONS)).min(1).max(EXPORT_SECTIONS.length),
  tz: z.number().optional(),
});

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "AM" : "PM"}`;
const money = (c: number) => (c / 100).toFixed(2);
const pct = (v: number | null) => (v === null ? "" : v);

export async function buildExportTables(sellerId: string, range: InsightRange, tz: number, sections: ExportSectionKey[], now = new Date()): Promise<ExportTable[]> {
  const { start, end } = rangeWindow(range, now, tz);
  const tables: ExportTable[] = [];
  for (const key of EXPORT_SECTIONS.filter((s) => sections.includes(s))) {
    if (key === "products") {
      const d = await loadProductStats(sellerId, start, end);
      tables.push({
        title: "Product performance",
        headers: ["Product", "Views", "Add to cart", "Purchases", "Units", "Revenue", "View to cart %", "Cart to purchase %"],
        fields: ["name", "views", "addToCarts", "purchases", "units", "revenue", "v2c", "c2p"],
        rows: d.products.map((p) => ({
          name: p.name, views: p.views, addToCarts: p.addToCarts, purchases: p.purchases, units: p.units,
          revenue: money(p.revenueCents), v2c: pct(p.viewToCartPct), c2p: pct(p.cartToPurchasePct),
        })),
      });
    } else if (key === "content") {
      const d = await loadContent(sellerId, start, end);
      tables.push({
        title: "Thread and video performance",
        note: d.completionNote,
        headers: ["Post", "Type", "Views", "Likes", "Comments", "Shares", "Product clicks", "Purchases", "Revenue"],
        fields: ["caption", "type", "views", "likes", "comments", "shares", "productClicks", "purchases", "revenue"],
        rows: d.posts.map((p) => ({ ...p, revenue: money(p.revenueCents) })),
      });
    } else if (key === "audience") {
      const d = await loadAudience(sellerId, start, end);
      const rows: Record<string, unknown>[] = [];
      if (d.buyers.new !== null) rows.push({ group: "New buyers", people: d.buyers.new });
      if (d.buyers.returning !== null) rows.push({ group: "Returning buyers", people: d.buyers.returning });
      if (d.viewers.new !== null) rows.push({ group: "New viewers", people: d.viewers.new });
      if (d.viewers.returning !== null) rows.push({ group: "Returning viewers", people: d.viewers.returning });
      for (const c of d.topCountries) rows.push({ group: `Country: ${c.country}`, people: c.people });
      for (const r of d.topRegions) rows.push({ group: `Region: ${r.country} ${r.region}`, people: r.people });
      tables.push({
        title: "Audience",
        note: `Groups with fewer than ${K_ANONYMITY_MIN} people are not shown.`,
        headers: ["Group", "People"], fields: ["group", "people"], rows,
      });
    } else if (key === "best_time") {
      const d = await loadBestTime(sellerId, start, end, tz);
      tables.push({
        title: "Best time to post",
        note: d.recommended.length === 0 ? `Not enough engagement yet (${d.totalEvents} of ${d.minEventsForRecommendation} needed).` : undefined,
        headers: ["Rank", "Day", "Time", "Engagement"], fields: ["rank", "day", "time", "count"],
        rows: d.recommended.map((s, i) => ({ rank: i + 1, day: DAY_NAMES[s.day], time: hourLabel(s.hour), count: s.count })),
      });
    } else if (key === "goal") {
      const g = await loadGoal(sellerId, tz, now);
      const isRev = g?.metric === "revenue";
      const f = (n: number) => (isRev ? money(n) : n);
      tables.push({
        title: "Monthly goal",
        note: g ? undefined : "No goal is set.",
        headers: ["Metric", "Target", "Actual", "Progress %", "Projected", "Status"],
        fields: ["metric", "target", "actual", "progress", "projected", "status"],
        rows: g ? [{
          metric: g.metric, target: f(g.target), actual: f(g.actual), progress: g.progressPct,
          projected: g.projected === null ? "" : f(g.projected), status: g.status.replace("_", " "),
        }] : [],
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
          doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8).fillColor("#000");
          let h = 0;
          cells.forEach((c, i) => {
            const before = doc.y;
            doc.text(c.length > 60 ? `${c.slice(0, 57)}...` : c, 48 + i * colW, y, { width: colW - 6 });
            h = Math.max(h, doc.y - before);
          });
          doc.y = y + h + 3;
        };
        line(t.headers, true);
        for (const r of t.rows.slice(0, 200)) line(t.fields.map((f) => String(r[f] ?? "")), false);
      }
      doc.moveDown(1);
    }
    doc.end();
  });
}

router.post("/export", async (req, res) => {
  const { sellerId } = ctx(req);
  const parsed = exportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a format, a date range and at least one section", code: "VALIDATION_ERROR" });
    return;
  }
  const { format, range, sections } = parsed.data;
  const tz = parseTzOffsetMinutes(parsed.data.tz);
  try {
    const now = new Date();
    const tables = await buildExportTables(sellerId, range, tz, sections, now);
    const meta = { rangeLabel: `Last ${RANGE_DAYS[range]} days`, generatedAt: now.toISOString() };
    const stamp = now.toISOString().slice(0, 10);
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
