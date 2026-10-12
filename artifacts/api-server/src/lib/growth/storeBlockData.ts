/**
 * Store blocks with what the card and checkout need from the catalog: price,
 * stock, variants and the pre-order's ship date. Price, stock and pre-order
 * terms live on the product, so checkout charges exactly what the card shows.
 *
 * A seller who has never opened My Store has no block rows; their store shows
 * their active products (featured first) as pre-made / pre-order cards, and
 * the first visit to My Store saves that same list as blocks (seedStoreBlocks).
 */
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db, drops, products, productVariants, storeBlocks } from "@workspace/db";
import { MAX_STORE_SITE_PRODUCTS } from "./storeSiteDesign";
import { effectiveCompareAt, type BlockKind, type BlockStyle } from "./storeBlocks";

export type StoreBlockRecord = {
  /** Block id, or null for a store that hasn't saved its blocks yet. */
  id: string | null;
  productId: string;
  kind: BlockKind;
  style: BlockStyle;
  position: number;
  visible: boolean;
  status: "draft" | "published";
  title: string;
  subtitle: string;
  buttonText: string;
  /** Image refs as stored (https or /objects/); sign before rendering. */
  thumbImage: string | null;
  checkoutImage: string | null;
  description: string;
  shipBy: Date | null;
  preorderCap: number | null;
  product: {
    name: string;
    status: string;
    description: string;
    images: string[];
    dropId: string | null;
    moderationLocked: boolean;
  };
  priceCents: number | null;
  compareAtPriceCents: number | null;
  /** Units left across variants. */
  stock: number;
  variants: { id: string; label: string; priceCents: number; stock: number }[];
  /** A pre-order whose drop is taking orders (always true for pre-made). */
  open: boolean;
};

type ProductRow = {
  id: string;
  name: string;
  status: string;
  description: string | null;
  images: unknown;
  isPreOrder: boolean;
  preOrderEstShipDate: Date | null;
  dropId: string | null;
  removalKind: string | null;
};

const imagesOf = (raw: unknown): string[] => (Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string" && !!x) : []);

async function catalogDetails(productIds: string[], now: Date) {
  const variants = new Map<string, StoreBlockRecord["variants"]>();
  const compare = new Map<string, number | null>();
  const dropOpen = new Map<string, { open: boolean; shipBy: Date | null; preorder: boolean }>();
  if (!productIds.length) return { variants, compare, dropOpen };
  const [variantRows, dropRows] = await Promise.all([
    db.select({
      id: productVariants.id, productId: productVariants.productId, size: productVariants.size, color: productVariants.color,
      priceCents: productVariants.priceCents, compareAt: productVariants.compareAtPriceCents, stock: productVariants.stock,
    }).from(productVariants).where(inArray(productVariants.productId, productIds)).orderBy(asc(productVariants.createdAt), asc(productVariants.id)),
    db.select({
      productId: products.id, type: drops.type, status: drops.status, escrowState: drops.escrowState,
      deadline: drops.fulfillmentDeadlineAt, shipDate: drops.estimatedShipDate,
    }).from(products).innerJoin(drops, eq(drops.id, products.dropId)).where(inArray(products.id, productIds)),
  ]);
  const cheapest = new Map<string, { price: number; compareAt: number | null }>();
  for (const v of variantRows) {
    const list = variants.get(v.productId) ?? [];
    list.push({ id: v.id, label: [v.size, v.color].filter(Boolean).join(" / "), priceCents: v.priceCents, stock: Math.max(0, v.stock) });
    variants.set(v.productId, list);
    const c = cheapest.get(v.productId);
    if (!c || v.priceCents < c.price) cheapest.set(v.productId, { price: v.priceCents, compareAt: v.compareAt });
  }
  for (const [id, c] of cheapest) compare.set(id, effectiveCompareAt(c.price, c.compareAt));
  for (const d of dropRows) {
    const preorder = d.type === "pre-order";
    dropOpen.set(d.productId, {
      preorder,
      shipBy: d.shipDate,
      open: d.status === "active" && (!preorder || (d.escrowState === "collecting" && !!d.deadline && d.deadline > now)),
    });
  }
  return { variants, compare, dropOpen };
}

function record(
  block: Omit<StoreBlockRecord, "product" | "priceCents" | "compareAtPriceCents" | "stock" | "variants" | "open">,
  p: ProductRow,
  details: Awaited<ReturnType<typeof catalogDetails>>,
): StoreBlockRecord {
  const variants = details.variants.get(p.id) ?? [];
  const price = variants.length ? Math.min(...variants.map((v) => v.priceCents)) : null;
  const drop = details.dropOpen.get(p.id);
  return {
    ...block,
    shipBy: block.shipBy ?? (block.kind === "preorder" ? drop?.shipBy ?? p.preOrderEstShipDate : null),
    product: {
      name: p.name, status: p.status, description: (p.description ?? "").trim(), images: imagesOf(p.images),
      dropId: p.dropId, moderationLocked: !!p.removalKind?.startsWith("moderation_"),
    },
    priceCents: price,
    compareAtPriceCents: details.compare.get(p.id) ?? null,
    stock: variants.reduce((n, v) => n + v.stock, 0),
    variants,
    open: drop ? drop.open : block.kind === "premade",
  };
}

const productColumns = {
  id: products.id, name: products.name, status: products.status, description: products.description, images: products.images,
  isPreOrder: products.isPreOrder, preOrderEstShipDate: products.preOrderEstShipDate, dropId: products.dropId, removalKind: products.removalKind,
};

/** Pre-order when the product belongs to a pre-order drop or is marked as one. */
export async function kindOfProduct(p: { isPreOrder: boolean; dropId: string | null }): Promise<BlockKind> {
  if (p.isPreOrder) return "preorder";
  if (!p.dropId) return "premade";
  const [d] = await db.select({ type: drops.type }).from(drops).where(eq(drops.id, p.dropId)).limit(1);
  return d?.type === "pre-order" ? "preorder" : "premade";
}

/** The seller's saved blocks, in order (removed ones and deleted products left out). */
export async function loadStoreBlocks(sellerId: string, now = new Date()): Promise<StoreBlockRecord[]> {
  const rows = await db.select({ b: storeBlocks, p: productColumns })
    .from(storeBlocks)
    .innerJoin(products, eq(products.id, storeBlocks.productId))
    .where(and(eq(storeBlocks.sellerId, sellerId), ne(storeBlocks.status, "removed"), eq(products.ownerId, sellerId), isNull(products.deletedAt)))
    .orderBy(asc(storeBlocks.position), asc(storeBlocks.createdAt));
  const details = await catalogDetails(rows.map((r) => r.p.id), now);
  return rows.map(({ b, p }) => record({
    id: b.id, productId: b.productId, kind: b.kind === "preorder" ? "preorder" : "premade",
    style: b.style === "button" ? "button" : "callout", position: b.position, visible: b.visible,
    status: b.status === "published" ? "published" : "draft",
    title: b.title, subtitle: b.subtitle, buttonText: b.buttonText, thumbImage: b.thumbImage, checkoutImage: b.checkoutImage,
    description: b.description, shipBy: b.shipBy, preorderCap: b.preorderCap,
  }, p, details));
}

/** True once the seller has any block row (removed ones included). */
export async function hasSavedBlocks(sellerId: string): Promise<boolean> {
  const [row] = await db.select({ id: storeBlocks.id }).from(storeBlocks).where(eq(storeBlocks.sellerId, sellerId)).limit(1);
  return !!row;
}

/** Blocks for a store that hasn't saved any: active products, featured first, then newest. */
export async function derivedStoreBlocks(sellerId: string, featuredIds: string[], now = new Date()): Promise<StoreBlockRecord[]> {
  const rows = await db.select(productColumns).from(products)
    .where(and(eq(products.ownerId, sellerId), eq(products.status, "active"), isNull(products.deletedAt)))
    .orderBy(desc(products.createdAt)).limit(200);
  const rank = new Map(featuredIds.map((id, i) => [id.toLowerCase(), i]));
  const ordered = [...rows].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity)).slice(0, MAX_STORE_SITE_PRODUCTS);
  const details = await catalogDetails(ordered.map((r) => r.id), now);
  return ordered.map((p, i) => {
    const preorder = p.isPreOrder || !!details.dropOpen.get(p.id)?.preorder;
    return record({
      id: null, productId: p.id, kind: preorder ? "preorder" : "premade", style: "callout", position: i, visible: true, status: "published",
      title: p.name, subtitle: "", buttonText: "", thumbImage: null, checkoutImage: null, description: "", shipBy: null, preorderCap: null,
    }, p, details);
  });
}

/** Blocks the public store shows, in order. */
export async function publicStoreBlocks(sellerId: string, featuredIds: string[], now = new Date()): Promise<StoreBlockRecord[]> {
  const saved = await hasSavedBlocks(sellerId);
  const list = saved ? await loadStoreBlocks(sellerId, now) : await derivedStoreBlocks(sellerId, featuredIds, now);
  return list.filter((b) => b.status === "published" && b.visible && b.product.status === "active" && !b.product.moderationLocked)
    .slice(0, MAX_STORE_SITE_PRODUCTS);
}

/**
 * First visit to My Store: save the derived list as blocks so the seller
 * edits what their store already shows. A no-op once any row exists; the
 * unique (seller, product) index keeps two concurrent first visits safe.
 */
export async function seedStoreBlocks(sellerId: string, featuredIds: string[]): Promise<void> {
  if (await hasSavedBlocks(sellerId)) return;
  const derived = await derivedStoreBlocks(sellerId, featuredIds);
  if (!derived.length) return;
  await db.insert(storeBlocks).values(derived.map((b, i) => ({
    sellerId, productId: b.productId, kind: b.kind, position: i, status: "published", style: "callout",
    title: b.title.slice(0, 80),
  }))).onConflictDoNothing();
}

/** Position for a block added at the bottom of the store. */
export async function nextBlockPosition(sellerId: string): Promise<number> {
  const [row] = await db.select({ max: sql<number | null>`max(${storeBlocks.position})::int` }).from(storeBlocks).where(eq(storeBlocks.sellerId, sellerId));
  return (row?.max ?? -1) + 1;
}
