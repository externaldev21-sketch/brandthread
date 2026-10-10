/**
 * Public, unauthenticated Open Graph data for shared links.
 *
 * Consumed by the web server (artifacts/mobile/server/sharePreview.js) so a
 * link pasted into iMessage / Instagram / X unfurls with the real post or
 * store instead of the generic Brandthread card. Responses are a strict
 * allow-list: handle, display name, caption, one image. Nothing viewer-
 * specific (signed out, so no block/mute filtering) and nothing private.
 *
 *   GET /api/v1/public/posts/:id/share-preview
 *   GET /api/v1/public/stores/:slug/share-preview     (:slug = seller username or storefront slug)
 *   GET /api/v1/public/products/:id/share-preview     (absolute https photo, BT-314)
 *   GET /api/v1/public/live/:id/share-preview         (host + "LIVE now", BT-320)
 *
 * Posts use the same `publicPostCondition` as every public feed, so held,
 * removed, private, unpublished, or suspended-author posts 404.
 */
import { Router } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, liveStreams, posts, productVariants, products, storefronts, users } from "@workspace/db";
import { publicProductCoverUrl } from "../lib/publicMedia";
import { publicPostCondition } from "../lib/postVisibility";
import { setPublicCacheHeaders } from "../lib/httpCache";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/;

function absoluteHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return /^https?:\/\//i.test(value.trim()) ? value.trim() : null;
}

function clip(value: string | null | undefined, max: number): string | null {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

router.get("/posts/:id/share-preview", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: "Post not found", code: "NOT_FOUND" });
  try {
    const [row] = await db
      .select({
        id: posts.id,
        caption: posts.caption,
        mediaUrl: posts.mediaUrl,
        thumbnailUrl: posts.thumbnailUrl,
        mediaType: posts.mediaType,
        displayName: users.displayName,
        brandName: users.brandName,
        username: users.username,
        accountType: users.accountType,
      })
      .from(posts)
      .innerJoin(users, eq(users.clerkId, posts.userId))
      .where(and(eq(posts.id, id), publicPostCondition()))
      .limit(1);
    if (!row) return res.status(404).json({ error: "Post not found", code: "NOT_FOUND" });

    const authorName =
      clip(row.accountType === "seller" ? row.brandName || row.displayName : row.displayName, 80)
      ?? (row.username ? `@${row.username}` : "Brandthread");
    const image =
      absoluteHttpUrl(row.thumbnailUrl)
      ?? (row.mediaType === "video" ? null : absoluteHttpUrl(row.mediaUrl));

    setPublicCacheHeaders(res, { maxAgeSeconds: 60, staleWhileRevalidateSeconds: 300 });
    return res.json({
      id: row.id,
      authorName,
      authorHandle: row.username ?? null,
      caption: clip(row.caption, 200),
      imageUrl: image,
      mediaType: row.mediaType ?? null,
    });
  } catch (err) {
    req.log?.error({ err }, "share-preview post failed");
    return res.status(500).json({ error: "Could not load preview", code: "INTERNAL" });
  }
});

type StorefrontRow = {
  slug: string; title: string | null; subtitle: string | null; description: string | null;
  branding: unknown; seo: unknown; status: string;
};

function storefrontPreview(sf: StorefrontRow) {
  const branding = (sf.branding ?? {}) as Record<string, unknown>;
  const seo = (sf.seo ?? {}) as Record<string, unknown>;
  return {
    name: clip(sf.title, 80) ?? sf.slug,
    description:
      clip(typeof seo.metaDescription === "string" ? seo.metaDescription : null, 200)
      ?? clip(sf.description ?? sf.subtitle ?? (typeof branding.tagline === "string" ? branding.tagline : null), 200),
    imageUrl: absoluteHttpUrl(branding.logoUrl),
  };
}

const storefrontColumns = {
  slug: storefronts.slug,
  title: storefronts.title,
  subtitle: storefronts.subtitle,
  description: storefronts.description,
  branding: storefronts.branding,
  seo: storefronts.seo,
  status: storefronts.status,
};

/**
 * Share Store links are https://brandthread.app/store/{username} (BT-304), but
 * storefront slugs are generated ("store-ab12cd34"), so the username is
 * resolved first: the seller's name, bio and avatar, enriched by their
 * published storefront when they have one. A valid seller never 404s; the
 * storefront slug still works as a fallback.
 */
router.get("/stores/:slug/share-preview", async (req, res) => {
  const { slug } = req.params;
  if (!SLUG_RE.test(slug)) return res.status(404).json({ error: "Store not found", code: "NOT_FOUND" });
  try {
    const handle = slug.replace(/^@/, "").toLowerCase();
    const [seller] = await db
      .select({
        clerkId: users.clerkId,
        username: users.username,
        accountType: users.accountType,
        brandName: users.brandName,
        displayName: users.displayName,
        bio: users.bio,
        avatarUrl: users.avatarUrl,
        profileImageUrl: users.profileImageUrl,
        deletedAt: users.deletedAt,
        suspendedAt: users.suspendedAt,
      })
      .from(users)
      .where(sql`lower(${users.username}) = ${handle}`)
      .limit(1);

    if (seller && seller.accountType === "seller" && !seller.deletedAt && !seller.suspendedAt) {
      const [sf] = await db.select(storefrontColumns).from(storefronts)
        .where(eq(storefronts.ownerId, seller.clerkId)).limit(1);
      const store = sf && sf.status === "published" ? storefrontPreview(sf) : null;
      const sellerName = clip(seller.brandName || seller.displayName, 80) ?? `@${seller.username}`;
      setPublicCacheHeaders(res, { maxAgeSeconds: 60, staleWhileRevalidateSeconds: 300 });
      return res.json({
        slug: seller.username,
        name: store?.name ?? sellerName,
        description: store?.description ?? clip(seller.bio, 200),
        imageUrl: store?.imageUrl ?? absoluteHttpUrl(seller.profileImageUrl) ?? absoluteHttpUrl(seller.avatarUrl),
      });
    }

    const [sf] = await db.select(storefrontColumns).from(storefronts)
      .where(eq(storefronts.slug, slug)).limit(1);
    if (!sf || sf.status !== "published") {
      return res.status(404).json({ error: "Store not found", code: "NOT_FOUND" });
    }
    setPublicCacheHeaders(res, { maxAgeSeconds: 60, staleWhileRevalidateSeconds: 300 });
    return res.json({ slug: sf.slug, ...storefrontPreview(sf) });
  } catch (err) {
    req.log?.error({ err }, "share-preview store failed");
    return res.status(500).json({ error: "Could not load preview", code: "INTERNAL" });
  }
});

/** Product card: name, lowest price and a public https photo (BT-314). */
router.get("/products/:id/share-preview", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: "Product not found", code: "NOT_FOUND" });
  try {
    const [row] = await db
      .select({
        id: products.id,
        name: products.name,
        description: products.description,
        images: products.images,
        brandName: users.brandName,
        displayName: users.displayName,
        suspendedAt: users.suspendedAt,
        deletedAt: users.deletedAt,
      })
      .from(products)
      .innerJoin(users, eq(users.clerkId, products.ownerId))
      .where(and(eq(products.id, id), eq(products.status, "active"), isNull(products.deletedAt)))
      .limit(1);
    if (!row || row.suspendedAt || row.deletedAt) {
      return res.status(404).json({ error: "Product not found", code: "NOT_FOUND" });
    }
    const [price] = await db
      .select({ min: sql<number | null>`min(${productVariants.priceCents})::int` })
      .from(productVariants)
      .where(eq(productVariants.productId, id));
    setPublicCacheHeaders(res, { maxAgeSeconds: 60, staleWhileRevalidateSeconds: 300 });
    return res.json({
      id: row.id,
      name: clip(row.name, 120) ?? "Product",
      sellerName: clip(row.brandName || row.displayName, 80),
      description: clip(row.description, 200),
      priceCents: typeof price?.min === "number" ? price.min : null,
      imageUrl: publicProductCoverUrl(row.id, row.images),
    });
  } catch (err) {
    req.log?.error({ err }, "share-preview product failed");
    return res.status(500).json({ error: "Could not load preview", code: "INTERNAL" });
  }
});

/** Live stream card: host, title, whether it is still live (BT-320). */
router.get("/live/:id/share-preview", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: "Live not found", code: "NOT_FOUND" });
  try {
    const [row] = await db
      .select({
        title: liveStreams.title,
        status: liveStreams.status,
        thumbnailUrl: liveStreams.thumbnailUrl,
        brandName: users.brandName,
        displayName: users.displayName,
        username: users.username,
        avatarUrl: users.avatarUrl,
        profileImageUrl: users.profileImageUrl,
        suspendedAt: users.suspendedAt,
      })
      .from(liveStreams)
      .innerJoin(users, eq(users.clerkId, liveStreams.sellerId))
      .where(eq(liveStreams.id, id))
      .limit(1);
    if (!row || row.suspendedAt) return res.status(404).json({ error: "Live not found", code: "NOT_FOUND" });
    setPublicCacheHeaders(res, { maxAgeSeconds: 30, staleWhileRevalidateSeconds: 60 });
    return res.json({
      hostName: clip(row.brandName || row.displayName, 80) ?? (row.username ? `@${row.username}` : "Brandthread"),
      title: clip(row.title, 120),
      live: row.status === "live",
      imageUrl: absoluteHttpUrl(row.thumbnailUrl) ?? absoluteHttpUrl(row.profileImageUrl) ?? absoluteHttpUrl(row.avatarUrl),
    });
  } catch (err) {
    req.log?.error({ err }, "share-preview live failed");
    return res.status(500).json({ error: "Could not load preview", code: "INTERNAL" });
  }
});

export default router;
