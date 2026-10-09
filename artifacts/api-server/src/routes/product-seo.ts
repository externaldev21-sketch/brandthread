/**
 * Per-product search listing (SEO).
 *
 *   GET /api/product-seo/public/:storeSlug/sitemap     — indexable products (public)
 *   GET /api/product-seo/public/:storeSlug/:handle     — resolved SEO for one product (public)
 *   GET /api/product-seo/:productId                    — seller: stored + resolved SEO
 *   PUT /api/product-seo/:productId                    — seller: save (manager+)
 *
 * The storefront web page (`/api/store/site/:slug`) is a single page with
 * product cards and has no per-product pages, so these public endpoints are
 * the only place resolved product SEO is exposed today.
 */
import { Router } from "express";
import { db, products, productSeo, storefronts } from "@workspace/db";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { teamContext, requireRole } from "../middlewares/requireRole";
import { rateLimit } from "../middlewares/rateLimit";
import { logActivity, reqActor } from "../lib/activityLog";
import {
  HANDLE_MAX, SEO_DESCRIPTION_MAX, SEO_TITLE_MAX,
  isValidHandle, resolveProductSeo, suggestUniqueHandle,
  type StoreSeoDefaults,
} from "../lib/productSeo";

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function defaultsFromStorefront(sf: { title: string; seo: Record<string, unknown> } | undefined | null): StoreSeoDefaults {
  const seo = (sf?.seo ?? {}) as any;
  const pd = seo.productSeoDefaults ?? {};
  return {
    storeName: sf?.title ?? "",
    titleTemplate: typeof pd.titleTemplate === "string" ? pd.titleTemplate : null,
    descriptionTemplate: typeof pd.descriptionTemplate === "string" ? pd.descriptionTemplate : null,
  };
}

async function storeDefaultsFor(ownerId: string): Promise<StoreSeoDefaults> {
  const [sf] = await db.select({ title: storefronts.title, seo: storefronts.seo })
    .from(storefronts).where(eq(storefronts.ownerId, ownerId)).limit(1);
  return defaultsFromStorefront(sf);
}

// ─── Public ──────────────────────────────────────────────────────────────────

async function publishedStore(slug: string) {
  const [sf] = await db.select().from(storefronts).where(eq(storefronts.slug, slug)).limit(1);
  return sf && sf.status === "published" ? sf : null;
}

const liveProduct = (ownerId: string) => and(
  eq(products.ownerId, ownerId),
  eq(products.status, "active"),
  isNull(products.deletedAt),
);

router.get("/public/:storeSlug/sitemap", rateLimit("public-read"), async (req, res): Promise<void> => {
  const sf = await publishedStore(String(req.params.storeSlug));
  if (!sf) { res.status(404).json({ error: "Store not found" }); return; }
  const seoSettings = (sf.seo ?? {}) as any;
  if (seoSettings.sitemapEnabled === false) { res.json({ storeSlug: sf.slug, entries: [] }); return; }

  const defaults = defaultsFromStorefront(sf);
  const rows = await db
    .select({
      id: products.id, name: products.name, description: products.description,
      images: products.images, updatedAt: products.updatedAt,
      seoTitle: productSeo.seoTitle, seoDescription: productSeo.seoDescription,
      urlHandle: productSeo.urlHandle, noIndex: productSeo.noIndex, socialImageUrl: productSeo.socialImageUrl,
    })
    .from(products)
    .leftJoin(productSeo, eq(productSeo.productId, products.id))
    .where(liveProduct(sf.ownerId));

  const entries = rows
    .map((r) => {
      const resolved = resolveProductSeo(r, r, defaults);
      return { productId: r.id, handle: resolved.handle, path: `/products/${resolved.handle}`, lastModified: r.updatedAt.toISOString(), noIndex: resolved.noIndex };
    })
    .filter((e) => !e.noIndex)
    .map(({ noIndex: _n, ...e }) => e);
  res.json({ storeSlug: sf.slug, entries });
});

router.get("/public/:storeSlug/:handle", rateLimit("public-read"), async (req, res): Promise<void> => {
  const sf = await publishedStore(String(req.params.storeSlug));
  if (!sf) { res.status(404).json({ error: "Store not found" }); return; }
  const handle = String(req.params.handle).toLowerCase();

  const base = {
    id: products.id, name: products.name, description: products.description, images: products.images,
    seoTitle: productSeo.seoTitle, seoDescription: productSeo.seoDescription,
    urlHandle: productSeo.urlHandle, noIndex: productSeo.noIndex, socialImageUrl: productSeo.socialImageUrl,
  };
  let row: any;
  [row] = await db.select(base).from(products)
    .innerJoin(productSeo, eq(productSeo.productId, products.id))
    .where(and(liveProduct(sf.ownerId), eq(productSeo.urlHandle, handle))).limit(1);
  if (!row && UUID_RE.test(handle)) {
    [row] = await db.select(base).from(products)
      .leftJoin(productSeo, eq(productSeo.productId, products.id))
      .where(and(liveProduct(sf.ownerId), eq(products.id, handle))).limit(1);
  }
  if (!row) { res.status(404).json({ error: "Product not found" }); return; }

  const resolved = resolveProductSeo(row, row, defaultsFromStorefront(sf));
  res.set("Cache-Control", "public, max-age=60");
  res.json({
    productId: row.id,
    storeSlug: sf.slug,
    path: `/products/${resolved.handle}`,
    title: resolved.title,
    description: resolved.description,
    noIndex: resolved.noIndex,
    image: resolved.image,
    openGraph: { type: "product", title: resolved.title, description: resolved.description, image: resolved.image },
    robots: resolved.noIndex ? "noindex, nofollow" : "index, follow",
  });
});

// ─── Seller ──────────────────────────────────────────────────────────────────
router.use(requireAuth);
router.use(teamContext());

async function ownedProduct(ownerId: string, productId: string) {
  if (!UUID_RE.test(productId)) return null;
  const [p] = await db.select({
    id: products.id, name: products.name, description: products.description, images: products.images,
  }).from(products)
    .where(and(eq(products.id, productId), eq(products.ownerId, ownerId), isNull(products.deletedAt)))
    .limit(1);
  return p ?? null;
}

async function takenHandles(ownerId: string, exceptProductId: string): Promise<string[]> {
  const rows = await db.select({ handle: productSeo.urlHandle }).from(productSeo)
    .where(and(eq(productSeo.ownerId, ownerId), ne(productSeo.productId, exceptProductId), sql`${productSeo.urlHandle} is not null`));
  return rows.map((r) => r.handle!).filter(Boolean);
}

async function describe(ownerId: string, product: NonNullable<Awaited<ReturnType<typeof ownedProduct>>>) {
  const [stored] = await db.select().from(productSeo).where(eq(productSeo.productId, product.id)).limit(1);
  const defaults = await storeDefaultsFor(ownerId);
  const overrides = {
    seoTitle: stored?.seoTitle ?? null,
    seoDescription: stored?.seoDescription ?? null,
    urlHandle: stored?.urlHandle ?? null,
    noIndex: stored?.noIndex ?? false,
    socialImageUrl: stored?.socialImageUrl ?? null,
  };
  const taken = await takenHandles(ownerId, product.id);
  return {
    productId: product.id,
    productName: product.name,
    seo: overrides,
    resolved: resolveProductSeo(product, overrides, defaults),
    suggestedHandle: suggestUniqueHandle(product.name, taken, product.id),
    storeName: defaults.storeName ?? "",
    limits: { title: SEO_TITLE_MAX, description: SEO_DESCRIPTION_MAX, handle: HANDLE_MAX },
  };
}

router.get("/:productId", async (req, res): Promise<void> => {
  const ownerId = (req as any).clerkUserId as string;
  const product = await ownedProduct(ownerId, String(req.params.productId));
  if (!product) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await describe(ownerId, product));
});

function optionalText(value: unknown, field: string, max: number): { value: string | null } | { error: string } {
  if (value === undefined || value === null) return { value: null };
  if (typeof value !== "string") return { error: `${field} must be text` };
  const trimmed = value.trim();
  if (trimmed.length > max) return { error: `${field} must be ${max} characters or fewer` };
  return { value: trimmed === "" ? null : trimmed };
}

router.put("/:productId", requireRole("manager"), async (req, res): Promise<void> => {
  const ownerId = (req as any).clerkUserId as string;
  const product = await ownedProduct(ownerId, String(req.params.productId));
  if (!product) { res.status(404).json({ error: "Not found" }); return; }

  const body = req.body ?? {};
  const title = optionalText(body.seoTitle, "Page title", SEO_TITLE_MAX);
  const description = optionalText(body.seoDescription, "Meta description", SEO_DESCRIPTION_MAX);
  const handleIn = optionalText(body.urlHandle, "URL handle", HANDLE_MAX);
  const image = optionalText(body.socialImageUrl, "Social image", 500);
  for (const r of [title, description, handleIn, image]) {
    if ("error" in r) { res.status(400).json({ error: r.error, code: "VALIDATION_ERROR" }); return; }
  }
  if (body.noIndex !== undefined && typeof body.noIndex !== "boolean") {
    res.status(400).json({ error: "noIndex must be true or false", code: "VALIDATION_ERROR" }); return;
  }
  const handle = (handleIn as { value: string | null }).value?.toLowerCase() ?? null;
  if (handle !== null && !isValidHandle(handle)) {
    res.status(400).json({
      error: "URL handle can use lowercase letters, numbers and single hyphens",
      code: "INVALID_HANDLE",
    });
    return;
  }
  const socialImageUrl = (image as { value: string | null }).value;
  if (socialImageUrl !== null && !/^(https?:\/\/|\/)/i.test(socialImageUrl)) {
    res.status(400).json({ error: "Social image must be a link", code: "VALIDATION_ERROR" }); return;
  }

  if (handle !== null) {
    const clash = await takenHandles(ownerId, product.id);
    if (clash.some((h) => h.toLowerCase() === handle)) {
      res.status(409).json({ error: "That URL handle is already used by another product", code: "HANDLE_TAKEN" }); return;
    }
  }

  const values = {
    ownerId,
    seoTitle: (title as { value: string | null }).value,
    seoDescription: (description as { value: string | null }).value,
    urlHandle: handle,
    noIndex: body.noIndex === true,
    socialImageUrl,
    updatedAt: new Date(),
  };
  try {
    await db.insert(productSeo)
      .values({ productId: product.id, ...values })
      .onConflictDoUpdate({ target: productSeo.productId, set: values });
  } catch (err: any) {
    // A concurrent save can still win the unique index after the check above.
    if (err?.code === "23505" || err?.cause?.code === "23505") {
      res.status(409).json({ error: "That URL handle is already used by another product", code: "HANDLE_TAKEN" }); return;
    }
    throw err;
  }

  const actor = reqActor(req);
  void logActivity(
    actor.ownerClerkId, actor.actorClerkId, actor.actorRole,
    `Updated search listing for "${product.name}"`, "product", product.id,
  );
  res.json(await describe(ownerId, product));
});

export default router;
