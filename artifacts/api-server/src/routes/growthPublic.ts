/**
 * Public (unauthenticated) growth handlers, mounted at the site root like
 * /u/:username (see app.ts):
 *   GET /l/:code                      tracked short link -> 302 with UTM params
 *   GET /bio/:slug                    server-rendered link-in-bio page
 *   GET /bio/:slug/go/:linkId         click-tracked redirect for a bio link
 *   GET /bio/:slug/shop               click-tracked redirect to the store
 *   GET /bio/:slug/p/:productId       click-tracked redirect to a featured product
 * Clicks are bot-filtered and rate-limited; no IP address is stored.
 */
import type { Request, Response } from "express";
import { db, trackedLinks, linkClicks, bioPages, bioLinks, bioEvents, products, productVariants } from "@workspace/db";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { renderBioPage, esc, type BioPageModel } from "../lib/growth/bioPage";
import { BIO_SLUG_RE } from "../lib/growth/bioValidation";
import { countableClick } from "../lib/growth/clicks";
import { resolveProductUrl, resolveStoreHome, resolveTrackedLinkTarget, bioPageUrl } from "../lib/growth/destinations";
import { normalizeLinkCode } from "../lib/growth/linkCodes";
import { buildDestinationUrl } from "../lib/growth/utm";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notFound(res: Response, what: string): void {
  res.status(404).type("html").set("Cache-Control", "no-store").send(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Not found</title><style>body{font-family:Inter,system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:24px}</style></head><body><main><h1>${esc(what)} isn't available</h1><p>The link may have been removed.</p></main></body></html>`,
  );
}

function redirect(res: Response, url: string): void {
  res.set("Cache-Control", "no-store");
  res.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.redirect(302, url);
}

// ── GET /l/:code ───────────────────────────────────────────────────────────
export async function trackedLinkRedirect(req: Request, res: Response): Promise<void> {
  const code = normalizeLinkCode(req.params.code);
  if (!code) return notFound(res, "This link");
  try {
    const [link] = await db.select().from(trackedLinks).where(eq(trackedLinks.code, code)).limit(1);
    if (!link || link.archivedAt) return notFound(res, "This link");
    const target = await resolveTrackedLinkTarget(link);
    if (!target) return notFound(res, "This link");
    const ctx = await countableClick(req, `l:${code}`);
    if (ctx) {
      await db.insert(linkClicks).values({
        linkId: link.id, sellerId: link.sellerId, country: ctx.country, referrerHost: ctx.referrerHost,
      }).catch((err) => req.log?.warn({ err }, "link click insert failed"));
    }
    redirect(res, target);
  } catch (err) {
    req.log?.error({ err }, "tracked link redirect failed");
    res.status(500).send("Link temporarily unavailable");
  }
}

// ── Bio page ───────────────────────────────────────────────────────────────
async function loadPublishedBio(slug: unknown) {
  if (typeof slug !== "string" || !BIO_SLUG_RE.test(slug.toLowerCase())) return null;
  const [page] = await db.select().from(bioPages).where(eq(bioPages.slug, slug.toLowerCase())).limit(1);
  return page && page.published ? page : null;
}

async function logBioEvent(req: Request, sellerId: string, kind: string, scope: string, extra: { bioLinkId?: string; ref?: string } = {}, max = 3) {
  const ctx = await countableClick(req, `bio:${sellerId}:${scope}`, { max });
  if (!ctx) return;
  await db.insert(bioEvents).values({
    sellerId, kind, bioLinkId: extra.bioLinkId ?? null, ref: extra.ref ?? null, country: ctx.country, referrerHost: ctx.referrerHost,
  }).catch((err) => req.log?.warn({ err }, "bio event insert failed"));
}

const usd = (cents: number) => `$${(Math.max(0, cents) / 100).toFixed(2)}`;

export async function bioPageHandler(req: Request, res: Response): Promise<void> {
  try {
    const page = await loadPublishedBio(req.params.slug);
    if (!page) return notFound(res, "This page");
    const slug = page.slug;
    const links = await db.select().from(bioLinks)
      .where(and(eq(bioLinks.sellerId, page.sellerId), eq(bioLinks.enabled, true)))
      .orderBy(asc(bioLinks.position), asc(bioLinks.createdAt));

    let featured: BioPageModel["products"] = [];
    const ids = (page.featuredProductIds ?? []).filter((id) => UUID_RE.test(id)).slice(0, 6);
    if (ids.length) {
      const rows = await db.select({ id: products.id, name: products.name, images: products.images })
        .from(products)
        .where(and(inArray(products.id, ids), eq(products.ownerId, page.sellerId), eq(products.status, "active"), isNull(products.deletedAt)));
      const variants = await db.select({ productId: productVariants.productId, priceCents: productVariants.priceCents })
        .from(productVariants).where(inArray(productVariants.productId, rows.map((r) => r.id)));
      featured = ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => !!r).map((r) => {
        const prices = variants.filter((v) => v.productId === r.id).map((v) => v.priceCents);
        const imgs = Array.isArray(r.images) ? (r.images as string[]) : [];
        return {
          href: `/bio/${slug}/p/${r.id}`, name: r.name, image: imgs[0] ?? null,
          priceLabel: prices.length ? usd(Math.min(...prices)) : "",
        };
      });
    }

    const storeHome = page.showShopButton ? await resolveStoreHome(page.sellerId) : null;
    const model: BioPageModel = {
      slug,
      displayName: page.displayName,
      bio: page.bio,
      avatarUrl: page.avatarUrl,
      theme: page.theme === "dark" ? "dark" : "mono",
      accentColor: page.accentColor,
      shop: storeHome ? { href: `/bio/${slug}/shop`, label: page.shopButtonLabel || "Shop my store" } : null,
      products: featured,
      links: links.map((l) => ({ href: `/bio/${slug}/go/${l.id}`, title: l.title })),
      socials: Object.entries(page.socials ?? {}).map(([key, href]) => ({ key, href })),
      canonicalUrl: bioPageUrl(slug),
    };
    await logBioEvent(req, page.sellerId, "view", "view", {}, 1);
    res.set("Cache-Control", "no-cache");
    res.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src https:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    res.type("html").send(renderBioPage(model));
  } catch (err) {
    req.log?.error({ err }, "bio page render failed");
    res.status(500).send("Page temporarily unavailable");
  }
}

export async function bioLinkRedirect(req: Request, res: Response): Promise<void> {
  try {
    const page = await loadPublishedBio(req.params.slug);
    const linkId = req.params.linkId;
    if (!page || typeof linkId !== "string" || !UUID_RE.test(linkId)) return notFound(res, "This link");
    const [link] = await db.select().from(bioLinks)
      .where(and(eq(bioLinks.id, linkId), eq(bioLinks.sellerId, page.sellerId), eq(bioLinks.enabled, true))).limit(1);
    if (!link) return notFound(res, "This link");
    await logBioEvent(req, page.sellerId, "click", `link:${link.id}`, { bioLinkId: link.id });
    redirect(res, link.url);
  } catch (err) {
    req.log?.error({ err }, "bio link redirect failed");
    res.status(500).send("Link temporarily unavailable");
  }
}

const BIO_UTM = { source: "brandthread_bio", medium: "link_in_bio", campaign: null, term: null, content: null } as const;

export async function bioShopRedirect(req: Request, res: Response): Promise<void> {
  try {
    const page = await loadPublishedBio(req.params.slug);
    if (!page || !page.showShopButton) return notFound(res, "This page");
    const home = await resolveStoreHome(page.sellerId);
    if (!home) return notFound(res, "This store");
    await logBioEvent(req, page.sellerId, "shop", "shop");
    redirect(res, buildDestinationUrl(home, { ...BIO_UTM }));
  } catch (err) {
    req.log?.error({ err }, "bio shop redirect failed");
    res.status(500).send("Link temporarily unavailable");
  }
}

export async function bioProductRedirect(req: Request, res: Response): Promise<void> {
  try {
    const page = await loadPublishedBio(req.params.slug);
    const productId = req.params.productId;
    if (!page || typeof productId !== "string" || !UUID_RE.test(productId) || !(page.featuredProductIds ?? []).includes(productId)) {
      return notFound(res, "This product");
    }
    const url = await resolveProductUrl(page.sellerId, productId);
    if (!url) return notFound(res, "This product");
    await logBioEvent(req, page.sellerId, "product", `p:${productId}`, { ref: productId });
    redirect(res, buildDestinationUrl(url, { ...BIO_UTM }));
  } catch (err) {
    req.log?.error({ err }, "bio product redirect failed");
    res.status(500).send("Link temporarily unavailable");
  }
}
