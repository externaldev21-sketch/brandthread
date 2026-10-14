/**
 * Monthly Wrapped: a buyer's recap of one calendar month (UTC) — pieces
 * bought, top brands, the piece they posted most, and "top X% of <brand>
 * supporters" only when that is true and meaningful. Everything is computed
 * from real orders and posts at read time; nothing is stored.
 */
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, notInArray, sql } from "drizzle-orm";
import { db, orderItems, orders, postTaggedProducts, posts, productVariants, products, users } from "@workspace/db";
import { NON_CLOSET_ORDER_STATUSES } from "./closet/pieces";

/** A supporter rank is shown only for a brand with at least this many buyers… */
export const SUPPORTER_MIN_BUYERS = 20;
/** …and only when the buyer is inside this top share. */
export const SUPPORTER_MAX_PERCENT = 25;

export interface WrappedBrand { sellerId: string; name: string; pieces: number; imageUrl: string | null }
export interface WrappedPiece { productId: string; name: string; brand: string | null; imageUrl: string | null; posts: number }
export interface Wrapped {
  month: string;
  available: boolean;
  totalPieces: number;
  /** Distinct brands bought from this month. */
  brandCount: number;
  topBrands: WrappedBrand[];
  mostPosted: WrappedPiece | null;
  supporter: { brand: string; topPercent: number } | null;
  /** A real product photo for the share card (top brand's piece). */
  coverImageUrl: string | null;
}

export function isMonthKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function monthRange(month: string): { start: Date; end: Date } {
  const [y, m] = month.split("-").map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}

/** The month a recap published on `now` covers: the previous calendar month (UTC). */
export function previousMonth(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * "Top X%" for rank `rank` (1 = biggest supporter) among `total` buyers, or
 * null when it would be meaningless (too few buyers) or unflattering-but-true
 * filler (outside the top quarter).
 */
export function supporterTopPercent(rank: number, total: number): number | null {
  if (!Number.isInteger(rank) || !Number.isInteger(total) || total < SUPPORTER_MIN_BUYERS || rank < 1 || rank > total) return null;
  const pct = Math.max(1, Math.ceil((rank / total) * 100));
  return pct <= SUPPORTER_MAX_PERCENT ? pct : null;
}

function firstImage(images: unknown): string | null {
  if (!Array.isArray(images)) return null;
  return images.find((v): v is string => typeof v === "string" && v.length > 0) ?? null;
}

export interface WrappedItemRow {
  sellerId: string; brandName: string | null; displayName: string | null;
  quantity: number; priceCents: number; images: unknown;
}

/** Pure: top brands by pieces, then spend, then name. */
export function rankBrands(rows: WrappedItemRow[], limit = 3): WrappedBrand[] {
  const by = new Map<string, WrappedBrand & { spend: number }>();
  for (const row of rows) {
    const cur = by.get(row.sellerId) ?? {
      sellerId: row.sellerId, name: row.brandName ?? row.displayName ?? "A brand", pieces: 0, spend: 0, imageUrl: null,
    };
    cur.pieces += row.quantity;
    cur.spend += row.quantity * row.priceCents;
    cur.imageUrl = cur.imageUrl ?? firstImage(row.images);
    by.set(row.sellerId, cur);
  }
  return [...by.values()]
    .sort((a, b) => b.pieces - a.pieces || b.spend - a.spend || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(({ spend: _spend, ...brand }) => brand);
}

async function supporterRank(buyerId: string, sellerId: string): Promise<{ rank: number; total: number } | null> {
  const spend = sql<number>`sum(${orders.totalCents} - ${orders.refundedCents})`;
  const rows = await db.select({ buyerId: orders.buyerId, spend })
    .from(orders)
    .where(and(
      eq(orders.ownerId, sellerId), isNotNull(orders.buyerId), isNotNull(orders.paidAt),
      notInArray(orders.status, [...NON_CLOSET_ORDER_STATUSES]),
    ))
    .groupBy(orders.buyerId);
  const mine = rows.find((r) => r.buyerId === buyerId);
  if (!mine) return null;
  const mySpend = Number(mine.spend);
  // Ties count against the buyer: rank = everyone who spent at least as much,
  // so "top X%" is only ever said when it is true for this buyer alone.
  const rank = rows.filter((r) => Number(r.spend) >= mySpend).length;
  return { rank, total: rows.length };
}

export async function buildWrapped(buyerId: string, month: string): Promise<Wrapped> {
  const { start, end } = monthRange(month);
  const items: WrappedItemRow[] = await db.select({
    sellerId: orders.ownerId,
    brandName: users.brandName,
    displayName: users.displayName,
    quantity: orderItems.quantity,
    priceCents: orderItems.priceCents,
    images: products.images,
  })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .leftJoin(productVariants, eq(productVariants.id, orderItems.variantId))
    .leftJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(users, eq(users.clerkId, orders.ownerId))
    .where(and(
      eq(orders.buyerId, buyerId),
      gte(orders.paidAt, start), lt(orders.paidAt, end),
      notInArray(orders.status, [...NON_CLOSET_ORDER_STATUSES]),
      isNull(orderItems.refundedAt),
    ));

  const totalPieces = items.reduce((sum, row) => sum + row.quantity, 0);
  const empty: Wrapped = { month, available: false, totalPieces: 0, brandCount: 0, topBrands: [], mostPosted: null, supporter: null, coverImageUrl: null };
  if (totalPieces === 0) return empty;

  const topBrands = rankBrands(items);

  // The piece the buyer tagged in the most of their published posts this month.
  const postCount = sql<number>`count(distinct ${posts.id})`;
  const [posted] = await db.select({ productId: postTaggedProducts.productId, count: postCount })
    .from(postTaggedProducts)
    .innerJoin(posts, eq(posts.id, postTaggedProducts.postId))
    .where(and(
      eq(posts.userId, buyerId), eq(posts.postStatus, "published"),
      gte(posts.createdAt, start), lt(posts.createdAt, end),
    ))
    .groupBy(postTaggedProducts.productId)
    .orderBy(desc(postCount), desc(sql`max(${posts.createdAt})`))
    .limit(1);
  let mostPosted: WrappedPiece | null = null;
  if (posted) {
    const [p] = await db.select({ id: products.id, name: products.name, images: products.images, brandName: users.brandName, displayName: users.displayName })
      .from(products).leftJoin(users, eq(users.clerkId, products.ownerId))
      .where(inArray(products.id, [posted.productId])).limit(1);
    if (p) mostPosted = { productId: p.id, name: p.name, brand: p.brandName ?? p.displayName ?? null, imageUrl: firstImage(p.images), posts: Number(posted.count) };
  }

  let supporter: Wrapped["supporter"] = null;
  const top = topBrands[0];
  if (top) {
    const rank = await supporterRank(buyerId, top.sellerId);
    const pct = rank ? supporterTopPercent(rank.rank, rank.total) : null;
    if (pct !== null) supporter = { brand: top.name, topPercent: pct };
  }

  return {
    month, available: true, totalPieces, brandCount: new Set(items.map((i) => i.sellerId)).size, topBrands, mostPosted, supporter,
    coverImageUrl: top?.imageUrl ?? mostPosted?.imageUrl ?? null,
  };
}
