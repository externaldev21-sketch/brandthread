/**
 * Product transfer (A): imports Shopify products into Brandthread, updating
 * in place (never duplicating) on re-import via `shopifyProductLinks`.
 * Photos are copied into object storage (./productImages). This never touches
 * orders — it is entirely separate from fulfillment (B).
 */
import { and, eq, inArray, ne } from "drizzle-orm";
import { db, productOptionAxes, products, productVariants, shopifyProductLinks } from "@workspace/db";
import { ShopifyAdminClient } from "./adminClient";
import type { ShopifyProduct } from "../shopifyImport";
import { mirrorShopifyImages, type ImageStore } from "./productImages";
import { getVerifiedPlanAccess } from "../planAccess";
import { remainingProductCapacity } from "../productCapacity";
import { toBrandthreadProduct, deterministicSku } from "../shopifyImport";
import { onProductStockPriceChanged, snapshotProduct } from "../savedProductAlerts";
import { checkListingIntegrity } from "../listingIntegrity";

export type ImportSummary = {
  imported: number;
  updated: number;
  skipped: Array<{ shopifyProductId: string; reason: string }>;
  /** Imported as drafts because the text names a protected brand or counterfeit term. */
  held?: Array<{ shopifyProductId: string; terms: string[] }>;
};

/** Reuses the seller's own SKU when it is free; otherwise falls back to a deterministic one (SKUs are globally unique). */
async function resolveSku(ownerId: string, shopDomain: string, shopifyProductId: string, rawSku: string, index: number, keepVariantId?: string): Promise<string> {
  if (!rawSku) return deterministicSku(shopDomain, shopifyProductId, rawSku, index);
  const clashes = await db.select({ id: productVariants.id })
    .from(productVariants)
    .where(and(
      eq(productVariants.sku, rawSku),
      keepVariantId ? ne(productVariants.id, keepVariantId) : undefined,
    ))
    .limit(1);
  return clashes.length > 0 ? deterministicSku(shopDomain, shopifyProductId, rawSku, index) : rawSku;
}

type ProductLink = typeof shopifyProductLinks.$inferSelect;

/**
 * Size/Color option axes (in Shopify's option order) for the Variants & stock
 * editor. Only written when every Shopify option is a plain Size or Color —
 * the variant columns hold exactly those; anything else stays as variant
 * labels, which the editor already shows without axes.
 */
export function sizeColorAxes(product: ShopifyProduct, variants: Array<{ size?: string; color?: string }>): Array<{ name: string; values: string[] }> | null {
  const names = (product.options ?? []).map((o) => String(o.name ?? "").trim());
  if (names.length === 0 || names.length > 2) return null;
  const axes = names.map((name) => {
    const key = name.toLowerCase();
    if (key === "size") return { name: "Size", field: "size" as const };
    if (key === "color" || key === "colour") return { name: "Color", field: "color" as const };
    return null;
  });
  if (axes.some((a) => a === null)) return null;
  return axes.map((axis) => ({
    name: axis!.name,
    values: [...new Set(variants.map((v) => v[axis!.field]).filter((v): v is string => Boolean(v)))],
  })).filter((axis) => axis.values.length > 0);
}

async function writeOptionAxes(productId: string, axes: Array<{ name: string; values: string[] }> | null): Promise<void> {
  if (!axes) return;
  await db.transaction(async (tx) => {
    await tx.delete(productOptionAxes).where(eq(productOptionAxes.productId, productId));
    if (axes.length) {
      await tx.insert(productOptionAxes).values(axes.map((axis, position) => ({ productId, name: axis.name, position, values: axis.values })));
    }
  });
}

export type UpsertResult = {
  outcome: "imported" | "updated";
  heldTerms?: string[];
  imagesStored: number;
  imagesLinked: number;
};

/**
 * Creates or updates one Brandthread product (and its variants) from a
 * Shopify product. `link` is the existing shopifyProductLinks row, if any.
 * Throws with a seller-readable message when the product can't be imported.
 */
export async function upsertShopifyProduct(params: {
  ownerId: string;
  shopDomain: string;
  product: ShopifyProduct;
  publishStatus: "draft" | "active";
  productLimit: number | null;
  link?: ProductLink;
  imageStore?: ImageStore;
}): Promise<UpsertResult> {
  const { ownerId, shopDomain, product, link: existingLink } = params;
  const shopifyProductId = String(product.id);
  const normalized = toBrandthreadProduct(product);
  const integrityHits = await checkListingIntegrity(ownerId, normalized);
  const mirrored = await mirrorShopifyImages({
    ownerId,
    urls: normalized.images,
    existingMap: existingLink?.imageMap ?? {},
    store: params.imageStore,
  });
  const result: UpsertResult = {
    outcome: existingLink ? "updated" : "imported",
    ...(integrityHits ? { heldTerms: integrityHits.map((h) => h.term) } : {}),
    imagesStored: mirrored.stored,
    imagesLinked: mirrored.linked,
  };

  if (existingLink) {
    // ── Update in place ────────────────────────────────────────────────
    // Re-import can restock or reprice a product buyers saved.
    const alertBefore = await snapshotProduct(existingLink.brandthreadProductId);
    await db.update(products).set({
      name: normalized.name,
      description: normalized.description,
      category: normalized.category,
      images: mirrored.images,
      tags: normalized.tags,
      // A re-import that brings in blocked words takes the listing down to a draft.
      ...(integrityHits ? { status: "draft" } : {}),
      updatedAt: new Date(),
    }).where(eq(products.id, existingLink.brandthreadProductId));

    const variantMap = { ...existingLink.variantMap };
    const btVariantIdByShopifyVariantId = new Map(
      Object.entries(variantMap).map(([btId, shopifyId]) => [shopifyId, btId]),
    );
    for (let i = 0; i < normalized.variants.length; i += 1) {
      const v = normalized.variants[i];
      const shopifyVariantId = String(product.variants?.[i]?.id ?? "");
      const existingBtVariantId = btVariantIdByShopifyVariantId.get(shopifyVariantId);
      if (existingBtVariantId) {
        const sku = await resolveSku(ownerId, shopDomain, shopifyProductId, v.sku, i, existingBtVariantId);
        await db.update(productVariants).set({
          size: v.size ?? null,
          color: v.color ?? null,
          sku,
          priceCents: v.priceCents,
          stock: v.stock,
          updatedAt: new Date(),
        }).where(eq(productVariants.id, existingBtVariantId));
      } else {
        const sku = await resolveSku(ownerId, shopDomain, shopifyProductId, v.sku, i);
        const [created] = await db.insert(productVariants).values({
          productId: existingLink.brandthreadProductId,
          size: v.size ?? null,
          color: v.color ?? null,
          sku,
          priceCents: v.priceCents,
          stock: v.stock,
          lowStockThreshold: v.lowStockThreshold,
        }).returning({ id: productVariants.id });
        variantMap[created.id] = shopifyVariantId;
      }
    }
    await writeOptionAxes(existingLink.brandthreadProductId, sizeColorAxes(product, normalized.variants));
    await db.update(shopifyProductLinks).set({ variantMap, imageMap: mirrored.imageMap, lastImportedAt: new Date() })
      .where(eq(shopifyProductLinks.id, existingLink.id));
    onProductStockPriceChanged(
      existingLink.brandthreadProductId, alertBefore, await snapshotProduct(existingLink.brandthreadProductId),
    );
    return result;
  }

  // ── Create new ──────────────────────────────────────────────────────
  // Counts toward the plan's product cap exactly like manual creation.
  const createdProduct = await db.transaction(async (tx) => {
    const remaining = await remainingProductCapacity(tx, ownerId, params.productLimit);
    if (remaining !== null && remaining <= 0) {
      throw new Error(`Your plan allows ${params.productLimit} products. Upgrade to import more.`);
    }
    const [row] = await tx.insert(products).values({
      ownerId,
      name: normalized.name,
      description: normalized.description,
      category: normalized.category,
      status: integrityHits ? "draft" : params.publishStatus,
      images: mirrored.images,
      tags: normalized.tags,
    }).returning({ id: products.id });
    return row;
  });

  const variantMap: Record<string, string> = {};
  for (let i = 0; i < normalized.variants.length; i += 1) {
    const v = normalized.variants[i];
    const shopifyVariantId = String(product.variants?.[i]?.id ?? "");
    const sku = await resolveSku(ownerId, shopDomain, shopifyProductId, v.sku, i);
    const [createdVariant] = await db.insert(productVariants).values({
      productId: createdProduct.id,
      size: v.size ?? null,
      color: v.color ?? null,
      sku,
      priceCents: v.priceCents,
      stock: v.stock,
      lowStockThreshold: v.lowStockThreshold,
    }).returning({ id: productVariants.id });
    variantMap[createdVariant.id] = shopifyVariantId;
  }

  await writeOptionAxes(createdProduct.id, sizeColorAxes(product, normalized.variants));
  await db.insert(shopifyProductLinks).values({
    ownerId,
    shopifyProductId,
    brandthreadProductId: createdProduct.id,
    variantMap,
    imageMap: mirrored.imageMap,
  });
  return result;
}

export async function importShopifyProducts(params: {
  ownerId: string;
  shopDomain: string;
  accessToken: string;
  shopifyProductIds: string[];
  publishStatus: "draft" | "active";
}): Promise<ImportSummary> {
  const client = new ShopifyAdminClient(params.shopDomain, params.accessToken);
  const summary: ImportSummary = { imported: 0, updated: 0, skipped: [] };
  const productLimit = (await getVerifiedPlanAccess(params.ownerId)).limits.products;

  const existingLinks = await db.select().from(shopifyProductLinks)
    .where(and(eq(shopifyProductLinks.ownerId, params.ownerId), inArray(shopifyProductLinks.shopifyProductId, params.shopifyProductIds)));
  const linkByShopifyId = new Map(existingLinks.map((link) => [link.shopifyProductId, link]));

  for (const shopifyProductId of params.shopifyProductIds) {
    try {
      const { product } = await client.getProduct(shopifyProductId);
      const result = await upsertShopifyProduct({
        ownerId: params.ownerId,
        shopDomain: params.shopDomain,
        product,
        publishStatus: params.publishStatus,
        productLimit,
        link: linkByShopifyId.get(shopifyProductId),
      });
      if (result.heldTerms) (summary.held ??= []).push({ shopifyProductId, terms: result.heldTerms });
      summary[result.outcome] += 1;
    } catch (err) {
      summary.skipped.push({
        shopifyProductId,
        reason: err instanceof Error ? err.message : "Unknown import error",
      });
    }
  }

  return summary;
}
