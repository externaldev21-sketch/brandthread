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
 *   GET /api/v1/public/stores/:slug/share-preview
 *
 * Posts use the same `publicPostCondition` as every public feed, so held,
 * removed, private, unpublished, or suspended-author posts 404.
 */
import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db, posts, storefronts, users } from "@workspace/db";
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

router.get("/stores/:slug/share-preview", async (req, res) => {
  const { slug } = req.params;
  if (!SLUG_RE.test(slug)) return res.status(404).json({ error: "Store not found", code: "NOT_FOUND" });
  try {
    const [sf] = await db
      .select({
        slug: storefronts.slug,
        title: storefronts.title,
        subtitle: storefronts.subtitle,
        description: storefronts.description,
        branding: storefronts.branding,
        seo: storefronts.seo,
        status: storefronts.status,
      })
      .from(storefronts)
      .where(eq(storefronts.slug, slug))
      .limit(1);
    if (!sf || sf.status !== "published") {
      return res.status(404).json({ error: "Store not found", code: "NOT_FOUND" });
    }
    const branding = (sf.branding ?? {}) as Record<string, unknown>;
    const seo = (sf.seo ?? {}) as Record<string, unknown>;
    setPublicCacheHeaders(res, { maxAgeSeconds: 60, staleWhileRevalidateSeconds: 300 });
    return res.json({
      slug: sf.slug,
      name: clip(sf.title, 80) ?? sf.slug,
      description:
        clip(typeof seo.metaDescription === "string" ? seo.metaDescription : null, 200)
        ?? clip(sf.description ?? sf.subtitle ?? (typeof branding.tagline === "string" ? branding.tagline : null), 200),
      imageUrl: absoluteHttpUrl(branding.logoUrl),
    });
  } catch (err) {
    req.log?.error({ err }, "share-preview store failed");
    return res.status(500).json({ error: "Could not load preview", code: "INTERNAL" });
  }
});

export default router;
