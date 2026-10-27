/**
 * Full-catalog import over a seller's OAuth Shopify connection. One job row
 * per run (shopify_catalog_import_jobs) carries live progress the app polls
 * ("23 of 61 products"). Every product goes through upsertShopifyProduct, so
 * re-running updates the products it brought in before instead of
 * duplicating them. Products always land as drafts: the seller reviews them
 * in Products and publishes when ready.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, shopifyCatalogImportJobs, shopifyConnections, shopifyProductLinks } from "@workspace/db";
import { getVerifiedPlanAccess } from "../planAccess";
import { decryptSecret } from "../shopifyCrypto";
import { logger } from "../logger";
import { ShopifyApiError } from "./adminClient";
import { ShopifyCatalogClient } from "./catalog";
import { upsertShopifyProduct } from "./productImport";
import type { ImageStore } from "./productImages";

type JobRow = typeof shopifyCatalogImportJobs.$inferSelect;

/** A "running" job that hasn't moved for this long died with its process. */
export const STALE_JOB_MS = 5 * 60 * 1000;

export type CatalogImportDeps = {
  client?: Pick<ShopifyCatalogClient, "countProducts" | "productsPage">;
  imageStore?: ImageStore;
};

export function publicCatalogJob(job: JobRow) {
  return {
    id: job.id,
    shopDomain: job.shopDomain,
    status: job.status,
    totalCount: job.totalCount,
    processedCount: job.processedCount,
    importedCount: job.importedCount,
    updatedCount: job.updatedCount,
    skippedCount: job.skipped.length,
    skipped: job.skipped.slice(0, 20),
    imagesStored: job.imagesStored,
    imagesLinked: job.imagesLinked,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt,
  };
}

const STOPPED_MESSAGE = "This import stopped before it finished. Start it again to pick up the rest.";

/**
 * A job whose process died (deploy, crash) would read "running" forever and
 * freeze the app's progress bar; report it as stopped instead.
 */
export async function expireIfStale(job: JobRow): Promise<JobRow> {
  if (job.status !== "running" || Date.now() - job.updatedAt.getTime() < STALE_JOB_MS) return job;
  const [expired] = await db.update(shopifyCatalogImportJobs).set({
    status: "failed", errorMessage: STOPPED_MESSAGE, updatedAt: new Date(), finishedAt: new Date(),
  }).where(and(eq(shopifyCatalogImportJobs.id, job.id), eq(shopifyCatalogImportJobs.status, "running"))).returning();
  return expired ?? job;
}

export async function latestCatalogJob(ownerId: string): Promise<JobRow | null> {
  const [job] = await db.select().from(shopifyCatalogImportJobs)
    .where(eq(shopifyCatalogImportJobs.ownerId, ownerId))
    .orderBy(desc(shopifyCatalogImportJobs.createdAt)).limit(1);
  return job ? expireIfStale(job) : null;
}

/**
 * Creates a job, or hands back the seller's job that is already running so a
 * double tap never starts two imports of the same catalog.
 */
export async function createCatalogJob(ownerId: string, shopDomain: string): Promise<{ job: JobRow; created: boolean }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`shopify-catalog|${ownerId}`}))`);
    const [running] = await tx.select().from(shopifyCatalogImportJobs)
      .where(and(eq(shopifyCatalogImportJobs.ownerId, ownerId), eq(shopifyCatalogImportJobs.status, "running")))
      .orderBy(desc(shopifyCatalogImportJobs.createdAt)).limit(1);
    if (running && Date.now() - running.updatedAt.getTime() < STALE_JOB_MS) {
      return { job: running, created: false };
    }
    if (running) {
      await tx.update(shopifyCatalogImportJobs).set({
        status: "failed", errorMessage: STOPPED_MESSAGE,
        updatedAt: new Date(), finishedAt: new Date(),
      }).where(eq(shopifyCatalogImportJobs.id, running.id));
    }
    const [job] = await tx.insert(shopifyCatalogImportJobs).values({ ownerId, shopDomain }).returning();
    return { job, created: true };
  });
}

async function patchJob(jobId: string, values: Partial<typeof shopifyCatalogImportJobs.$inferInsert>) {
  await db.update(shopifyCatalogImportJobs).set({ ...values, updatedAt: new Date() })
    .where(eq(shopifyCatalogImportJobs.id, jobId));
}

function sellerMessage(err: unknown): string {
  if (err instanceof ShopifyApiError && (err.status === 401 || err.status === 403)) {
    return "Shopify no longer allows Brandthread to read this store. Reconnect Shopify and try again.";
  }
  if (err instanceof ShopifyApiError && err.status === 429) return err.message;
  return "We couldn't finish reading your Shopify catalog. The products already imported are saved — try again to pick up the rest.";
}

export async function runCatalogImport(jobId: string, deps: CatalogImportDeps = {}): Promise<void> {
  const [job] = await db.select().from(shopifyCatalogImportJobs).where(eq(shopifyCatalogImportJobs.id, jobId)).limit(1);
  if (!job || job.status !== "running") return;
  const ownerId = job.ownerId;
  const counts = { processed: 0, imported: 0, updated: 0, imagesStored: 0, imagesLinked: 0 };
  const skipped: JobRow["skipped"] = [];

  try {
    const [connection] = await db.select().from(shopifyConnections)
      .where(eq(shopifyConnections.ownerId, ownerId)).limit(1);
    if (!connection || connection.status !== "connected") throw new Error("Connect Shopify first.");

    let client = deps.client;
    if (!client) {
      let token: string;
      try {
        token = decryptSecret(connection.accessTokenEncrypted);
      } catch {
        throw new ShopifyApiError(401, "stored token unreadable");
      }
      client = new ShopifyCatalogClient(connection.shopDomain, token);
    }

    const totalCount = await client.countProducts();
    await patchJob(jobId, { totalCount });
    const productLimit = (await getVerifiedPlanAccess(ownerId)).limits.products;

    let cursor: string | null = null;
    do {
      const page = await client.productsPage(cursor);
      cursor = page.nextCursor;
      const ids = page.products.map((p) => String(p.id));
      const links = ids.length
        ? await db.select().from(shopifyProductLinks)
          .where(and(eq(shopifyProductLinks.ownerId, ownerId), inArray(shopifyProductLinks.shopifyProductId, ids)))
        : [];
      const linkById = new Map(links.map((link) => [link.shopifyProductId, link]));

      for (const product of page.products) {
        const shopifyProductId = String(product.id);
        try {
          const result = await upsertShopifyProduct({
            ownerId,
            shopDomain: connection.shopDomain,
            product,
            publishStatus: "draft",
            productLimit,
            link: linkById.get(shopifyProductId),
            imageStore: deps.imageStore,
          });
          counts[result.outcome] += 1;
          counts.imagesStored += result.imagesStored;
          counts.imagesLinked += result.imagesLinked;
        } catch (err) {
          skipped.push({
            shopifyProductId,
            title: product.title ?? undefined,
            reason: err instanceof Error ? err.message : "Unknown import error",
          });
        }
        counts.processed += 1;
        await patchJob(jobId, {
          // Shopify's count is a snapshot; never show "62 of 61".
          totalCount: Math.max(totalCount, counts.processed),
          processedCount: counts.processed,
          importedCount: counts.imported,
          updatedCount: counts.updated,
          imagesStored: counts.imagesStored,
          imagesLinked: counts.imagesLinked,
          skipped,
        });
      }
    } while (cursor);

    await patchJob(jobId, { status: "complete", totalCount: counts.processed, finishedAt: new Date() });
    await db.update(shopifyConnections).set({ lastImportAt: new Date(), lastError: null, updatedAt: new Date() })
      .where(eq(shopifyConnections.id, connection.id));
  } catch (err) {
    logger.error({ err, jobId, ownerId }, "Shopify catalog import failed");
    const message = sellerMessage(err);
    await patchJob(jobId, { status: "failed", errorMessage: message, finishedAt: new Date() });
    if (err instanceof ShopifyApiError && (err.status === 401 || err.status === 403)) {
      await db.update(shopifyConnections).set({ status: "error", lastError: message, updatedAt: new Date() })
        .where(eq(shopifyConnections.ownerId, ownerId));
    }
  }
}
