/**
 * Read-side decoration for product mentions + post labels.
 *
 * `attachPostExtras` adds `productMentions` and `labels` to a page of already
 * built post payloads using a fixed number of queries per page (never per post):
 *   1. mentions joined to their products (only active, non-deleted products)
 *   2. post labels
 *   3. min variant price for the mentioned products
 * Same shape as `attachQuoteData` so call sites just chain it.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, postLabels, postProductMentions, productVariants, products } from "@workspace/db";

export type ProductMention = {
  productId: string;
  label: string;
  position: number;
  name: string;
  images: string[];
  priceCents: number;
};
export type PostExtras = { productMentions: ProductMention[]; labels: string[] };

export async function attachPostExtras<T extends { id: string }>(items: T[]): Promise<Array<T & PostExtras>> {
  if (items.length === 0) return [];
  const ids = [...new Set(items.map((item) => item.id))];
  const [mentionRows, labelRows] = await Promise.all([
    db.select({
      postId: postProductMentions.postId,
      productId: postProductMentions.productId,
      label: postProductMentions.label,
      position: postProductMentions.position,
      name: products.name,
      images: products.images,
    })
      .from(postProductMentions)
      .innerJoin(products, eq(products.id, postProductMentions.productId))
      .where(and(
        inArray(postProductMentions.postId, ids),
        eq(products.status, "active"),
        isNull(products.deletedAt),
      ))
      .orderBy(postProductMentions.position),
    db.select({ postId: postLabels.postId, label: postLabels.label })
      .from(postLabels)
      .where(inArray(postLabels.postId, ids))
      .orderBy(postLabels.createdAt),
  ]);

  const productIds = [...new Set(mentionRows.map((row) => row.productId))];
  const priceRows = productIds.length === 0 ? [] : await db
    .select({ productId: productVariants.productId, min: sql<number>`min(${productVariants.priceCents})` })
    .from(productVariants)
    .where(inArray(productVariants.productId, productIds))
    .groupBy(productVariants.productId);
  const price = new Map(priceRows.map((row) => [row.productId, Number(row.min)]));

  const mentionsByPost = new Map<string, ProductMention[]>();
  for (const row of mentionRows) {
    const list = mentionsByPost.get(row.postId) ?? [];
    list.push({
      productId: row.productId,
      label: row.label,
      position: row.position,
      name: row.name,
      images: Array.isArray(row.images) ? row.images : [],
      priceCents: price.get(row.productId) ?? 0,
    });
    mentionsByPost.set(row.postId, list);
  }
  const labelsByPost = new Map<string, string[]>();
  for (const row of labelRows) {
    const list = labelsByPost.get(row.postId) ?? [];
    list.push(row.label);
    labelsByPost.set(row.postId, list);
  }
  return items.map((item) => ({
    ...item,
    productMentions: mentionsByPost.get(item.id) ?? [],
    labels: labelsByPost.get(item.id) ?? [],
  }));
}
