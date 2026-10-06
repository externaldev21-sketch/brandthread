/**
 * Seller growth tools (mounted at /growth, behind requireAuth + team context):
 *   tracked UTM links + per-link stats, link-in-bio editor + stats, store pixels.
 * Everything is scoped to req.clerkUserId (the store owner under team context).
 */
import { Router } from "express";
import {
  db, trackedLinks, linkClicks, bioPages, bioLinks, bioEvents, storePixels, products, productVariants, users, storefronts,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import crypto from "node:crypto";
import { requireAuth } from "../middlewares/requireAuth";
import { requirePermission } from "../middlewares/requireRole";
import { generateUniqueLinkCode } from "../lib/growth/linkCodes";
import { UTM_PRESETS, validateLinkInput } from "../lib/growth/utm";
import { bioPageUrl, resolveStoreHome, shortLinkUrl } from "../lib/growth/destinations";
import {
  BIO_SLUG_RE, MAX_BIO_LINKS, MAX_FEATURED, cleanText, normalizeAccent, normalizeBioLinkUrl, normalizeSocials, slugifyBio,
} from "../lib/growth/bioValidation";
import { validateMetaPixelId, validateTikTokPixelId } from "../lib/growth/pixels";

const router = Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sellerOf = (req: any): string => req.clerkUserId as string;
const days = (req: any): number => Math.min(90, Math.max(1, Number(req.query?.days) || 30));

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === "23505" || (err as { cause?: { code?: string } })?.cause?.code === "23505";
}

type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => ((r as { rows?: Row[] }).rows ?? []);

// ───────────────────────────── Tracked links ─────────────────────────────

async function linkStats(sellerId: string, ids: string[]) {
  const clicks = new Map<string, number>();
  const orders = new Map<string, { orders: number; revenueCents: number }>();
  if (ids.length === 0) return { clicks, orders };
  const idList = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
  const c = await db.execute(sql`
    SELECT link_id, count(*)::int AS n FROM link_clicks
    WHERE seller_id = ${sellerId} AND link_id IN (${idList}) GROUP BY link_id`);
  for (const r of rowsOf(c)) clicks.set(String(r.link_id), Number(r.n));
  const o = await db.execute(sql`
    SELECT ca.link_id, count(o.id)::int AS n,
           coalesce(sum(greatest(o.total_cents - o.refunded_cents, 0)), 0)::bigint AS revenue
    FROM checkout_attributions ca
    JOIN orders o ON o.stripe_checkout_session_id = ca.stripe_session_id AND o.owner_id = ca.seller_id
    WHERE ca.seller_id = ${sellerId} AND ca.link_id IN (${idList})
      AND o.status NOT IN ('cancelled', 'refund_pending')
    GROUP BY ca.link_id`);
  for (const r of rowsOf(o)) orders.set(String(r.link_id), { orders: Number(r.n), revenueCents: Number(r.revenue) });
  return { clicks, orders };
}

function serializeLink(l: typeof trackedLinks.$inferSelect, stats: Awaited<ReturnType<typeof linkStats>>) {
  const o = stats.orders.get(l.id);
  return {
    id: l.id, code: l.code, url: shortLinkUrl(l.code), label: l.label,
    destinationType: l.destinationType, destinationRef: l.destinationRef,
    utmSource: l.utmSource, utmMedium: l.utmMedium, utmCampaign: l.utmCampaign, utmTerm: l.utmTerm, utmContent: l.utmContent,
    archived: !!l.archivedAt, createdAt: l.createdAt.toISOString(),
    clicks: stats.clicks.get(l.id) ?? 0, orders: o?.orders ?? 0, revenueCents: o?.revenueCents ?? 0,
  };
}

router.get("/utm-presets", (_req, res) => { res.json(UTM_PRESETS); });

router.get("/destinations", async (req, res) => {
  try {
    const sellerId = sellerOf(req);
    const [storeHome, bio, prods] = await Promise.all([
      resolveStoreHome(sellerId),
      db.select({ slug: bioPages.slug, published: bioPages.published }).from(bioPages).where(eq(bioPages.sellerId, sellerId)).limit(1),
      db.select({ id: products.id, name: products.name, images: products.images }).from(products)
        .where(and(eq(products.ownerId, sellerId), eq(products.status, "active"), isNull(products.deletedAt)))
        .orderBy(desc(products.createdAt)).limit(100),
    ]);
    res.json({
      store: { available: !!storeHome },
      bio: { available: !!bio[0]?.published, url: bio[0] ? bioPageUrl(bio[0].slug) : null },
      products: prods.map((p) => ({ id: p.id, name: p.name, image: Array.isArray(p.images) ? (p.images as string[])[0] ?? null : null })),
    });
  } catch (err) {
    req.log.error({ err }, "growth destinations failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/links", async (req, res) => {
  try {
    const sellerId = sellerOf(req);
    const rows = await db.select().from(trackedLinks)
      .where(and(eq(trackedLinks.sellerId, sellerId), isNull(trackedLinks.archivedAt)))
      .orderBy(desc(trackedLinks.createdAt)).limit(200);
    const stats = await linkStats(sellerId, rows.map((r) => r.id));
    res.json(rows.map((r) => serializeLink(r, stats)));
  } catch (err) {
    req.log.error({ err }, "list tracked links failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/links", requirePermission("marketing"), async (req, res) => {
  const sellerId = sellerOf(req);
  const parsed = validateLinkInput(req.body);
  if (!parsed.ok) { res.status(400).json({ error: parsed.error }); return; }
  const v = parsed.value;
  try {
    if (v.destinationType === "product") {
      const [p] = await db.select({ id: products.id }).from(products)
        .where(and(eq(products.id, v.destinationRef!), eq(products.ownerId, sellerId), eq(products.status, "active"), isNull(products.deletedAt))).limit(1);
      if (!p) { res.status(404).json({ error: "Product not found" }); return; }
    }
    if (v.destinationType === "store" && !(await resolveStoreHome(sellerId))) {
      res.status(409).json({ error: "Publish your store or set a username first" }); return;
    }
    if (v.destinationType === "bio") {
      const [b] = await db.select({ p: bioPages.published }).from(bioPages).where(eq(bioPages.sellerId, sellerId)).limit(1);
      if (!b?.p) { res.status(409).json({ error: "Set up your link-in-bio page first" }); return; }
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = await generateUniqueLinkCode(async (c) => {
        const [hit] = await db.select({ id: trackedLinks.id }).from(trackedLinks).where(eq(trackedLinks.code, c)).limit(1);
        return !!hit;
      });
      try {
        const [row] = await db.insert(trackedLinks).values({
          sellerId, code, label: v.label, destinationType: v.destinationType, destinationRef: v.destinationRef,
          utmSource: v.utm.source, utmMedium: v.utm.medium, utmCampaign: v.utm.campaign, utmTerm: v.utm.term, utmContent: v.utm.content,
        }).returning();
        res.status(201).json(serializeLink(row, { clicks: new Map(), orders: new Map() }));
        return;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    res.status(503).json({ error: "Could not allocate a link code, try again" });
  } catch (err) {
    req.log.error({ err }, "create tracked link failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

async function ownedLink(req: any, res: any) {
  const id = req.params.id;
  if (typeof id !== "string" || !UUID_RE.test(id)) { res.status(404).json({ error: "Link not found" }); return null; }
  const [row] = await db.select().from(trackedLinks).where(and(eq(trackedLinks.id, id), eq(trackedLinks.sellerId, sellerOf(req)))).limit(1);
  if (!row) { res.status(404).json({ error: "Link not found" }); return null; }
  return row;
}

router.get("/links/:id", async (req, res) => {
  try {
    const link = await ownedLink(req, res);
    if (!link) return;
    const sellerId = sellerOf(req);
    const n = days(req);
    const since = new Date(Date.now() - n * 86_400_000);
    const stats = await linkStats(sellerId, [link.id]);
    const [daily, countries, referrers, orderDaily] = await Promise.all([
      db.execute(sql`SELECT to_char(created_at::date, 'YYYY-MM-DD') AS day, count(*)::int AS n FROM link_clicks
        WHERE link_id = ${link.id}::uuid AND seller_id = ${sellerId} AND created_at >= ${since} GROUP BY 1 ORDER BY 1`),
      db.execute(sql`SELECT coalesce(country, 'Unknown') AS label, count(*)::int AS n FROM link_clicks
        WHERE link_id = ${link.id}::uuid AND seller_id = ${sellerId} AND created_at >= ${since} GROUP BY 1 ORDER BY n DESC LIMIT 5`),
      db.execute(sql`SELECT coalesce(referrer_host, 'Direct') AS label, count(*)::int AS n FROM link_clicks
        WHERE link_id = ${link.id}::uuid AND seller_id = ${sellerId} AND created_at >= ${since} GROUP BY 1 ORDER BY n DESC LIMIT 5`),
      db.execute(sql`SELECT to_char(o.created_at::date, 'YYYY-MM-DD') AS day, count(*)::int AS n,
          coalesce(sum(greatest(o.total_cents - o.refunded_cents, 0)), 0)::bigint AS revenue
        FROM checkout_attributions ca JOIN orders o ON o.stripe_checkout_session_id = ca.stripe_session_id AND o.owner_id = ca.seller_id
        WHERE ca.link_id = ${link.id}::uuid AND ca.seller_id = ${sellerId} AND o.created_at >= ${since}
          AND o.status NOT IN ('cancelled', 'refund_pending') GROUP BY 1 ORDER BY 1`),
    ]);
    const byDay = new Map(rowsOf(daily).map((r) => [String(r.day), Number(r.n)]));
    const ordersByDay = new Map(rowsOf(orderDaily).map((r) => [String(r.day), { orders: Number(r.n), revenueCents: Number(r.revenue) }]));
    const series: { day: string; clicks: number; orders: number; revenueCents: number }[] = [];
    for (let i = n - 1; i >= 0; i--) {
      const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
      series.push({ day, clicks: byDay.get(day) ?? 0, orders: ordersByDay.get(day)?.orders ?? 0, revenueCents: ordersByDay.get(day)?.revenueCents ?? 0 });
    }
    const base = serializeLink(link, stats);
    res.json({
      ...base,
      conversionRate: base.clicks > 0 ? base.orders / base.clicks : 0,
      series,
      countries: rowsOf(countries).map((r) => ({ label: String(r.label), count: Number(r.n) })),
      referrers: rowsOf(referrers).map((r) => ({ label: String(r.label), count: Number(r.n) })),
    });
  } catch (err) {
    req.log.error({ err }, "tracked link detail failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/links/:id", requirePermission("marketing"), async (req, res) => {
  try {
    const link = await ownedLink(req, res);
    if (!link) return;
    const patch: Partial<typeof trackedLinks.$inferInsert> = {};
    if (typeof req.body?.label === "string") patch.label = req.body.label.trim().slice(0, 80);
    if (typeof req.body?.archived === "boolean") patch.archivedAt = req.body.archived ? new Date() : null;
    if (Object.keys(patch).length === 0) { res.status(400).json({ error: "Nothing to update" }); return; }
    const [row] = await db.update(trackedLinks).set(patch).where(eq(trackedLinks.id, link.id)).returning();
    res.json(serializeLink(row, await linkStats(sellerOf(req), [row.id])));
  } catch (err) {
    req.log.error({ err }, "update tracked link failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/links/:id", requirePermission("marketing"), async (req, res) => {
  try {
    const link = await ownedLink(req, res);
    if (!link) return;
    // Soft delete: the short URL stops redirecting but historical stats stay intact.
    await db.update(trackedLinks).set({ archivedAt: new Date() }).where(eq(trackedLinks.id, link.id));
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "archive tracked link failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ───────────────────────────── Link in bio ─────────────────────────────

async function profileDefaults(sellerId: string) {
  const [u] = await db.select({
    username: users.username, displayName: users.displayName, name: users.name, brandName: users.brandName,
    bio: users.bio, profileImageUrl: users.profileImageUrl, avatarUrl: users.avatarUrl,
  }).from(users).where(eq(users.clerkId, sellerId)).limit(1);
  const https = (s?: string | null) => (s && /^https:\/\//i.test(s) ? s : null);
  return {
    username: u?.username ?? null,
    displayName: u?.brandName || u?.displayName || u?.name || "",
    bio: u?.bio ?? "",
    avatarUrl: https(u?.profileImageUrl) ?? https(u?.avatarUrl),
  };
}

async function allocateSlug(sellerId: string, hint: { username: string | null; displayName: string }): Promise<string> {
  const candidates = [hint.username ? slugifyBio(hint.username) : "", slugifyBio(hint.displayName)].filter(Boolean);
  const base = candidates[0] || `store-${crypto.randomBytes(3).toString("hex")}`;
  for (let i = 0; i < 20; i++) {
    const slug = i === 0 ? base : `${base.slice(0, 34)}-${crypto.randomBytes(2).toString("hex")}`;
    if (!BIO_SLUG_RE.test(slug)) continue;
    const [hit] = await db.select({ s: bioPages.sellerId }).from(bioPages).where(eq(bioPages.slug, slug)).limit(1);
    if (!hit || hit.s === sellerId) return slug;
  }
  return `store-${crypto.randomBytes(5).toString("hex")}`;
}

async function bioClickCounts(sellerId: string, n: number) {
  const since = new Date(Date.now() - n * 86_400_000);
  const r = await db.execute(sql`SELECT bio_link_id, count(*)::int AS c FROM bio_events
    WHERE seller_id = ${sellerId} AND kind = 'click' AND bio_link_id IS NOT NULL AND created_at >= ${since} GROUP BY bio_link_id`);
  return new Map(rowsOf(r).map((x) => [String(x.bio_link_id), Number(x.c)]));
}

async function serializeBio(sellerId: string) {
  const [page] = await db.select().from(bioPages).where(eq(bioPages.sellerId, sellerId)).limit(1);
  const defaults = await profileDefaults(sellerId);
  const links = await db.select().from(bioLinks).where(eq(bioLinks.sellerId, sellerId)).orderBy(asc(bioLinks.position), asc(bioLinks.createdAt));
  const counts = await bioClickCounts(sellerId, 30);
  const [sf] = await db.select({ theme: storefronts.theme }).from(storefronts).where(eq(storefronts.ownerId, sellerId)).limit(1);
  const storePrimary = normalizeAccent((sf?.theme as Record<string, unknown> | undefined)?.primaryColor);
  return {
    exists: !!page,
    slug: page?.slug ?? null,
    url: page ? bioPageUrl(page.slug) : null,
    published: page?.published ?? true,
    displayName: page?.displayName ?? defaults.displayName,
    bio: page?.bio ?? defaults.bio,
    avatarUrl: page ? page.avatarUrl : defaults.avatarUrl,
    showShopButton: page?.showShopButton ?? true,
    shopButtonLabel: page?.shopButtonLabel ?? "Shop my store",
    featuredProductIds: page?.featuredProductIds ?? [],
    socials: page?.socials ?? {},
    theme: page?.theme === "dark" ? "dark" : "mono",
    accentColor: page?.accentColor ?? null,
    storeAccentColor: storePrimary,
    links: links.map((l) => ({ id: l.id, title: l.title, url: l.url, enabled: l.enabled, position: l.position, clicks30: counts.get(l.id) ?? 0 })),
  };
}

router.get("/bio", async (req, res) => {
  try { res.json(await serializeBio(sellerOf(req))); }
  catch (err) { req.log.error({ err }, "get bio failed"); res.status(500).json({ error: "Internal server error" }); }
});

router.put("/bio", requirePermission("marketing"), async (req, res) => {
  const sellerId = sellerOf(req);
  const b = (req.body ?? {}) as Record<string, unknown>;
  try {
    const [existing] = await db.select().from(bioPages).where(eq(bioPages.sellerId, sellerId)).limit(1);
    const defaults = await profileDefaults(sellerId);
    let avatar: string | null | undefined;
    if ("avatarUrl" in b) {
      if (b.avatarUrl === null || b.avatarUrl === "") avatar = null;
      else if (typeof b.avatarUrl === "string" && /^https:\/\/\S{1,1000}$/.test(b.avatarUrl) && !/[<>"']/.test(b.avatarUrl)) avatar = b.avatarUrl;
      else { res.status(400).json({ error: "avatarUrl must be an https URL" }); return; }
    }
    let featured: string[] | undefined;
    if ("featuredProductIds" in b) {
      const raw = Array.isArray(b.featuredProductIds) ? b.featuredProductIds.filter((x): x is string => typeof x === "string" && UUID_RE.test(x)) : [];
      const uniq = [...new Set(raw.map((x) => x.toLowerCase()))].slice(0, MAX_FEATURED);
      const owned = uniq.length
        ? await db.select({ id: products.id }).from(products).where(and(inArray(products.id, uniq), eq(products.ownerId, sellerId), isNull(products.deletedAt)))
        : [];
      const ownedSet = new Set(owned.map((o) => o.id));
      featured = uniq.filter((id) => ownedSet.has(id));
    }
    const theme = b.theme === "dark" ? "dark" : b.theme === "mono" ? "mono" : undefined;
    const accent = "accentColor" in b ? (b.accentColor === null ? null : normalizeAccent(b.accentColor)) : undefined;
    if ("accentColor" in b && b.accentColor !== null && accent === null) { res.status(400).json({ error: "accentColor must be a #rrggbb color" }); return; }

    const values = {
      displayName: "displayName" in b ? cleanText(b.displayName, 60) : existing?.displayName ?? defaults.displayName,
      bio: "bio" in b ? cleanText(b.bio, 240) : existing?.bio ?? defaults.bio,
      avatarUrl: avatar !== undefined ? avatar : existing ? existing.avatarUrl : defaults.avatarUrl,
      showShopButton: typeof b.showShopButton === "boolean" ? b.showShopButton : existing?.showShopButton ?? true,
      shopButtonLabel: "shopButtonLabel" in b ? cleanText(b.shopButtonLabel, 30) || "Shop my store" : existing?.shopButtonLabel ?? "Shop my store",
      featuredProductIds: featured ?? existing?.featuredProductIds ?? [],
      socials: "socials" in b ? normalizeSocials(b.socials) : existing?.socials ?? {},
      theme: theme ?? existing?.theme ?? "mono",
      accentColor: accent !== undefined ? accent : existing?.accentColor ?? null,
      published: typeof b.published === "boolean" ? b.published : existing?.published ?? true,
      updatedAt: new Date(),
    };
    if (existing) {
      await db.update(bioPages).set(values).where(eq(bioPages.sellerId, sellerId));
    } else {
      for (let i = 0; i < 3; i++) {
        const slug = await allocateSlug(sellerId, defaults);
        try { await db.insert(bioPages).values({ sellerId, slug, ...values }); break; }
        catch (err) { if (!isUniqueViolation(err) || i === 2) throw err; }
      }
    }
    res.json(await serializeBio(sellerId));
  } catch (err) {
    req.log.error({ err }, "save bio failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/bio/links", requirePermission("marketing"), async (req, res) => {
  const sellerId = sellerOf(req);
  const title = cleanText(req.body?.title, 80);
  const url = normalizeBioLinkUrl(req.body?.url);
  if (!title) { res.status(400).json({ error: "title is required" }); return; }
  if (!url) { res.status(400).json({ error: "url must be a valid web, mailto or tel link" }); return; }
  try {
    const [{ n, maxPos }] = rowsOf(await db.execute(sql`SELECT count(*)::int AS n, coalesce(max(position), -1)::int AS "maxPos" FROM bio_links WHERE seller_id = ${sellerId}`)) as { n: number; maxPos: number }[];
    if (Number(n) >= MAX_BIO_LINKS) { res.status(409).json({ error: `You can add up to ${MAX_BIO_LINKS} links` }); return; }
    const [row] = await db.insert(bioLinks).values({ sellerId, title, url, position: Number(maxPos) + 1 }).returning();
    res.status(201).json({ id: row.id, title: row.title, url: row.url, enabled: row.enabled, position: row.position, clicks30: 0 });
  } catch (err) {
    req.log.error({ err }, "create bio link failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/bio/links/order", requirePermission("marketing"), async (req, res) => {
  const sellerId = sellerOf(req);
  const ids = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).filter((x): x is string => typeof x === "string" && UUID_RE.test(x)) : [];
  if (ids.length === 0 || new Set(ids).size !== ids.length) { res.status(400).json({ error: "ids must be a list of link ids" }); return; }
  try {
    const owned = await db.select({ id: bioLinks.id }).from(bioLinks).where(and(eq(bioLinks.sellerId, sellerId), inArray(bioLinks.id, ids)));
    if (owned.length !== ids.length) { res.status(404).json({ error: "Link not found" }); return; }
    await db.transaction(async (tx) => {
      for (let i = 0; i < ids.length; i++) {
        await tx.update(bioLinks).set({ position: i }).where(and(eq(bioLinks.id, ids[i]), eq(bioLinks.sellerId, sellerId)));
      }
    });
    res.json((await serializeBio(sellerId)).links);
  } catch (err) {
    req.log.error({ err }, "reorder bio links failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/bio/links/:id", requirePermission("marketing"), async (req, res) => {
  const sellerId = sellerOf(req);
  const id = req.params.id;
  if (!UUID_RE.test(id)) { res.status(404).json({ error: "Link not found" }); return; }
  const patch: Partial<typeof bioLinks.$inferInsert> = {};
  if ("title" in (req.body ?? {})) {
    const t = cleanText(req.body.title, 80);
    if (!t) { res.status(400).json({ error: "title is required" }); return; }
    patch.title = t;
  }
  if ("url" in (req.body ?? {})) {
    const u = normalizeBioLinkUrl(req.body.url);
    if (!u) { res.status(400).json({ error: "url must be a valid web, mailto or tel link" }); return; }
    patch.url = u;
  }
  if (typeof req.body?.enabled === "boolean") patch.enabled = req.body.enabled;
  if (Object.keys(patch).length === 0) { res.status(400).json({ error: "Nothing to update" }); return; }
  try {
    const [row] = await db.update(bioLinks).set(patch).where(and(eq(bioLinks.id, id), eq(bioLinks.sellerId, sellerId))).returning();
    if (!row) { res.status(404).json({ error: "Link not found" }); return; }
    res.json({ id: row.id, title: row.title, url: row.url, enabled: row.enabled, position: row.position });
  } catch (err) {
    req.log.error({ err }, "update bio link failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/bio/links/:id", requirePermission("marketing"), async (req, res) => {
  const sellerId = sellerOf(req);
  const id = req.params.id;
  if (!UUID_RE.test(id)) { res.status(404).json({ error: "Link not found" }); return; }
  try {
    const gone = await db.delete(bioLinks).where(and(eq(bioLinks.id, id), eq(bioLinks.sellerId, sellerId))).returning({ id: bioLinks.id });
    if (gone.length === 0) { res.status(404).json({ error: "Link not found" }); return; }
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "delete bio link failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/bio/stats", async (req, res) => {
  try {
    const sellerId = sellerOf(req);
    const n = days(req);
    const since = new Date(Date.now() - n * 86_400_000);
    const [totals, byLink, referrers, countries] = await Promise.all([
      db.execute(sql`SELECT kind, count(*)::int AS c FROM bio_events WHERE seller_id = ${sellerId} AND created_at >= ${since} GROUP BY kind`),
      db.execute(sql`SELECT e.bio_link_id, l.title, l.url, count(*)::int AS c FROM bio_events e LEFT JOIN bio_links l ON l.id = e.bio_link_id
        WHERE e.seller_id = ${sellerId} AND e.kind = 'click' AND e.created_at >= ${since} GROUP BY e.bio_link_id, l.title, l.url ORDER BY c DESC LIMIT 50`),
      db.execute(sql`SELECT coalesce(referrer_host, 'Direct') AS label, count(*)::int AS c FROM bio_events WHERE seller_id = ${sellerId} AND kind = 'view' AND created_at >= ${since} GROUP BY 1 ORDER BY c DESC LIMIT 5`),
      db.execute(sql`SELECT coalesce(country, 'Unknown') AS label, count(*)::int AS c FROM bio_events WHERE seller_id = ${sellerId} AND kind = 'view' AND created_at >= ${since} GROUP BY 1 ORDER BY c DESC LIMIT 5`),
    ]);
    const t = new Map(rowsOf(totals).map((r) => [String(r.kind), Number(r.c)]));
    const views = t.get("view") ?? 0;
    const clicks = (t.get("click") ?? 0) + (t.get("shop") ?? 0) + (t.get("product") ?? 0);
    res.json({
      days: n, views, clicks, shopClicks: t.get("shop") ?? 0, productClicks: t.get("product") ?? 0,
      clickThroughRate: views > 0 ? clicks / views : 0,
      links: rowsOf(byLink).filter((r) => r.bio_link_id).map((r) => ({ id: String(r.bio_link_id), title: r.title ? String(r.title) : "Removed link", url: r.url ? String(r.url) : null, clicks: Number(r.c) })),
      referrers: rowsOf(referrers).map((r) => ({ label: String(r.label), count: Number(r.c) })),
      countries: rowsOf(countries).map((r) => ({ label: String(r.label), count: Number(r.c) })),
    });
  } catch (err) {
    req.log.error({ err }, "bio stats failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ───────────────────────────── Pixels ─────────────────────────────

router.get("/pixels", async (req, res) => {
  try {
    const [row] = await db.select().from(storePixels).where(eq(storePixels.sellerId, sellerOf(req))).limit(1);
    res.json({ metaPixelId: row?.metaPixelId ?? null, tiktokPixelId: row?.tiktokPixelId ?? null });
  } catch (err) {
    req.log.error({ err }, "get pixels failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/pixels", requirePermission("marketing"), async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
  const errors: Record<string, string> = {};
  let meta: string | null = null;
  let tiktok: string | null = null;
  if (!blank(b.metaPixelId)) {
    meta = validateMetaPixelId(b.metaPixelId);
    if (!meta) errors.metaPixelId = "A Meta Pixel ID is 10 to 20 digits";
  }
  if (!blank(b.tiktokPixelId)) {
    tiktok = validateTikTokPixelId(b.tiktokPixelId);
    if (!tiktok) errors.tiktokPixelId = "A TikTok Pixel ID is 10 to 30 letters and numbers";
  }
  if (Object.keys(errors).length) { res.status(400).json({ error: "Invalid pixel ID", errors }); return; }
  try {
    const sellerId = sellerOf(req);
    await db.insert(storePixels).values({ sellerId, metaPixelId: meta, tiktokPixelId: tiktok })
      .onConflictDoUpdate({ target: storePixels.sellerId, set: { metaPixelId: meta, tiktokPixelId: tiktok, updatedAt: new Date() } });
    res.json({ metaPixelId: meta, tiktokPixelId: tiktok });
  } catch (err) {
    req.log.error({ err }, "save pixels failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
