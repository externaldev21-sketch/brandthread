/**
 * The seller's store website — public, unauthenticated, mounted at the site
 * root next to /u/:username and /bio/:slug (see app.ts):
 *
 *   GET /@:handle                 store website (logo, name, bio, socials, products, links)
 *   GET /@:handle/p/:productId    product page with Buy
 *   GET /@:handle/go/:linkId      click-tracked redirect for a link button
 *   GET /@:handle/og.png          link-preview card (og:image)
 *
 * The handle is the seller's @username. Content comes from the seller's
 * link-in-bio row (bio_pages + bio_links) when there is one, otherwise from
 * their profile, so every seller with a username has a working link from day
 * one. Visits and clicks land in bio_events like the /bio pages.
 */
import crypto from "node:crypto";
import type { Request, Response } from "express";
import { db, bioPages, bioLinks, products, productVariants, users } from "@workspace/db";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { normalizeSocials } from "../lib/growth/bioValidation";
import { logBioEvent } from "./growthPublic";
import { buildDestinationUrl } from "../lib/growth/utm";
import { storeSiteUrl } from "../lib/growth/destinations";
import { ObjectStorageService } from "../lib/objectStorage";
import { getWebOrigin } from "../lib/webOrigin";
import {
  MAX_STORE_SITE_LINKS, MAX_STORE_SITE_PRODUCTS, buttonStyleOf, fontOf, normalizeStoreHandle, storeSiteTheme,
} from "../lib/growth/storeSiteDesign";
import {
  STORE_SITE_CSP, renderStoreSite, renderStoreSiteProduct, storeSiteBuyHref, type StoreSiteModel,
} from "../lib/growth/storeSitePage";
import { renderStoreSiteOg } from "../lib/growth/storeSiteOg";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const objectStorage = new ObjectStorageService();
/** Signed image URLs on public pages stay valid for a day of shares and back-navigations. */
const IMAGE_URL_TTL_SEC = 24 * 60 * 60;

const usd = (cents: number) => `$${(Math.max(0, cents) / 100).toFixed(2)}`;

/** An image reference a browser can load: https URLs as-is, private /objects/ paths signed. */
async function publicImage(ref: unknown): Promise<string | null> {
  if (typeof ref !== "string" || !ref) return null;
  if (/^https:\/\//i.test(ref)) return ref;
  if (ref.startsWith("/objects/")) return objectStorage.getObjectEntityDownloadURL(ref, IMAGE_URL_TTL_SEC).catch(() => null);
  return null;
}

function notFound(res: Response): void {
  res.status(404).type("html").set("Cache-Control", "no-store").send(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Not found</title><style>body{margin:0;background:#000;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;display:grid;place-items:center;min-height:100vh;text-align:center;padding:24px}p{color:#c0c0c0}a{color:#fff;font-weight:600}</style></head><body><main><h1>This store isn't available</h1><p>The link may have changed.</p><p><a href="https://brandthread.app">Brandthread</a></p></main></body></html>`,
  );
}

type LoadedSite = {
  sellerId: string;
  handle: string;
  displayName: string;
  bio: string;
  logoRef: string | null;
  bannerRef: string | null;
  theme: ReturnType<typeof storeSiteTheme>;
  buttonStyle: ReturnType<typeof buttonStyleOf>;
  font: ReturnType<typeof fontOf>;
  socials: Record<string, string>;
  featuredIds: string[];
  updatedAt: Date | null;
};

/** The published store website for a handle, or null (unknown, not a seller, removed, or switched off). */
export async function loadStoreSite(rawHandle: unknown): Promise<LoadedSite | null> {
  const handle = normalizeStoreHandle(rawHandle);
  if (!handle) return null;
  const [u] = await db.select({
    clerkId: users.clerkId, username: users.username, accountType: users.accountType,
    brandName: users.brandName, displayName: users.displayName, name: users.name, bio: users.bio,
    logoUrl: users.logoUrl, bannerUrl: users.bannerUrl, profileImageUrl: users.profileImageUrl, avatarUrl: users.avatarUrl,
    socialLinks: users.socialLinks,
    deletedAt: users.deletedAt, deletionRequestedAt: users.deletionRequestedAt, suspendedAt: users.suspendedAt,
  }).from(users).where(sql`lower(${users.username}) = ${handle}`).limit(1);
  if (!u?.username || u.deletedAt || u.deletionRequestedAt || u.suspendedAt) return null;
  if (u.accountType !== "seller" && u.accountType !== "both") return null;

  const [page] = await db.select().from(bioPages).where(eq(bioPages.sellerId, u.clerkId)).limit(1);
  if (page && !page.published) return null;

  const profileName = u.brandName || u.displayName || u.name || "";
  return {
    sellerId: u.clerkId,
    handle: u.username.toLowerCase(),
    displayName: (page?.displayName || profileName).trim(),
    bio: (page ? page.bio : u.bio ?? "").trim(),
    // Store logo first (Design editor uploads it), then the older link-in-bio
    // photo, then the profile photo.
    logoRef: u.logoUrl || page?.avatarUrl || u.profileImageUrl || u.avatarUrl || null,
    bannerRef: page && !page.showBanner ? null : u.bannerUrl || null,
    theme: storeSiteTheme(page?.theme),
    buttonStyle: buttonStyleOf(page?.buttonStyle),
    font: fontOf(page?.font),
    socials: page ? page.socials ?? {} : normalizeSocials(u.socialLinks ?? {}),
    featuredIds: (page?.featuredProductIds ?? []).filter((id) => UUID_RE.test(id)),
    updatedAt: page?.updatedAt ?? null,
  };
}

type SiteProduct = { id: string; name: string; description: string | null; images: string[]; priceCents: number | null };

/** Active products, featured ones first in the seller's order, then newest. */
async function loadSiteProducts(sellerId: string, featuredIds: string[]): Promise<SiteProduct[]> {
  const rows = await db.select({ id: products.id, name: products.name, description: products.description, images: products.images })
    .from(products)
    .where(and(eq(products.ownerId, sellerId), eq(products.status, "active"), isNull(products.deletedAt)))
    .orderBy(desc(products.createdAt))
    .limit(200);
  const rank = new Map(featuredIds.map((id, i) => [id.toLowerCase(), i]));
  const ordered = [...rows].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity)).slice(0, MAX_STORE_SITE_PRODUCTS);
  const prices = ordered.length
    ? await db.select({ productId: productVariants.productId, min: sql<number>`min(${productVariants.priceCents})::int` })
      .from(productVariants).where(inArray(productVariants.productId, ordered.map((r) => r.id))).groupBy(productVariants.productId)
    : [];
  const priceOf = new Map(prices.map((p) => [p.productId, p.min]));
  return ordered.map((r) => ({
    id: r.id, name: r.name, description: r.description,
    images: Array.isArray(r.images) ? r.images.filter((x): x is string => typeof x === "string") : [],
    priceCents: priceOf.get(r.id) ?? null,
  }));
}

/** Cache-buster for og:image so a redesign shows a fresh card. */
function ogVersion(site: LoadedSite, productIds: string[]): string {
  return crypto.createHash("sha1")
    .update(`${site.updatedAt?.getTime() ?? 0}|${site.logoRef ?? ""}|${site.displayName}|${productIds.slice(0, 3).join(",")}`)
    .digest("hex").slice(0, 10);
}

export async function storeSiteHandler(req: Request, res: Response): Promise<void> {
  try {
    const site = await loadStoreSite(req.params.handle);
    if (!site) return notFound(res);
    const canonical = storeSiteUrl(site.handle);
    if (req.params.handle !== site.handle) {
      res.set("Cache-Control", "no-store");
      res.redirect(301, `/@${site.handle}`);
      return;
    }
    const [rows, links, logoUrl, bannerUrl] = await Promise.all([
      loadSiteProducts(site.sellerId, site.featuredIds),
      db.select({ id: bioLinks.id, title: bioLinks.title }).from(bioLinks)
        .where(and(eq(bioLinks.sellerId, site.sellerId), eq(bioLinks.enabled, true)))
        .orderBy(asc(bioLinks.position), asc(bioLinks.createdAt)).limit(MAX_STORE_SITE_LINKS),
      publicImage(site.logoRef),
      publicImage(site.bannerRef),
    ]);
    const productsOut = await Promise.all(rows.map(async (p) => ({
      id: p.id, name: p.name, href: `/@${site.handle}/p/${p.id}`,
      image: await publicImage(p.images[0]), priceLabel: p.priceCents == null ? "" : usd(p.priceCents),
    })));
    const model: StoreSiteModel = {
      handle: site.handle,
      displayName: site.displayName,
      bio: site.bio,
      logoUrl,
      bannerUrl,
      theme: site.theme,
      buttonStyle: site.buttonStyle,
      font: site.font,
      socials: Object.entries(site.socials).map(([key, href]) => ({ key, href })),
      products: productsOut,
      links: links.map((l) => ({ href: `/@${site.handle}/go/${l.id}`, title: l.title })),
      canonicalUrl: canonical,
      ogImageUrl: `${canonical}/og.png?v=${ogVersion(site, rows.map((r) => r.id))}`,
    };
    await logBioEvent(req, site.sellerId, "view", "view", {}, 1);
    res.set("Cache-Control", "no-cache");
    res.set("Content-Security-Policy", STORE_SITE_CSP);
    res.set("Referrer-Policy", "strict-origin-when-cross-origin");
    res.type("html").send(renderStoreSite(model));
  } catch (err) {
    req.log?.error({ err }, "store site render failed");
    res.status(500).send("Store temporarily unavailable");
  }
}

const SITE_UTM = { source: "brandthread_site", medium: "link_in_bio", campaign: null, term: null, content: null } as const;

export async function storeSiteProductHandler(req: Request, res: Response): Promise<void> {
  try {
    const site = await loadStoreSite(req.params.handle);
    const productId = req.params.productId;
    if (!site || typeof productId !== "string" || !UUID_RE.test(productId)) return notFound(res);
    const [p] = await db.select({ id: products.id, name: products.name, description: products.description, images: products.images })
      .from(products)
      .where(and(eq(products.id, productId), eq(products.ownerId, site.sellerId), eq(products.status, "active"), isNull(products.deletedAt)))
      .limit(1);
    if (!p) return notFound(res);
    const [[price], logoUrl, images] = await Promise.all([
      db.select({ min: sql<number | null>`min(${productVariants.priceCents})::int` }).from(productVariants).where(eq(productVariants.productId, p.id)),
      publicImage(site.logoRef),
      Promise.all((Array.isArray(p.images) ? p.images : []).slice(0, 8).map(publicImage)),
    ]);
    const canonical = `${storeSiteUrl(site.handle)}/p/${p.id}`;
    const webCheckout = buildDestinationUrl(`${getWebOrigin()}/store/product/${p.id}`, { ...SITE_UTM });
    await logBioEvent(req, site.sellerId, "product", `p:${p.id}`, { ref: p.id });
    res.set("Cache-Control", "no-cache");
    res.set("Content-Security-Policy", STORE_SITE_CSP);
    res.set("Referrer-Policy", "strict-origin-when-cross-origin");
    res.type("html").send(renderStoreSiteProduct({
      site: {
        handle: site.handle, displayName: site.displayName, logoUrl, theme: site.theme,
        buttonStyle: site.buttonStyle, font: site.font, canonicalUrl: storeSiteUrl(site.handle),
      },
      product: {
        name: p.name, description: (p.description ?? "").trim(),
        images: images.filter((x): x is string => !!x),
        priceLabel: price?.min == null ? "" : usd(price.min),
      },
      buyHref: storeSiteBuyHref(req.get("user-agent"), webCheckout, p.id),
      canonicalUrl: canonical,
    }));
  } catch (err) {
    req.log?.error({ err }, "store site product render failed");
    res.status(500).send("Product temporarily unavailable");
  }
}

export async function storeSiteLinkRedirect(req: Request, res: Response): Promise<void> {
  try {
    const site = await loadStoreSite(req.params.handle);
    const linkId = req.params.linkId;
    if (!site || typeof linkId !== "string" || !UUID_RE.test(linkId)) return notFound(res);
    const [link] = await db.select().from(bioLinks)
      .where(and(eq(bioLinks.id, linkId), eq(bioLinks.sellerId, site.sellerId), eq(bioLinks.enabled, true))).limit(1);
    if (!link) return notFound(res);
    await logBioEvent(req, site.sellerId, "click", `link:${link.id}`, { bioLinkId: link.id });
    res.set("Cache-Control", "no-store");
    res.set("Referrer-Policy", "strict-origin-when-cross-origin");
    res.redirect(302, link.url);
  } catch (err) {
    req.log?.error({ err }, "store site link redirect failed");
    res.status(500).send("Link temporarily unavailable");
  }
}

// Small in-process cache: a link pasted into a group chat gets fetched by
// every client's preview bot at once.
const ogCache = new Map<string, { at: number; png: Buffer }>();
const OG_TTL_MS = 10 * 60_000;
const OG_CACHE_MAX = 200;

export async function storeSiteOgHandler(req: Request, res: Response): Promise<void> {
  try {
    const site = await loadStoreSite(req.params.handle);
    if (!site) { res.status(404).end(); return; }
    const rows = await loadSiteProducts(site.sellerId, site.featuredIds);
    const key = `${site.handle}:${ogVersion(site, rows.map((r) => r.id))}:${site.theme.key}`;
    const hit = ogCache.get(key);
    let png = hit && Date.now() - hit.at < OG_TTL_MS ? hit.png : null;
    if (!png) {
      const withImages = rows.filter((r) => r.images.length).slice(0, 3);
      const [logoUrl, ...productImages] = await Promise.all([
        publicImage(site.logoRef),
        ...withImages.map((r) => publicImage(r.images[0])),
      ]);
      png = await renderStoreSiteOg({
        handle: site.handle,
        displayName: site.displayName,
        logoUrl,
        productImages: productImages.filter((x): x is string => !!x),
        theme: site.theme,
        displayUrl: `brandthread.app/@${site.handle}`,
      });
      if (ogCache.size >= OG_CACHE_MAX) ogCache.delete(ogCache.keys().next().value as string);
      ogCache.set(key, { at: Date.now(), png });
    }
    res.set("Cache-Control", "public, max-age=3600");
    res.type("png").send(png);
  } catch (err) {
    req.log?.error({ err }, "store site og image failed");
    res.status(500).end();
  }
}
