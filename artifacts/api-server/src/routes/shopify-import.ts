import { Router } from "express";
import crypto from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db, products, productVariants, storefronts,
  shopifyImportJobs, shopifyImportCollections, shopifyImportProductMappings,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { requireRole } from "../middlewares/requireRole";
import { generateText } from "@workspace/integrations-openai-ai-server/text";
import {
  ShopifyImportError,
  discoverShopifyCatalog, normalizeShopifyUrl, toBrandthreadProduct, deterministicSku,
} from "../lib/shopifyImport";

const router = Router();
router.use(requireAuth);

const THREAD_THEME = {
  themeId: "thread", primaryColor: "#111111", secondaryColor: "#6B6B6B",
  accentColor: "#2B2B2B", backgroundColor: "#F7F7F5", textColor: "#111111",
  fontFamily: "Cormorant Garamond, Georgia, serif", borderRadius: 0,
};

const STAGES = ["validating", "fetching_products", "counting_products", "analyzing_brand", "creating_listings", "building_storefront"] as const;
type Stage = typeof STAGES[number];

function stageUpdate(stage: Stage) {
  return { stage, updatedAt: new Date() };
}

function publicJob(job: any) {
  return {
    id: job.id, sourceUrl: job.sourceUrl, status: job.status, stage: job.stage,
    importedCount: job.importedCount, failedCount: job.failedCount,
    hasMore: job.hasMore, sourceStoreName: job.sourceStoreName,
    errorCode: job.errorCode, errorMessage: job.errorMessage,
    createdAt: job.createdAt, updatedAt: job.updatedAt,
  };
}

async function generatedStore(sourceStoreName: string, aboutCopy: string, productsForPrompt: Array<{ name: string; category: string; description: string }>, collections: Array<{ title?: string }>) {
  const prompt = `Create concise brand voice and storefront copy for a fashion seller being transferred from Shopify.
Store name: ${sourceStoreName}
Accessible homepage copy: ${aboutCopy.slice(0, 4000)}
Catalog: ${JSON.stringify(productsForPrompt.slice(0, 40))}
Collections: ${JSON.stringify(collections.slice(0, 30))}
Respond ONLY as JSON with title, subtitle, description, tagline, mission, targetAudience, metaTitle, metaDescription, keywords, heroHeading, heroDescription, storyHeading, storyDescription.`;
  try {
    const raw = await generateText(
      "You are Brandthread's editorial storefront copywriter. Return valid JSON only. Do not suggest source colors; the destination uses the monochrome Thread Theme.",
      prompt,
    );
    const clean = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    const parsed = JSON.parse(clean) as Record<string, unknown>;
    return parsed;
  } catch {
    return {
      title: sourceStoreName, subtitle: "The pieces in rotation.",
      description: "A considered collection of pieces made to be worn often.",
      tagline: "Considered pieces for everyday movement.",
      mission: "", targetAudience: "", metaTitle: `${sourceStoreName} — Brandthread`,
      metaDescription: "Explore the collection.", keywords: [], heroHeading: "The new uniform.",
      heroDescription: "Considered pieces for everyday movement.",
      storyHeading: "Designed with intention.",
      storyDescription: "Fewer pieces, better made, and meant to be worn often.",
    };
  }
}

async function updateJob(id: string, ownerId: string, values: Record<string, unknown>) {
  const [updated] = await db.update(shopifyImportJobs).set(values as any)
    .where(and(eq(shopifyImportJobs.id, id), eq(shopifyImportJobs.ownerId, ownerId))).returning();
  return updated;
}

async function failJob(id: string, ownerId: string, error: unknown) {
  const typed = error instanceof ShopifyImportError ? error : new ShopifyImportError("UNREACHABLE", "We could not reach that store. Check the URL and try again.");
  await updateJob(id, ownerId, {
    status: "failed", errorCode: typed.code, errorMessage: typed.message, updatedAt: new Date(),
  });
}

async function processJob(jobId: string, ownerId: string): Promise<void> {
  const [job] = await db.update(shopifyImportJobs).set({
    status: "running", errorCode: null, errorMessage: null, ...stageUpdate("validating"),
  }).where(and(
    eq(shopifyImportJobs.id, jobId),
    eq(shopifyImportJobs.ownerId, ownerId),
    eq(shopifyImportJobs.status, "queued"),
  )).returning();
  // A queued→running update is the worker lease. Only one concurrent request
  // can own this batch.
  if (!job) return;
  try {
    const catalog = await discoverShopifyCatalog(job.sourceUrl, job.nextCursor);
    await updateJob(jobId, ownerId, { ...stageUpdate("fetching_products"), sourceStoreName: catalog.storeName });
    await updateJob(jobId, ownerId, { ...stageUpdate("counting_products") });

    const normalized: ReturnType<typeof toBrandthreadProduct>[] = [];
    let failedCount = 0;
    for (const sourceProduct of catalog.products) {
      try {
        const collectionTitle = catalog.collections.find((collection) =>
          collection.sourceProductIds?.includes(String(sourceProduct.id)))?.title;
        normalized.push(toBrandthreadProduct(
          sourceProduct,
          collectionTitle || sourceProduct.product_type || undefined,
        ));
      } catch {
        failedCount++;
      }
    }
    if (!normalized.length && !job.importedCount) throw new ShopifyImportError("EMPTY_CATALOG", "This Shopify store has no importable public products.");

    await updateJob(jobId, ownerId, { ...stageUpdate("analyzing_brand") });
    const ai = await generatedStore(catalog.storeName, catalog.aboutCopy, normalized, catalog.collections);
    await updateJob(jobId, ownerId, { ...stageUpdate("creating_listings") });

    await db.transaction(async (tx) => {
      // Serialize imports for one seller/source across separate jobs as well as
      // repeated continuation requests.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${ownerId}|${job.sourceUrl}`}))`);
      const collectionRows = catalog.collections
        .filter((collection) => collection.id != null && String(collection.title ?? "").trim())
        .map((collection) => ({
          ownerId, sourceUrl: job.sourceUrl, importJobId: jobId,
          sourceCollectionId: String(collection.id), title: String(collection.title).trim(),
           handle: collection.handle ?? null, sourceProductIds: collection.sourceProductIds ?? [],
        }));
      for (const row of collectionRows) {
        await tx.insert(shopifyImportCollections).values(row)
          .onConflictDoUpdate({
            target: [shopifyImportCollections.ownerId, shopifyImportCollections.sourceUrl, shopifyImportCollections.sourceCollectionId],
            set: { title: row.title, handle: row.handle, sourceProductIds: row.sourceProductIds },
          });
      }
      let importedThisBatch = 0;
      const destinationProductIds = new Map<string, string>();
      for (const item of normalized) {
        const [existing] = await tx.select({
          id: shopifyImportProductMappings.id,
          productId: shopifyImportProductMappings.productId,
        })
          .from(shopifyImportProductMappings)
          .where(and(
            eq(shopifyImportProductMappings.ownerId, ownerId),
            eq(shopifyImportProductMappings.sourceUrl, job.sourceUrl),
            eq(shopifyImportProductMappings.sourceProductId, item.sourceProductId),
          )).limit(1);
        if (existing) {
          destinationProductIds.set(item.sourceProductId, existing.productId);
          continue;
        }
        const [product] = await tx.insert(products).values({
          ownerId, name: item.name, description: item.description, category: item.category,
          status: "draft", images: item.images, tags: item.tags,
        }).returning({ id: products.id });
        await tx.insert(productVariants).values(item.variants.map((variant, index) => ({
          productId: product.id, size: variant.size, color: variant.color,
          sku: deterministicSku(job.sourceUrl, item.sourceProductId, variant.sku, index),
          priceCents: variant.priceCents, stock: variant.stock, lowStockThreshold: variant.lowStockThreshold,
        })));
        await tx.insert(shopifyImportProductMappings).values({
          ownerId, sourceUrl: job.sourceUrl, sourceProductId: item.sourceProductId,
          importJobId: jobId, productId: product.id,
        });
        destinationProductIds.set(item.sourceProductId, product.id);
        importedThisBatch++;
      }

      const existingStore = await tx.select().from(storefronts).where(eq(storefronts.ownerId, ownerId)).limit(1);
      const title = String(ai.title ?? catalog.storeName).slice(0, 120);
      const existingSections = Array.isArray(existingStore[0]?.sections) ? existingStore[0].sections as any[] : [];
      const collectionSections = catalog.collections.map((collection, index) => ({
        id: `shopify-collection-${String(collection.id)}`,
        type: "product_grid", title: String(collection.title),
        enabled: true, order: index + 1,
        settings: {
          heading: String(collection.title), description: "Imported collection", columns: 2, quickAdd: false,
          sourceHandle: collection.handle ?? null,
          productIds: [...new Set([
            ...((existingSections.find((section) => section.id === `shopify-collection-${String(collection.id)}`)?.settings?.productIds ?? []) as string[]),
            ...(collection.sourceProductIds ?? []).map((sourceId) => destinationProductIds.get(sourceId)).filter((id): id is string => Boolean(id)),
          ])],
        },
      }));
      const sections = [
        { id: "thread-hero", type: "hero_image", title: "Hero Image", enabled: true, order: 0,
          settings: { heading: String(ai.heroHeading ?? "The new uniform."), description: String(ai.heroDescription ?? "Considered pieces for everyday movement."), buttonLabel: "Shop the collection", fullWidth: true, sectionHeight: "tall" } },
        ...collectionSections,
        { id: "thread-story", type: "brand_story", title: "Brand Story", enabled: true, order: collectionSections.length + 1,
          settings: { heading: String(ai.storyHeading ?? "Designed with intention."), description: String(ai.storyDescription ?? "Fewer pieces, better made, and meant to be worn often.") } },
        { id: "thread-newsletter", type: "newsletter", title: "Newsletter", enabled: true, order: collectionSections.length + 2,
          settings: { heading: "Stay close.", description: "New releases, studio notes, and first access.", buttonLabel: "Join the list" } },
      ];
      const seo = { metaTitle: String(ai.metaTitle ?? `${title} — Brandthread`), metaDescription: String(ai.metaDescription ?? "Explore the collection."), keywords: Array.isArray(ai.keywords) ? ai.keywords.slice(0, 20) : [] };
      const branding = { tagline: String(ai.tagline ?? ""), mission: String(ai.mission ?? ""), targetAudience: String(ai.targetAudience ?? "") };
      if (existingStore[0]) {
        await tx.update(storefronts).set({
          title, subtitle: String(ai.subtitle ?? "The pieces in rotation."),
          description: String(ai.description ?? "A considered collection of pieces made to be worn often."),
          theme: THREAD_THEME, branding, sections, seo, updatedAt: new Date(),
        }).where(eq(storefronts.id, existingStore[0].id));
      } else {
        await tx.insert(storefronts).values({
          ownerId, slug: `store-${crypto.randomBytes(4).toString("hex")}`, title,
          subtitle: String(ai.subtitle ?? "The pieces in rotation."),
          description: String(ai.description ?? "A considered collection of pieces made to be worn often."),
          theme: THREAD_THEME, branding, sections, seo,
        });
      }
      const hasMore = Boolean(catalog.nextCursor);
      await tx.update(shopifyImportJobs).set({
        status: hasMore ? "needs_continuation" : "complete",
        stage: "building_storefront", nextCursor: catalog.nextCursor, hasMore,
        errorCode: failedCount > 0 ? "PARTIAL_IMPORT" : null,
        errorMessage: failedCount > 0 ? "Some products could not be imported. The successful products are saved and you can continue." : null,
        importedCount: job.importedCount + importedThisBatch,
        failedCount: job.failedCount + failedCount,
        updatedAt: new Date(),
      }).where(and(eq(shopifyImportJobs.id, jobId), eq(shopifyImportJobs.ownerId, ownerId)));
    });
  } catch (error) {
    await failJob(jobId, ownerId, error);
  }
}

router.post("/", requireRole("manager"), async (req, res) => {
  let sourceUrl: string;
  try { sourceUrl = normalizeShopifyUrl(req.body?.url); } catch (error) {
    const typed = error instanceof ShopifyImportError ? error : new ShopifyImportError("INVALID_URL", "Enter a Shopify store URL.");
    res.status(400).json({ error: typed.code, message: typed.message }); return;
  }
  const ownerId = (req as any).clerkUserId as string;
  const [job] = await db.insert(shopifyImportJobs).values({ ownerId, sourceUrl }).returning();
  void processJob(job.id, ownerId);
  res.status(202).json(publicJob(job));
});

router.get("/latest", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const [job] = await db.select().from(shopifyImportJobs)
    .where(eq(shopifyImportJobs.ownerId, ownerId))
    .orderBy(desc(shopifyImportJobs.createdAt)).limit(1);
  res.json(job ? publicJob(job) : null);
});

router.get("/:id", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const [job] = await db.select().from(shopifyImportJobs)
    .where(and(eq(shopifyImportJobs.id, req.params.id), eq(shopifyImportJobs.ownerId, ownerId))).limit(1);
  if (!job) { res.status(404).json({ error: "IMPORT_NOT_FOUND", message: "Import not found." }); return; }
  res.json(publicJob(job));
});

router.post("/:id/continue", requireRole("manager"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const [job] = await db.update(shopifyImportJobs).set({
    status: "queued", stage: "validating", updatedAt: new Date(),
  }).where(and(
    eq(shopifyImportJobs.id, req.params.id),
    eq(shopifyImportJobs.ownerId, ownerId),
    eq(shopifyImportJobs.status, "needs_continuation"),
    eq(shopifyImportJobs.hasMore, true),
  )).returning();
  if (!job) {
    const [current] = await db.select({ status: shopifyImportJobs.status }).from(shopifyImportJobs)
      .where(and(eq(shopifyImportJobs.id, req.params.id), eq(shopifyImportJobs.ownerId, ownerId))).limit(1);
    if (!current) { res.status(404).json({ error: "IMPORT_NOT_FOUND", message: "Import not found." }); return; }
    res.status(409).json({
      error: current.status === "running" || current.status === "queued" ? "IMPORT_RUNNING" : "IMPORT_COMPLETE",
      message: current.status === "running" || current.status === "queued"
        ? "This Shopify import is already running."
        : "This Shopify import cannot be continued.",
    });
    return;
  }
  void processJob(job.id, ownerId);
  res.status(202).json(publicJob(job));
});

export { processJob };
export default router;