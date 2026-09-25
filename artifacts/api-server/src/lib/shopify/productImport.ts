/**
 * Product transfer (A): imports selected Shopify products into Brandthread,
 * updating in place (never duplicating) on re-import via `shopifyProductLinks`.
 * This never touches orders — it is entirely separate from fulfillment (B).
 */
import { and, eq, inArray, ne } from "drizzle-orm";
import { db, products, productVariants, shopifyProductLinks } from "@workspace/db";
import { ShopifyAdminClient } from "./adminClient";
import { toBrandthreadProduct, deterministicSku } from "../shopifyImport";

export type ImportSummary = {
  imported: number;
  updated: number;
  skipped: Array<{ shopifyProductId: string; reason: string }>;
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

export async function importShopifyProducts(params: {
  ownerId: string;
  shopDomain: string;
  accessToken: string;
  shopifyProductIds: string[];
  publishStatus: "draft" | "active";
}): Promise<ImportSummary> {
  const client = new ShopifyAdminClient(params.shopDomain, params.accessToken);
  const summary: ImportSummary = { imported: 0, updated: 0, skipped: [] };

  const existingLinks = await db.select().from(shopifyProductLinks)
    .where(and(eq(shopifyProductLinks.ownerId, params.ownerId), inArray(shopifyProductLinks.shopifyProductId, params.shopifyProductIds)));
  const linkByShopifyId = new Map(existingLinks.map((link) => [link.shopifyProductId, link]));

  for (const shopifyProductId of params.shopifyProductIds) {
    try {
      const { product } = await client.getProduct(shopifyProductId);
      const normalized = toBrandthreadProduct(product);
      const existingLink = linkByShopifyId.get(shopifyProductId);

      if (existingLink) {
        // ── Update in place ────────────────────────────────────────────────
        await db.update(products).set({
          name: normalized.name,
          description: normalized.description,
          category: normalized.category,
          images: normalized.images,
          tags: normalized.tags,
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
            const sku = await resolveSku(params.ownerId, params.shopDomain, shopifyProductId, v.sku, i, existingBtVariantId);
            await db.update(productVariants).set({
              size: v.size ?? null,
              color: v.color ?? null,
              sku,
              priceCents: v.priceCents,
              stock: v.stock,
              updatedAt: new Date(),
            }).where(eq(productVariants.id, existingBtVariantId));
          } else {
            const sku = await resolveSku(params.ownerId, params.shopDomain, shopifyProductId, v.sku, i);
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
        await db.update(shopifyProductLinks).set({ variantMap, lastImportedAt: new Date() })
          .where(eq(shopifyProductLinks.id, existingLink.id));
        summary.updated += 1;
        continue;
      }

      // ── Create new ──────────────────────────────────────────────────────
      const [createdProduct] = await db.insert(products).values({
        ownerId: params.ownerId,
        name: normalized.name,
        description: normalized.description,
        category: normalized.category,
        status: params.publishStatus,
        images: normalized.images,
        tags: normalized.tags,
      }).returning({ id: products.id });

      const variantMap: Record<string, string> = {};
      for (let i = 0; i < normalized.variants.length; i += 1) {
        const v = normalized.variants[i];
        const shopifyVariantId = String(product.variants?.[i]?.id ?? "");
        const sku = await resolveSku(params.ownerId, params.shopDomain, shopifyProductId, v.sku, i);
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

      await db.insert(shopifyProductLinks).values({
        ownerId: params.ownerId,
        shopifyProductId,
        brandthreadProductId: createdProduct.id,
        variantMap,
      });
      summary.imported += 1;
    } catch (err) {
      summary.skipped.push({
        shopifyProductId,
        reason: err instanceof Error ? err.message : "Unknown import error",
      });
    }
  }

  return summary;
}
