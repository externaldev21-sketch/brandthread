/**
 * The seller's store website — public, unauthenticated, mounted at the site
 * root next to /u/:username and /bio/:slug (see app.ts):
 *
 *   GET /@:handle                      the store: profile, socials, product blocks
 *   GET /@:handle/c/:productId         checkout page for a block, on the store
 *   GET /@:handle/c/:productId/done    confirmation after payment
 *   GET /@:handle/p/:productId         older product links → the block's checkout
 *   GET /@:handle/go/:linkId           click-tracked redirect for older link buttons
 *   GET /@:handle/og.png               link-preview card (og:image)
 *
 * The handle is the seller's @username. The profile comes from the seller's
 * link-in-bio row (bio_pages) when there is one, otherwise from their profile;
 * the blocks from store_blocks (lib/growth/storeBlockData), so every seller
 * with a username has a working store from day one. Visits and clicks land
 * in bio_events like the /bio pages.
 */
import crypto from "node:crypto";
import type { Request, Response } from "express";
import { db, bioPages, bioLinks, users } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { normalizeSocials } from "../lib/growth/bioValidation";
import { logBioEvent } from "./growthPublic";
import { storeSiteUrl } from "../lib/growth/destinations";
import { ObjectStorageService } from "../lib/objectStorage";
import { normalizeStoreHandle, storeSiteTheme } from "../lib/growth/storeSiteDesign";
import {
  STORE_DONE_CSP, STORE_SITE_CSP, renderStoreCheckout, renderStoreCheckoutDone, renderStoreSite, storeCheckoutCsp,
  type StoreSiteBlock, type StoreSiteModel,
} from "../lib/growth/storeSitePage";
import { publicStoreBlocks, type StoreBlockRecord } from "../lib/growth/storeBlockData";
import { blockButtonText, priceLabel, shipByLabel } from "../lib/growth/storeBlocks";
import { renderStoreSiteOg } from "../lib/growth/storeSiteOg";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const objectStorage = new ObjectStorageService();
/** Signed image URLs on public pages stay valid for a day of shares and back-navigations. */
const IMAGE_URL_TTL_SEC = 24 * 60 * 60;

export const usd = (cents: number) => `$${(Math.max(0, cents) / 100).toFixed(2)}`;

/**
 * Stripe publishable key for embedded payment on the checkout page. Without
 * it the page continues on Stripe's hosted checkout (same order flow).
 */
export function stripePublishableKey(): string | null {
  const k = process.env.STRIPE_PUBLISHABLE_KEY?.trim();
  return k && /^pk_(live|test)_[A-Za-z0-9]{8,200}$/.test(k) ? k : null;
}

/** An image reference a browser can load: https URLs as-is, private /objects/ paths signed. */
export async function publicImage(ref: unknown): Promise<string | null> {
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
  theme: ReturnType<typeof storeSiteTheme>;
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
    theme: storeSiteTheme(page?.theme),
    socials: page ? page.socials ?? {} : normalizeSocials(u.socialLinks ?? {}),
    featuredIds: (page?.featuredProductIds ?? []).filter((id) => UUID_RE.test(id)),
    updatedAt: page?.updatedAt ?? null,
  };
}

/** What a block can't do right now (shown instead of its button), or null. */
function unavailableLabel(b: StoreBlockRecord): string | null {
  if (!b.open) return "Pre-orders closed";
  if (b.stock <= 0 || b.priceCents == null) return "Sold out";
  return null;
}

/** The product blocks as the in-app previews show them. */
export async function siteProductTiles(sellerId: string, featuredIds: string[]) {
  const blocks = await publicStoreBlocks(sellerId, featuredIds.filter((id) => UUID_RE.test(id)));
  return Promise.all(blocks.map(async (b) => ({
    id: b.productId, name: b.title || b.product.name, image: await publicImage(b.thumbImage ?? b.product.images[0]),
    priceLabel: b.priceCents == null ? "" : usd(b.priceCents),
  })));
}

/** Cache-buster for og:image so a redesign shows a fresh card. */
function ogVersion(site: LoadedSite, productIds: string[]): string {
  return crypto.createHash("sha1")
    .update(`${site.updatedAt?.getTime() ?? 0}|${site.logoRef ?? ""}|${site.displayName}|${site.theme.key}|${productIds.slice(0, 3).join(",")}`)
    .digest("hex").slice(0, 10);
}

/** utm_* / l (tracked link) from the store URL, carried onto checkout links. */
function attributionQuery(req: Request): string {
  const q = new URLSearchParams();
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "l"]) {
    const v = req.query[k];
    if (typeof v === "string" && /^[\w.-]{1,80}$/.test(v)) q.set(k, v);
  }
  const str = q.toString();
  return str ? `?${str}` : "";
}

function sendHtml(res: Response, csp: string, html: string): void {
  res.set("Cache-Control", "no-cache");
  res.set("Content-Security-Policy", csp);
  res.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.type("html").send(html);
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
    const [blocks, logoUrl] = await Promise.all([publicStoreBlocks(site.sellerId, site.featuredIds), publicImage(site.logoRef)]);
    const query = attributionQuery(req);
    const blocksOut: StoreSiteBlock[] = await Promise.all(blocks.map(async (b) => ({
      href: `/@${site.handle}/c/${b.productId}${query}`,
      kind: b.kind,
      style: b.style,
      image: await publicImage(b.thumbImage ?? b.product.images[0]),
      title: b.title || b.product.name,
      subtitle: b.subtitle,
      priceLabel: priceLabel(b.priceCents),
      compareAtLabel: priceLabel(b.compareAtPriceCents),
      shipByLabel: b.kind === "preorder" ? shipByLabel(b.shipBy) : "",
      buttonText: blockButtonText(b.kind, b.buttonText),
      unavailableLabel: unavailableLabel(b),
    })));
    const model: StoreSiteModel = {
      handle: site.handle,
      displayName: site.displayName,
      bio: site.bio,
      logoUrl,
      theme: site.theme,
      socials: Object.entries(site.socials).map(([key, href]) => ({ key, href })),
      blocks: blocksOut,
      canonicalUrl: canonical,
      ogImageUrl: `${canonical}/og.png?v=${ogVersion(site, blocks.map((b) => b.productId))}`,
    };
    await logBioEvent(req, site.sellerId, "view", "view", {}, 1);
    sendHtml(res, STORE_SITE_CSP, renderStoreSite(model));
  } catch (err) {
    req.log?.error({ err }, "store site render failed");
    res.status(500).send("Store temporarily unavailable");
  }
}

/** The site and the visible block for a product on it, or null. */
async function loadBlockPage(req: Request): Promise<{ site: LoadedSite; block: StoreBlockRecord } | null> {
  const site = await loadStoreSite(req.params.handle);
  const productId = req.params.productId;
  if (!site || typeof productId !== "string" || !UUID_RE.test(productId)) return null;
  const blocks = await publicStoreBlocks(site.sellerId, site.featuredIds);
  const block = blocks.find((b) => b.productId === productId.toLowerCase());
  return block ? { site, block } : null;
}

export async function storeSiteCheckoutHandler(req: Request, res: Response): Promise<void> {
  try {
    const found = await loadBlockPage(req);
    if (!found) return notFound(res);
    const { site, block } = found;
    const storePath = `/@${site.handle}`;
    const [logoUrl, image] = await Promise.all([
      publicImage(site.logoRef),
      publicImage(block.checkoutImage ?? block.thumbImage ?? block.product.images[0]),
    ]);
    const pk = stripePublishableKey();
    await logBioEvent(req, site.sellerId, "product", `p:${block.productId}`, { ref: block.productId });
    sendHtml(res, storeCheckoutCsp(!!pk), renderStoreCheckout({
      site: { handle: site.handle, displayName: site.displayName, logoUrl, theme: site.theme, canonicalUrl: storeSiteUrl(site.handle) },
      storePath,
      productId: block.productId,
      kind: block.kind,
      title: block.title || block.product.name,
      image,
      description: block.description || block.product.description,
      priceLabel: priceLabel(block.priceCents),
      compareAtLabel: priceLabel(block.compareAtPriceCents),
      shipByLabel: block.kind === "preorder" ? shipByLabel(block.shipBy) : "",
      variants: block.variants.map((v) => ({ id: v.id, label: v.label, priceLabel: priceLabel(v.priceCents), soldOut: v.stock <= 0 })),
      unavailableLabel: unavailableLabel(block),
      stripePublishableKey: pk,
      donePath: `${storePath}/c/${block.productId}/done`,
      canonicalUrl: `${storeSiteUrl(site.handle)}/c/${block.productId}`,
    }));
  } catch (err) {
    req.log?.error({ err }, "store checkout render failed");
    res.status(500).send("Checkout temporarily unavailable");
  }
}

export async function storeSiteCheckoutDoneHandler(req: Request, res: Response): Promise<void> {
  try {
    const found = await loadBlockPage(req);
    if (!found) return notFound(res);
    const { site, block } = found;
    const [logoUrl, image] = await Promise.all([
      publicImage(site.logoRef),
      publicImage(block.thumbImage ?? block.product.images[0]),
    ]);
    res.set("Cache-Control", "no-store");
    res.set("Content-Security-Policy", STORE_DONE_CSP);
    res.set("Referrer-Policy", "no-referrer");
    res.type("html").send(renderStoreCheckoutDone({
      site: { handle: site.handle, displayName: site.displayName, logoUrl, theme: site.theme, canonicalUrl: storeSiteUrl(site.handle) },
      storePath: `/@${site.handle}`,
      title: block.title || block.product.name,
      image,
      shipByLabel: block.kind === "preorder" ? shipByLabel(block.shipBy) : "",
    }));
  } catch (err) {
    req.log?.error({ err }, "store checkout done render failed");
    res.status(500).send("Store temporarily unavailable");
  }
}

/** Product links from the first store website open the product's checkout on the store. */
export async function storeSiteProductHandler(req: Request, res: Response): Promise<void> {
  try {
    const site = await loadStoreSite(req.params.handle);
    if (!site) return notFound(res);
    const found = await loadBlockPage(req);
    res.set("Cache-Control", "no-store");
    res.redirect(301, found ? `/@${site.handle}/c/${found.block.productId}` : `/@${site.handle}`);
  } catch (err) {
    req.log?.error({ err }, "store site product redirect failed");
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
    const blocks = await publicStoreBlocks(site.sellerId, site.featuredIds);
    const key = `${site.handle}:${ogVersion(site, blocks.map((b) => b.productId))}`;
    const hit = ogCache.get(key);
    let png = hit && Date.now() - hit.at < OG_TTL_MS ? hit.png : null;
    if (!png) {
      const withImages = blocks.filter((b) => b.thumbImage ?? b.product.images[0]).slice(0, 3);
      const [logoUrl, ...productImages] = await Promise.all([
        publicImage(site.logoRef),
        ...withImages.map((b) => publicImage(b.thumbImage ?? b.product.images[0])),
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
