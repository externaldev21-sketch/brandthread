/**
 * Giveaways.
 *
 * Seller router  -> /api/seller/giveaways   (team context + marketing permission)
 * Public router  -> /api/giveaways          (live giveaway for a profile, public detail by share code,
 *                                            signed-in viewer's own entry status)
 */
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import {
  db,
  giveawayDraws,
  giveawayEntries,
  giveaways,
  giveawayWinners,
  posts,
  products,
  users,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { requirePermission } from "../middlewares/requireRole";
import { rateLimit } from "../middlewares/rateLimit";
import {
  buildRulesTemplate,
  drawGiveaway,
  generateShareCode,
  giveawayPhase,
  GiveawayError,
  materialiseAllEntries,
  materialiseEntryFor,
  redrawWinner,
  SHARE_BASE_URL,
  validateGiveawayInput, withPlatformDisclaimer } from "../lib/giveaways";

type GiveawayRow = typeof giveaways.$inferSelect;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function serialize(g: GiveawayRow, now = new Date()) {
  return {
    id: g.id,
    shareCode: g.shareCode,
    shareUrl: `${SHARE_BASE_URL}${g.shareCode}`,
    sellerId: g.sellerId,
    title: g.title,
    prizeText: g.prizeText,
    productId: g.productId,
    postId: g.postId,
    startsAt: g.startsAt.toISOString(),
    endsAt: g.endsAt.toISOString(),
    // Rows saved before QA-0100 get the Apple / Google disclaimer on the way out.
    rulesText: withPlatformDisclaimer(g.rulesText),
    eligibility: g.eligibility,
    region: g.region,
    winnerCount: g.winnerCount,
    status: g.status,
    phase: giveawayPhase(g, now),
    drawnAt: g.drawnAt?.toISOString() ?? null,
    createdAt: g.createdAt.toISOString(),
  };
}

async function loadOwned(sellerId: string, id: string): Promise<GiveawayRow | null> {
  if (!UUID_RE.test(id)) return null;
  const [g] = await db.select().from(giveaways)
    .where(and(eq(giveaways.id, id), eq(giveaways.sellerId, sellerId))).limit(1);
  return g ?? null;
}

async function profileFor(ids: string[]) {
  if (ids.length === 0) return new Map<string, { name: string; handle: string | null; avatarUrl: string | null }>();
  const rows = await db.select({
    clerkId: users.clerkId, displayName: users.displayName, name: users.name,
    username: users.username, avatarUrl: users.avatarUrl, profileImageUrl: users.profileImageUrl,
  }).from(users).where(inArray(users.clerkId, ids));
  const map = new Map<string, { name: string; handle: string | null; avatarUrl: string | null }>();
  for (const r of rows) {
    const img = [r.profileImageUrl, r.avatarUrl].find((u) => typeof u === "string" && u.startsWith("http")) ?? null;
    map.set(r.clerkId, { name: r.displayName || r.name || r.username || "Member", handle: r.username ?? null, avatarUrl: img });
  }
  return map;
}

function sendError(res: any, req: any, err: unknown, fallback: string) {
  if (err instanceof GiveawayError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  req.log.error({ err }, fallback);
  res.status(500).json({ error: "Internal server error" });
}

// ═════════════════════════════════════════════════════════════════════════════
// Seller router
// ═════════════════════════════════════════════════════════════════════════════
export const sellerGiveawaysRouter = Router();
sellerGiveawaysRouter.use(requireAuth);
sellerGiveawaysRouter.use(requirePermission("marketing"));

async function checkOwnedRefs(sellerId: string, productId: string | null, postId: string | null): Promise<string | null> {
  if (productId) {
    const [p] = await db.select({ id: products.id }).from(products)
      .where(and(eq(products.id, productId), eq(products.ownerId, sellerId), sql`${products.deletedAt} IS NULL`)).limit(1);
    if (!p) return "The prize product must be one of your products.";
  }
  if (postId) {
    const [p] = await db.select({ id: posts.id }).from(posts)
      .where(and(eq(posts.id, postId), eq(posts.userId, sellerId), eq(posts.postStatus, "published"))).limit(1);
    if (!p) return "The entry post must be one of your published posts.";
  }
  return null;
}

// GET /rules-template?prizeText=&startsAt=&endsAt=&winnerCount=&region=&eligibility=&postEntry=1
sellerGiveawaysRouter.get("/rules-template", async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const q = req.query as Record<string, string | undefined>;
    const profiles = await profileFor([sellerId]);
    const startsAt = new Date(q.startsAt ?? Date.now());
    const endsAt = new Date(q.endsAt ?? Date.now() + 7 * 86_400_000);
    res.json({
      rulesText: buildRulesTemplate({
        sellerName: profiles.get(sellerId)?.name ?? "the brand",
        prizeText: (q.prizeText ?? "").trim() || "the prize described above",
        startsAt: Number.isNaN(startsAt.getTime()) ? new Date() : startsAt,
        endsAt: Number.isNaN(endsAt.getTime()) ? new Date(Date.now() + 7 * 86_400_000) : endsAt,
        winnerCount: Math.max(1, Math.min(50, Number.parseInt(q.winnerCount ?? "1", 10) || 1)),
        region: q.region, eligibility: q.eligibility, postEntry: q.postEntry === "1",
      }),
    });
  } catch (err) { sendError(res, req, err, "Failed to build rules template"); }
});

sellerGiveawaysRouter.get("/", async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const rows = await db.select().from(giveaways)
      .where(eq(giveaways.sellerId, sellerId)).orderBy(desc(giveaways.createdAt)).limit(50);
    const ids = rows.map((g) => g.id);
    const counts = ids.length
      ? await db.select({
        giveawayId: giveawayEntries.giveawayId,
        entries: sql<number>`count(*) FILTER (WHERE ${giveawayEntries.eligible})::int`,
      }).from(giveawayEntries).where(inArray(giveawayEntries.giveawayId, ids)).groupBy(giveawayEntries.giveawayId)
      : [];
    const byId = new Map(counts.map((c) => [c.giveawayId, c.entries]));
    res.json({ giveaways: rows.map((g) => ({ ...serialize(g), entryCount: byId.get(g.id) ?? 0 })) });
  } catch (err) { sendError(res, req, err, "Failed to list giveaways"); }
});

sellerGiveawaysRouter.post("/", rateLimit("mutation"), async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const parsed = validateGiveawayInput(req.body);
    if (!parsed.ok) { res.status(400).json({ error: parsed.error, code: "INVALID_GIVEAWAY" }); return; }
    const v = parsed.value;
    const refError = await checkOwnedRefs(sellerId, v.productId, v.postId);
    if (refError) { res.status(400).json({ error: refError, code: "INVALID_REFERENCE" }); return; }

    const created = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"giveaway_create:" + sellerId}))`);
      // One running giveaway at a time keeps the profile card unambiguous.
      const [overlap] = await tx.select({ id: giveaways.id }).from(giveaways).where(and(
        eq(giveaways.sellerId, sellerId),
        eq(giveaways.status, "open"),
        sql`${giveaways.startsAt} < ${v.endsAt.toISOString()}::timestamptz`,
        sql`${giveaways.endsAt} > ${v.startsAt.toISOString()}::timestamptz`,
      )).limit(1);
      if (overlap) return null;
      const [row] = await tx.insert(giveaways).values({
        sellerId, shareCode: generateShareCode(), title: v.title, prizeText: v.prizeText,
        productId: v.productId, postId: v.postId, startsAt: v.startsAt, endsAt: v.endsAt,
        rulesText: v.rulesText, eligibility: v.eligibility, region: v.region, winnerCount: v.winnerCount,
      }).returning();
      return row!;
    });
    if (!created) {
      res.status(409).json({ error: "You already have a giveaway running in that period.", code: "GIVEAWAY_OVERLAP" });
      return;
    }
    res.status(201).json(serialize(created));
  } catch (err) { sendError(res, req, err, "Failed to create giveaway"); }
});

async function detail(g: GiveawayRow) {
  const phase = giveawayPhase(g);
  // Keep the entrant count honest while the giveaway is still running or awaiting a draw.
  if (g.status === "open") await materialiseAllEntries(g);
  const [counts] = await db.select({
    total: sql<number>`count(*)::int`,
    eligible: sql<number>`count(*) FILTER (WHERE ${giveawayEntries.eligible})::int`,
  }).from(giveawayEntries).where(eq(giveawayEntries.giveawayId, g.id));
  const [winnerRows, draws] = await Promise.all([
    db.select().from(giveawayWinners).where(eq(giveawayWinners.giveawayId, g.id))
      .orderBy(asc(giveawayWinners.position), asc(giveawayWinners.createdAt)),
    db.select().from(giveawayDraws).where(eq(giveawayDraws.giveawayId, g.id)).orderBy(asc(giveawayDraws.drawNumber)),
  ]);
  const profiles = await profileFor([...new Set(winnerRows.map((w) => w.userId))]);
  const prof = (id: string) => profiles.get(id) ?? { name: "Member", handle: null, avatarUrl: null };
  return {
    ...serialize(g),
    phase,
    entries: { total: counts?.total ?? 0, eligible: counts?.eligible ?? 0 },
    winners: winnerRows.map((w) => ({
      id: w.id, userId: w.userId, position: w.position, status: w.status,
      name: prof(w.userId).name, handle: prof(w.userId).handle, avatarUrl: prof(w.userId).avatarUrl,
      replacedReason: w.replacedReason, replacedAt: w.replacedAt?.toISOString() ?? null,
      notifiedAt: w.notifiedAt?.toISOString() ?? null, shippedAt: w.shippedAt?.toISOString() ?? null,
    })),
    draws: draws.map((d) => ({
      id: d.id, drawNumber: d.drawNumber, eligibleCount: d.eligibleCount, eligibleHash: d.eligibleHash,
      winnerIds: d.winnerIds, reason: d.reason, drawnAt: d.drawnAt.toISOString(),
    })),
  };
}

sellerGiveawaysRouter.get("/:id", async (req, res) => {
  try {
    const g = await loadOwned((req as any).clerkUserId, String(req.params.id));
    if (!g) { res.status(404).json({ error: "Giveaway not found" }); return; }
    res.json(await detail(g));
  } catch (err) { sendError(res, req, err, "Failed to load giveaway"); }
});

sellerGiveawaysRouter.patch("/:id", rateLimit("mutation"), async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const g = await loadOwned(sellerId, String(req.params.id));
    if (!g) { res.status(404).json({ error: "Giveaway not found" }); return; }
    if (g.status !== "open") { res.status(409).json({ error: "This giveaway can no longer be edited.", code: "NOT_EDITABLE" }); return; }
    const merged = {
      title: g.title, prizeText: g.prizeText, productId: g.productId, postId: g.postId,
      startsAt: g.startsAt.toISOString(), endsAt: g.endsAt.toISOString(), rulesText: g.rulesText,
      eligibility: g.eligibility, region: g.region, winnerCount: g.winnerCount,
      ...(req.body ?? {}),
    };
    const parsed = validateGiveawayInput(merged, new Date(), { requireFutureEnd: false });
    if (!parsed.ok) { res.status(400).json({ error: parsed.error, code: "INVALID_GIVEAWAY" }); return; }
    const v = parsed.value;
    if (Date.now() >= g.startsAt.getTime() && (v.postId !== g.postId || v.startsAt.getTime() !== g.startsAt.getTime())) {
      res.status(409).json({ error: "The entry post and start can't change once the giveaway has started.", code: "LOCKED_AFTER_START" });
      return;
    }
    const refError = await checkOwnedRefs(sellerId, v.productId, v.postId);
    if (refError) { res.status(400).json({ error: refError, code: "INVALID_REFERENCE" }); return; }
    const [row] = await db.update(giveaways).set({
      title: v.title, prizeText: v.prizeText, productId: v.productId, postId: v.postId,
      startsAt: v.startsAt, endsAt: v.endsAt, rulesText: v.rulesText, eligibility: v.eligibility,
      region: v.region, winnerCount: v.winnerCount, updatedAt: new Date(),
    }).where(and(eq(giveaways.id, g.id), eq(giveaways.status, "open"))).returning();
    if (!row) { res.status(409).json({ error: "This giveaway can no longer be edited.", code: "NOT_EDITABLE" }); return; }
    res.json(serialize(row));
  } catch (err) { sendError(res, req, err, "Failed to update giveaway"); }
});

sellerGiveawaysRouter.post("/:id/end", rateLimit("mutation"), async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const g = await loadOwned(sellerId, String(req.params.id));
    if (!g) { res.status(404).json({ error: "Giveaway not found" }); return; }
    if (giveawayPhase(g) !== "live") { res.status(409).json({ error: "Only a live giveaway can be ended early.", code: "NOT_LIVE" }); return; }
    const [row] = await db.update(giveaways).set({ endsAt: new Date(), updatedAt: new Date() })
      .where(and(eq(giveaways.id, g.id), eq(giveaways.status, "open"))).returning();
    res.json(serialize(row ?? g));
  } catch (err) { sendError(res, req, err, "Failed to end giveaway"); }
});

sellerGiveawaysRouter.post("/:id/cancel", rateLimit("mutation"), async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const g = await loadOwned(sellerId, String(req.params.id));
    if (!g) { res.status(404).json({ error: "Giveaway not found" }); return; }
    if (g.status !== "open") { res.status(409).json({ error: "This giveaway can't be cancelled.", code: "NOT_CANCELLABLE" }); return; }
    const [row] = await db.update(giveaways).set({ status: "cancelled", updatedAt: new Date() })
      .where(and(eq(giveaways.id, g.id), eq(giveaways.status, "open"))).returning();
    res.json(serialize(row ?? g));
  } catch (err) { sendError(res, req, err, "Failed to cancel giveaway"); }
});

sellerGiveawaysRouter.post("/:id/draw", rateLimit("mutation"), async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) { res.status(404).json({ error: "Giveaway not found" }); return; }
    await drawGiveaway(id, sellerId);
    const g = await loadOwned(sellerId, id);
    res.status(201).json(await detail(g!));
  } catch (err) { sendError(res, req, err, "Failed to draw giveaway"); }
});

sellerGiveawaysRouter.post("/:id/winners/:winnerId/redraw", rateLimit("mutation"), async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const id = String(req.params.id);
    const winnerId = String(req.params.winnerId);
    if (!UUID_RE.test(id) || !UUID_RE.test(winnerId)) { res.status(404).json({ error: "Winner not found" }); return; }
    const reason = typeof req.body?.reason === "string" ? req.body.reason : "";
    await redrawWinner(id, sellerId, winnerId, reason);
    const g = await loadOwned(sellerId, id);
    res.status(201).json(await detail(g!));
  } catch (err) { sendError(res, req, err, "Failed to redraw winner"); }
});

sellerGiveawaysRouter.post("/:id/winners/:winnerId/shipped", rateLimit("mutation"), async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const g = await loadOwned(sellerId, String(req.params.id));
    const winnerId = String(req.params.winnerId);
    if (!g || !UUID_RE.test(winnerId)) { res.status(404).json({ error: "Winner not found" }); return; }
    const shipped = req.body?.shipped !== false;
    const [row] = await db.update(giveawayWinners)
      .set({ shippedAt: shipped ? new Date() : null })
      .where(and(eq(giveawayWinners.id, winnerId), eq(giveawayWinners.giveawayId, g.id), eq(giveawayWinners.status, "active")))
      .returning();
    if (!row) { res.status(404).json({ error: "Winner not found" }); return; }
    res.json({ id: row.id, shippedAt: row.shippedAt?.toISOString() ?? null });
  } catch (err) { sendError(res, req, err, "Failed to update shipment"); }
});

// ═════════════════════════════════════════════════════════════════════════════
// Public / buyer router
// ═════════════════════════════════════════════════════════════════════════════
export const publicGiveawaysRouter = Router();

async function publicShape(g: GiveawayRow, viewerId: string | null) {
  const seller = (await profileFor([g.sellerId])).get(g.sellerId);
  let product: { id: string; name: string; image: string | null } | null = null;
  if (g.productId) {
    const [p] = await db.select({ id: products.id, name: products.name, images: products.images })
      .from(products).where(and(eq(products.id, g.productId), sql`${products.deletedAt} IS NULL`)).limit(1);
    if (p) product = { id: p.id, name: p.name, image: p.images?.[0] ?? null };
  }
  let winners: { name: string; handle: string | null; avatarUrl: string | null }[] = [];
  let youWon = false;
  if (g.status === "drawn") {
    const rows = await db.select().from(giveawayWinners)
      .where(and(eq(giveawayWinners.giveawayId, g.id), eq(giveawayWinners.status, "active")))
      .orderBy(asc(giveawayWinners.position));
    const profiles = await profileFor(rows.map((w) => w.userId));
    winners = rows.map((w) => profiles.get(w.userId) ?? { name: "Member", handle: null, avatarUrl: null });
    youWon = !!viewerId && rows.some((w) => w.userId === viewerId);
  }
  let me: Record<string, unknown> | null = null;
  if (viewerId && viewerId !== g.sellerId) {
    const phase = giveawayPhase(g);
    const d = phase === "live" || phase === "ended" || phase === "drawn"
      ? await materialiseEntryFor(g, viewerId)
      : null;
    me = d
      ? { followed: d.followed, commented: d.commented, eligible: d.eligible, excludedReason: d.excludedReason }
      : { followed: false, commented: false, eligible: false, excludedReason: null };
  }
  const ser = serialize(g);
  // sellerId is already public (profile URLs); everything else here is entry-page content.
  return {
    ...ser,
    seller: { id: g.sellerId, name: seller?.name ?? "Brand", handle: seller?.handle ?? null, avatarUrl: seller?.avatarUrl ?? null },
    product,
    requiresComment: !!g.postId,
    winners,
    youWon,
    me,
    isOwner: viewerId === g.sellerId,
  };
}

// GET /api/giveaways/seller/:sellerId/live — the running giveaway for a profile, or null.
publicGiveawaysRouter.get("/seller/:sellerId/live", rateLimit("public-read"), async (req, res) => {
  try {
    const sellerId = String(req.params.sellerId);
    if (sellerId.length > 200) { res.json({ giveaway: null }); return; }
    const now = new Date();
    const [g] = await db.select().from(giveaways).where(and(
      eq(giveaways.sellerId, sellerId),
      eq(giveaways.status, "open"),
      sql`${giveaways.startsAt} <= ${now.toISOString()}::timestamptz`,
      sql`${giveaways.endsAt} > ${now.toISOString()}::timestamptz`,
    )).orderBy(desc(giveaways.startsAt)).limit(1);
    if (!g) { res.json({ giveaway: null }); return; }
    const { userId } = getAuth(req);
    res.json({ giveaway: await publicShape(g, userId ?? null) });
  } catch (err) { sendError(res, req, err, "Failed to load live giveaway"); }
});

// GET /api/giveaways/:code — public detail (+ the signed-in viewer's own entry status).
publicGiveawaysRouter.get("/:code", rateLimit("public-read"), async (req, res) => {
  try {
    const code = String(req.params.code).toUpperCase();
    if (!/^[A-Z0-9]{6,12}$/.test(code)) { res.status(404).json({ error: "Giveaway not found" }); return; }
    const [g] = await db.select().from(giveaways)
      .where(and(eq(giveaways.shareCode, code), ne(giveaways.status, "cancelled"))).limit(1);
    if (!g) {
      res.status(404).json({ error: "Giveaway not found" }); return;
    }
    const { userId } = getAuth(req);
    res.json(await publicShape(g, userId ?? null));
  } catch (err) { sendError(res, req, err, "Failed to load giveaway"); }
});

