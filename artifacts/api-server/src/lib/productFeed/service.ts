/**
 * Database side of the seller product feed: token lifecycle, the eligible
 * catalog, the cached CSV, and "last fetched" bookkeeping.
 */
import crypto from "node:crypto";
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { db, productFeeds, products, productVariants, users } from "@workspace/db";
import { getCacheStore } from "../cacheStore";
import { applySalesToVariants } from "../pricing/salesRuntime";
import { getWebOrigin } from "../webOrigin";
import { buildFeedItems, feedCsv, type FeedItem, type FeedPlatform } from "./feed";

export const FEED_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const FEED_CACHE_TTL_SECONDS = 600;
const FETCH_STAMP_MIN_MS = 5 * 60_000;

export function newFeedToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function feedUrls(token: string, origin = getWebOrigin()) {
  const base = `${origin}/api/v1/public/feeds/${token}`;
  return { metaUrl: `${base}/meta.csv`, tiktokUrl: `${base}/tiktok.csv` };
}

/** Published, non-deleted products of a seller that is not suspended or deleted. */
export async function loadFeedItems(sellerId: string, origin = getWebOrigin()): Promise<FeedItem[]> {
  const [seller] = await db.select({
    brandName: users.brandName, displayName: users.displayName, name: users.name, username: users.username,
    suspendedAt: users.suspendedAt, deletedAt: users.deletedAt, deletionRequestedAt: users.deletionRequestedAt,
  }).from(users).where(eq(users.clerkId, sellerId)).limit(1);
  if (!seller || seller.suspendedAt || seller.deletedAt || seller.deletionRequestedAt) return [];

  const prods = await db.select({
    id: products.id, ownerId: products.ownerId, name: products.name, description: products.description,
    category: products.category, tags: products.tags, images: products.images, isPreOrder: products.isPreOrder,
  }).from(products)
    .where(and(eq(products.ownerId, sellerId), eq(products.status, "active"), isNull(products.deletedAt)))
    .orderBy(products.createdAt)
    .limit(5000);
  if (prods.length === 0) return [];

  const rawVariants = await db.select({
    id: productVariants.id, productId: productVariants.productId, size: productVariants.size, color: productVariants.color,
    priceCents: productVariants.priceCents, compareAtPriceCents: productVariants.compareAtPriceCents, stock: productVariants.stock,
  }).from(productVariants).where(inArray(productVariants.productId, prods.map((p) => p.id)));
  const variants = await applySalesToVariants(prods, rawVariants);

  return buildFeedItems({
    products: prods,
    variants,
    brand: seller.brandName || seller.displayName || seller.name || seller.username || "",
    origin,
  });
}

const memoryCache = new Map<string, { value: string; expiresAt: number }>();
const MEMORY_CACHE_MAX = 500;

const cacheKey = (sellerId: string, platform: FeedPlatform) => `product-feed:v1:${platform}:${sellerId}`;

/** The feed CSV, from cache when fresh (Redis when configured, else this process). */
export async function getFeedCsv(sellerId: string, platform: FeedPlatform): Promise<string> {
  const key = cacheKey(sellerId, platform);
  const store = getCacheStore();
  if (store) {
    const hit = await store.get(key);
    if (hit != null) return hit;
  } else {
    const hit = memoryCache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
  }
  const csv = feedCsv(platform, await loadFeedItems(sellerId));
  if (store) {
    await store.set(key, csv, FEED_CACHE_TTL_SECONDS);
  } else {
    if (memoryCache.size >= MEMORY_CACHE_MAX) {
      const oldest = memoryCache.keys().next().value;
      if (oldest) memoryCache.delete(oldest);
    }
    memoryCache.set(key, { value: csv, expiresAt: Date.now() + FEED_CACHE_TTL_SECONDS * 1000 });
  }
  return csv;
}

export async function clearFeedCache(sellerId: string): Promise<void> {
  const keys = [cacheKey(sellerId, "meta"), cacheKey(sellerId, "tiktok")];
  keys.forEach((k) => memoryCache.delete(k));
  await getCacheStore()?.del(...keys);
}

export async function findFeedByToken(token: string) {
  if (!FEED_TOKEN_RE.test(token)) return null;
  const [row] = await db.select().from(productFeeds).where(eq(productFeeds.token, token)).limit(1);
  return row ?? null;
}

/** Record that Meta/TikTok fetched the feed; at most one write per 5 minutes. */
export async function stampFetched(sellerId: string, platform: FeedPlatform): Promise<void> {
  const col = platform === "meta" ? productFeeds.metaFetchedAt : productFeeds.tiktokFetchedAt;
  const cutoff = new Date(Date.now() - FETCH_STAMP_MIN_MS);
  await db.update(productFeeds)
    .set(platform === "meta" ? { metaFetchedAt: new Date() } : { tiktokFetchedAt: new Date() })
    .where(and(eq(productFeeds.sellerId, sellerId), or(isNull(col), lt(col, cutoff))));
}

/** Product + row counts the seller screen shows, from the same eligibility rules as the feed. */
export async function feedCounts(sellerId: string): Promise<{ productCount: number; itemCount: number }> {
  const items = await loadFeedItems(sellerId);
  return { productCount: new Set(items.map((i) => i.itemGroupId)).size, itemCount: items.length };
}

export async function getOrCreateFeed(sellerId: string) {
  const [existing] = await db.select().from(productFeeds).where(eq(productFeeds.sellerId, sellerId)).limit(1);
  if (existing) return { row: existing, created: false };
  const [row] = await db.insert(productFeeds).values({ sellerId, token: newFeedToken() })
    .onConflictDoNothing({ target: productFeeds.sellerId }).returning();
  if (row) return { row, created: true };
  const [raced] = await db.select().from(productFeeds).where(eq(productFeeds.sellerId, sellerId)).limit(1);
  return { row: raced, created: false };
}

/** New token; every earlier URL stops working immediately. Fetch history restarts. */
export async function regenerateFeed(sellerId: string) {
  const token = newFeedToken();
  const now = new Date();
  const [row] = await db.insert(productFeeds).values({ sellerId, token, rotatedAt: now })
    .onConflictDoUpdate({
      target: productFeeds.sellerId,
      set: { token, rotatedAt: now, metaFetchedAt: null, tiktokFetchedAt: null },
    }).returning();
  return row;
}

export function serializeFeed(row: typeof productFeeds.$inferSelect | null | undefined) {
  if (!row) return null;
  return {
    ...feedUrls(row.token),
    createdAt: row.createdAt.toISOString(),
    rotatedAt: row.rotatedAt.toISOString(),
    metaFetchedAt: row.metaFetchedAt?.toISOString() ?? null,
    tiktokFetchedAt: row.tiktokFetchedAt?.toISOString() ?? null,
  };
}
