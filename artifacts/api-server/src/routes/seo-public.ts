/**
 * Public, unauthenticated data for brandthread.app's crawlable pages.
 * Consumed by artifacts/mobile/server (serve.js) — never by the app itself.
 *
 *   GET /api/v1/public/seo/products/:id          — product page SEO + schema.org Product inputs
 *   GET /api/v1/public/new-this-week             — products first published in the last 7 days
 *   GET /api/v1/public/seo/sitemap/:kind         — products | stores | drops URL lists
 *   GET /api/v1/public/invites/:code/share-preview — inviter's public name for the invite card
 *
 * Every response is a strict allow-list of public fields. Only active,
 * non-deleted, launched products from sellers in good standing (not
 * suspended / deleted) appear; seller "hide from search engines" (product_seo
 * no_index) is honoured everywhere a crawler could follow a link.
 */
import { Router, type Request } from "express";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import {
  db,
  drops,
  productLaunches,
  productSeo,
  productVariants,
  products,
  storefronts,
  users,
} from "@workspace/db";
import { authorInGoodStanding } from "../lib/safety";
import { setPublicCacheHeaders } from "../lib/httpCache";
import { rateLimit } from "../middlewares/rateLimit";
import { applySalesToVariants } from "../lib/pricing/salesRuntime";
import { getSellerVacationStatus } from "../lib/sellerAvailability";
import { isProductLive } from "../lib/productLaunch";
import { resolveProductSeo } from "../lib/productSeo";
import { normalizeInviteCode, REFERRAL_INVITEE_REWARD_CENTS } from "../lib/referrals/policy";
import {
  NEW_THIS_WEEK_DAYS,
  NEW_THIS_WEEK_PAGE_MAX,
  NEW_THIS_WEEK_TOTAL_CAP,
  SITEMAP_KIND_CAP,
  SITEMAP_KINDS,
  absoluteHttpUrl,
  absoluteImages,
  clipText,
  parseNonNegativeInt,
  publicBrandName,
  publishedAtFor,
  schemaAvailability,
  summarizePrices,
  type SitemapKind,
} from "../lib/seoPublic";

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Scheduled products are hidden until their launch moment. */
const launchedCondition = sql`(${productLaunches.productId} IS NULL OR ${productLaunches.launchedAt} IS NOT NULL OR ${productLaunches.launchAt} <= now())`;
const publishedAtSql = sql<Date>`coalesce(${productLaunches.launchedAt}, ${productLaunches.launchAt}, ${products.createdAt})`;
const indexableCondition = sql`coalesce(${productSeo.noIndex}, false) = false`;
const publicProductCondition = () => and(
  eq(products.status, "active"),
  isNull(products.deletedAt),
  authorInGoodStanding(products.ownerId),
);

function logError(req: Request, err: unknown, msg: string) {
  (req as any).log?.error?.({ err }, msg);
}

// ─── Product page SEO ────────────────────────────────────────────────────────
router.get("/seo/products/:id", rateLimit("public-read"), async (req, res) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) return res.status(404).json({ error: "Product not found", code: "NOT_FOUND" });
  try {
    const [row] = await db
      .select({
        product: products,
        launchAt: productLaunches.launchAt,
        launchedAt: productLaunches.launchedAt,
        seoTitle: productSeo.seoTitle,
        seoDescription: productSeo.seoDescription,
        urlHandle: productSeo.urlHandle,
        noIndex: productSeo.noIndex,
        socialImageUrl: productSeo.socialImageUrl,
        brandName: users.brandName,
        displayName: users.displayName,
        storeTitle: storefronts.title,
        storeSlug: storefronts.slug,
        storeStatus: storefronts.status,
        storeSeo: storefronts.seo,
      })
      .from(products)
      .innerJoin(users, eq(users.clerkId, products.ownerId))
      .leftJoin(productLaunches, eq(productLaunches.productId, products.id))
      .leftJoin(productSeo, eq(productSeo.productId, products.id))
      .leftJoin(storefronts, eq(storefronts.ownerId, products.ownerId))
      .where(and(eq(products.id, id), publicProductCondition()))
      .limit(1);
    if (!row) return res.status(404).json({ error: "Product not found", code: "NOT_FOUND" });
    const p = row.product;

    const rawVariants = await db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, p.id))
      .orderBy(productVariants.createdAt, productVariants.id);
    const variants = await applySalesToVariants([p], rawVariants);
    const prices = summarizePrices(variants);
    const totalStock = variants.reduce((sum, v) => sum + Math.max(0, v.stock ?? 0), 0);
    const launch = row.launchAt ? { launchAt: row.launchAt, launchedAt: row.launchedAt ?? null } : null;
    const vacation = await getSellerVacationStatus(p.ownerId);

    const storePublished = row.storeStatus === "published";
    const brand = publicBrandName({
      storeTitle: row.storeTitle, storePublished, brandName: row.brandName, displayName: row.displayName,
    });
    const pd = ((row.storeSeo ?? {}) as any).productSeoDefaults ?? {};
    const resolved = resolveProductSeo(
      { id: p.id, name: p.name, description: p.description, images: p.images },
      {
        seoTitle: row.seoTitle, seoDescription: row.seoDescription, urlHandle: row.urlHandle,
        noIndex: row.noIndex, socialImageUrl: row.socialImageUrl,
      },
      {
        storeName: brand ?? "",
        titleTemplate: typeof pd.titleTemplate === "string" ? pd.titleTemplate : null,
        descriptionTemplate: typeof pd.descriptionTemplate === "string" ? pd.descriptionTemplate : null,
      },
    );

    setPublicCacheHeaders(res, { maxAgeSeconds: 60, staleWhileRevalidateSeconds: 300 });
    return res.json({
      id: p.id,
      name: p.name,
      title: resolved.title,
      description: clipText(resolved.description, 300),
      longDescription: clipText(p.description, 2000),
      images: absoluteImages(p.images),
      socialImageUrl: absoluteHttpUrl(resolved.image),
      brand,
      storeSlug: storePublished ? row.storeSlug : null,
      category: p.category,
      // The seller's own variant SKU is private (see lib/publicProfile.ts);
      // the stable Brandthread product id is the public merchant identifier.
      sku: p.id,
      noIndex: resolved.noIndex,
      currency: "USD",
      price: prices,
      availability: schemaAvailability({
        live: isProductLive(launch),
        vacation: vacation.active,
        isPreOrder: p.isPreOrder,
        totalStock,
      }),
      publishedAt: publishedAtFor(p.createdAt, launch).toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    });
  } catch (err) {
    logError(req, err, "seo product failed");
    return res.status(500).json({ error: "Could not load product", code: "INTERNAL" });
  }
});

// ─── New this week ───────────────────────────────────────────────────────────
router.get("/new-this-week", rateLimit("public-read"), async (req, res) => {
  const limit = parseNonNegativeInt(req.query.limit, NEW_THIS_WEEK_PAGE_MAX, NEW_THIS_WEEK_PAGE_MAX);
  const offset = parseNonNegativeInt(req.query.offset, 0, NEW_THIS_WEEK_TOTAL_CAP);
  if (limit === null || offset === null || limit < 1) {
    return res.status(400).json({ error: "Invalid page", code: "VALIDATION_ERROR" });
  }
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - NEW_THIS_WEEK_DAYS * 24 * 60 * 60 * 1000);
  const pageLimit = Math.max(0, Math.min(limit, NEW_THIS_WEEK_TOTAL_CAP - offset));
  try {
    const where = and(
      publicProductCondition(),
      launchedCondition,
      indexableCondition,
      sql`${publishedAtSql} >= ${windowStart}`,
      sql`${publishedAtSql} <= ${windowEnd}`,
      sql`EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = ${products.id})`,
    );
    const base = db
      .select({
        id: products.id,
        ownerId: products.ownerId,
        name: products.name,
        images: products.images,
        category: products.category,
        tags: products.tags,
        isPreOrder: products.isPreOrder,
        publishedAt: publishedAtSql,
        brandName: users.brandName,
        displayName: users.displayName,
        storeTitle: storefronts.title,
        storeStatus: storefronts.status,
      })
      .from(products)
      .innerJoin(users, eq(users.clerkId, products.ownerId))
      .leftJoin(productLaunches, eq(productLaunches.productId, products.id))
      .leftJoin(productSeo, eq(productSeo.productId, products.id))
      .leftJoin(storefronts, eq(storefronts.ownerId, products.ownerId))
      .where(where);
    const [rows, [{ total }]] = await Promise.all([
      pageLimit > 0
        ? base.orderBy(desc(publishedAtSql), desc(products.id)).limit(pageLimit).offset(offset)
        : Promise.resolve([]),
      db.select({ total: sql<number>`count(*)::int` })
        .from(products)
        .leftJoin(productLaunches, eq(productLaunches.productId, products.id))
        .leftJoin(productSeo, eq(productSeo.productId, products.id))
        .where(where),
    ]);

    const ids = rows.map((r) => r.id);
    const variants = ids.length
      ? await applySalesToVariants(
          rows.map((r) => ({ id: r.id, ownerId: r.ownerId, category: r.category, tags: r.tags })),
          await db.select().from(productVariants).where(inArray(productVariants.productId, ids)),
        )
      : [];
    const byProduct = new Map<string, typeof variants>();
    for (const v of variants) {
      const list = byProduct.get(v.productId) ?? [];
      list.push(v);
      byProduct.set(v.productId, list);
    }

    const items = rows.map((r) => {
      const vs = byProduct.get(r.id) ?? [];
      const prices = summarizePrices(vs);
      const stock = vs.reduce((sum, v) => sum + Math.max(0, v.stock ?? 0), 0);
      return {
        id: r.id,
        name: r.name,
        brand: publicBrandName({
          storeTitle: r.storeTitle, storePublished: r.storeStatus === "published",
          brandName: r.brandName, displayName: r.displayName,
        }),
        imageUrl: absoluteImages(r.images, 1)[0] ?? null,
        priceCents: prices?.lowCents ?? null,
        compareAtPriceCents: prices?.compareAtCents ?? null,
        hasPriceRange: prices ? prices.highCents > prices.lowCents : false,
        currency: "USD",
        soldOut: !r.isPreOrder && stock <= 0,
        publishedAt: new Date(r.publishedAt).toISOString(),
        path: `/store/product/${r.id}`,
      };
    });
    const cappedTotal = Math.min(Number(total) || 0, NEW_THIS_WEEK_TOTAL_CAP);
    const nextOffset = offset + items.length < cappedTotal && items.length > 0 ? offset + items.length : null;

    setPublicCacheHeaders(res, { maxAgeSeconds: 300, staleWhileRevalidateSeconds: 900 });
    return res.json({
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      total: cappedTotal,
      offset,
      nextOffset,
      items,
    });
  } catch (err) {
    logError(req, err, "new-this-week failed");
    return res.status(500).json({ error: "Could not load new products", code: "INTERNAL" });
  }
});

// ─── Sitemap entries ─────────────────────────────────────────────────────────
async function sitemapEntries(kind: SitemapKind): Promise<Array<{ path: string; lastModified: string }>> {
  if (kind === "products") {
    const rows = await db
      .select({ id: products.id, updatedAt: products.updatedAt })
      .from(products)
      .leftJoin(productLaunches, eq(productLaunches.productId, products.id))
      .leftJoin(productSeo, eq(productSeo.productId, products.id))
      .where(and(publicProductCondition(), launchedCondition, indexableCondition))
      .orderBy(desc(products.updatedAt), desc(products.id))
      .limit(SITEMAP_KIND_CAP);
    return rows.map((r) => ({ path: `/store/product/${r.id}`, lastModified: r.updatedAt.toISOString() }));
  }
  if (kind === "stores") {
    const rows = await db
      .select({ slug: storefronts.slug, updatedAt: storefronts.updatedAt, seo: storefronts.seo })
      .from(storefronts)
      .where(and(eq(storefronts.status, "published"), authorInGoodStanding(storefronts.ownerId)))
      .orderBy(desc(storefronts.updatedAt), desc(storefronts.id))
      .limit(SITEMAP_KIND_CAP);
    return rows
      // Store SEO screen: "Sitemap Enabled" / "Search Visible" — honour an explicit off.
      .filter((r) => {
        const seo = (r.seo ?? {}) as Record<string, unknown>;
        return seo.sitemapEnabled !== false && seo.searchVisible !== false;
      })
      .map((r) => ({ path: `/store/${encodeURIComponent(r.slug)}`, lastModified: r.updatedAt.toISOString() }));
  }
  const rows = await db
    .select({ id: drops.id, updatedAt: drops.updatedAt })
    .from(drops)
    .where(and(ne(drops.status, "draft"), authorInGoodStanding(drops.ownerId)))
    .orderBy(desc(drops.updatedAt), desc(drops.id))
    .limit(SITEMAP_KIND_CAP);
  return rows.map((r) => ({ path: `/drops/${r.id}`, lastModified: r.updatedAt.toISOString() }));
}

router.get("/seo/sitemap/:kind", rateLimit("public-read"), async (req, res) => {
  const kind = String(req.params.kind) as SitemapKind;
  if (!SITEMAP_KINDS.includes(kind)) return res.status(404).json({ error: "Unknown sitemap", code: "NOT_FOUND" });
  try {
    const entries = await sitemapEntries(kind);
    setPublicCacheHeaders(res, { maxAgeSeconds: 900, staleWhileRevalidateSeconds: 3600 });
    return res.json({ kind, entries });
  } catch (err) {
    logError(req, err, "seo sitemap failed");
    return res.status(500).json({ error: "Could not load sitemap", code: "INTERNAL" });
  }
});

// ─── Referral invite card ────────────────────────────────────────────────────
// Read-only: never counts a click (crawlers unfurl links), and returns only the
// inviter's public display name — nothing for private or not-in-good-standing
// accounts, whose card stays generic.
router.get("/invites/:code/share-preview", rateLimit("public-read"), async (req, res) => {
  const code = normalizeInviteCode(req.params.code);
  if (!code) return res.status(404).json({ error: "Invite not found", code: "NOT_FOUND" });
  try {
    const [row] = await db
      .select({
        displayName: users.displayName,
        brandName: users.brandName,
        accountType: users.accountType,
        isPrivate: users.isPrivate,
        suspendedAt: users.suspendedAt,
        deletedAt: users.deletedAt,
        deletionRequestedAt: users.deletionRequestedAt,
      })
      .from(users)
      .where(eq(users.inviteCode, code))
      .limit(1);
    if (!row || row.suspendedAt || row.deletedAt || row.deletionRequestedAt) {
      return res.status(404).json({ error: "Invite not found", code: "NOT_FOUND" });
    }
    const name = row.isPrivate
      ? null
      : clipText(row.accountType === "seller" ? row.brandName || row.displayName : row.displayName, 60);
    setPublicCacheHeaders(res, { maxAgeSeconds: 300, staleWhileRevalidateSeconds: 900 });
    return res.json({ code, inviterName: name, inviteeRewardCents: REFERRAL_INVITEE_REWARD_CENTS });
  } catch (err) {
    logError(req, err, "invite share-preview failed");
    return res.status(500).json({ error: "Could not load preview", code: "INTERNAL" });
  }
});

export default router;
