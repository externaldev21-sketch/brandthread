/**
 * GET /api/v1/public/sitemap.xml  (BT-315)
 *
 * The site's real sitemap: the static legal/marketing pages plus every
 * public product (/store/product/:id), seller profile (/u/:username) and
 * live/recent drop (/drops/:id), with lastmod. The web server serves it at
 * https://brandthread.app/sitemap.xml (artifacts/mobile/server/sitemap.js),
 * which robots.txt already points to; the build-time static file is the
 * fallback when the API can't be reached.
 *
 * One urlset is capped at 50,000 URLs by the protocol; this stays under it
 * (newest first). Split into a sitemap index when the catalogue gets there.
 */
import { Router } from "express";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db, drops, products, users } from "@workspace/db";
import { rateLimit } from "../middlewares/rateLimit";
import { CANONICAL_WEB_ORIGIN } from "../lib/webOrigin";

const router = Router();

export const SITEMAP_STATIC_PATHS = ["/", "/privacy", "/terms", "/community-guidelines", "/seller-agreement", "/refund-policy"];
export const SITEMAP_LIMITS = { products: 40_000, profiles: 8_000, drops: 1_500 } as const;
const USERNAME_RE = /^[a-z0-9_]{3,30}$/;

type Entry = { path: string; lastmod?: Date | null; changefreq?: string; priority?: string };

const xmlEscape = (v: string) => v.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] ?? c);

export function renderSitemap(entries: Entry[], origin = CANONICAL_WEB_ORIGIN): string {
  const body = entries.map((e) => [
    "  <url>",
    `    <loc>${xmlEscape(`${origin}${e.path}`)}</loc>`,
    e.lastmod ? `    <lastmod>${e.lastmod.toISOString().slice(0, 10)}</lastmod>` : null,
    e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
    e.priority ? `    <priority>${e.priority}</priority>` : null,
    "  </url>",
  ].filter(Boolean).join("\n"));
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...body, "</urlset>", ""].join("\n");
}

export async function sitemapEntries(): Promise<Entry[]> {
  const sellerOk = and(eq(users.accountType, "seller"), isNull(users.deletedAt), isNull(users.suspendedAt), isNull(users.deletionRequestedAt));

  const productRows = await db.select({ id: products.id, updatedAt: products.updatedAt })
    .from(products)
    .innerJoin(users, eq(users.clerkId, products.ownerId))
    .where(and(eq(products.status, "active"), isNull(products.deletedAt), sellerOk))
    .orderBy(desc(products.updatedAt))
    .limit(SITEMAP_LIMITS.products);

  const profileRows = await db.select({ username: users.username, updatedAt: users.updatedAt })
    .from(users)
    .where(and(sellerOk, isNotNull(users.username)))
    .orderBy(desc(users.updatedAt))
    .limit(SITEMAP_LIMITS.profiles);

  const dropRows = await db.select({ id: drops.id, releaseAt: drops.releaseAt })
    .from(drops)
    .innerJoin(users, eq(users.clerkId, drops.ownerId))
    .where(and(inArray(drops.status, ["active", "closed", "fulfilled"]), sellerOk))
    .orderBy(desc(drops.releaseAt))
    .limit(SITEMAP_LIMITS.drops);

  return [
    ...SITEMAP_STATIC_PATHS.map((path) => ({ path, changefreq: path === "/" ? "weekly" : "yearly", priority: path === "/" ? "1.0" : "0.5" })),
    ...profileRows
      .filter((r) => r.username && USERNAME_RE.test(r.username.toLowerCase()))
      .map((r) => ({ path: `/u/${r.username!.toLowerCase()}`, lastmod: r.updatedAt, changefreq: "daily", priority: "0.8" })),
    ...productRows.map((r) => ({ path: `/store/product/${r.id}`, lastmod: r.updatedAt, changefreq: "daily", priority: "0.7" })),
    ...dropRows.map((r) => ({ path: `/drops/${r.id}`, lastmod: r.releaseAt, changefreq: "daily", priority: "0.6" })),
  ];
}

router.get("/sitemap.xml", rateLimit("public-read"), async (req, res) => {
  try {
    const xml = renderSitemap(await sitemapEntries());
    res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    res.type("application/xml").send(xml);
  } catch (err) {
    req.log?.error({ err }, "sitemap failed");
    res.status(500).type("text/plain").send("Sitemap temporarily unavailable");
  }
});

export default router;
