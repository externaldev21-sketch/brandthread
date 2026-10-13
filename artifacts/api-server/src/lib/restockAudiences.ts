/**
 * Restock audiences beyond savers and the waitlist, for one variant restock.
 *
 * Bag restock (item 18) — buyers who have the restocked variant in their bag
 *   (cart_items, not saved for later). Transactional, like cart_reminder: the
 *   buyer bagged it. Category "cart" → the cart_reminders preference.
 * Your size is back (item 20) — buyers who saved the product or viewed it in
 *   the last 30 days whose saved size for the product's size category
 *   (buyer_preferences.sizes, see ./sizeMatch) is the restocked variant's
 *   size. Promotional (PROMOTIONAL_PUSH_TYPES). Category "stock" →
 *   price_alerts ("Price & stock alerts").
 *
 * Never: the seller themself, anyone with a block either way with the seller,
 * anyone on this product's waitlist (notifyWaitlistRestock reaches them), and
 * — for size-back — anyone in this restock's bag audience. Only for a live
 * product from a seller in good standing.
 *
 * Dedupe + cooldown: restock_push_log, one row per (user, variant, kind). A
 * send is claimed with INSERT ... ON CONFLICT DO UPDATE SET sent_at = now()
 * WHERE sent_at < now() - 7 days RETURNING, so a flapping variant can't spam
 * and concurrent restock writers can't double-send.
 *
 * Called fire-and-forget as the first statement of notifyBackInStock (lib/
 * stockNotifications.ts); the fan-out runs in chunks of FANOUT_CHUNK and never
 * holds the seller's request.
 */
import { and, eq, gt, gte, inArray, sql } from "drizzle-orm";
import {
  buyerPreferences, cartItems, db, productVariants, products, recentlyViewedProducts,
  restockPushLog, savedItems, users, waitlistEntries,
} from "@workspace/db";
import { productThumbnail } from "./activityEvents";
import { logger } from "./logger";
import { blockedUserIds } from "./safety";
import { productSizeCategory, savedSizeMatchesVariant } from "./sizeMatch";
import type { StoredSizes } from "./buyerPreferences";
import { isRestock } from "./stockNotifications";
import { publishNotification } from "../routes/notifications-feed";

export const RESTOCK_PUSH_COOLDOWN_DAYS = 7;
export const SIZE_BACK_VIEW_WINDOW_DAYS = 30;
export const FANOUT_CHUNK = 100;

export type RestockPushKind = "bag_restock" | "size_back";

export interface RestockAudienceInput {
  productId: string;
  ownerId: string;
  productName: string;
  previousStock: number;
  newStock: number;
  variantId?: string;
}

export interface RestockAudienceResult {
  bag: string[];
  sizeBack: string[];
}

/** "Hoodie, size M, from your bag is available again." — the size clause is dropped when there is none. */
export function bagRestockBody(productName: string, size: string | null | undefined): string {
  const s = size?.trim();
  return s ? `${productName}, size ${s}, from your bag is available again.` : `${productName} from your bag is available again.`;
}

/** "Hoodie is back in M." */
export function sizeBackBody(productName: string, size: string): string {
  return `${productName} is back in ${size.trim()}.`;
}

function chunks<T>(items: T[], size = FANOUT_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Atomically claims (user, variant, kind) sends outside the cooldown and
 * returns the pairs this caller won. Pairs must be distinct.
 */
export async function claimRestockPushes(
  kind: RestockPushKind,
  pairs: Array<{ userId: string; variantId: string }>,
): Promise<Array<{ userId: string; variantId: string }>> {
  if (pairs.length === 0) return [];
  return db
    .insert(restockPushLog)
    .values(pairs.map((p) => ({ userId: p.userId, variantId: p.variantId, kind })))
    .onConflictDoUpdate({
      target: [restockPushLog.userId, restockPushLog.variantId, restockPushLog.kind],
      set: { sentAt: sql`now()` },
      setWhere: sql`${restockPushLog.sentAt} < now() - make_interval(days => ${RESTOCK_PUSH_COOLDOWN_DAYS})`,
    })
    .returning({ userId: restockPushLog.userId, variantId: restockPushLog.variantId });
}

interface LiveProduct {
  name: string;
  category: string;
  image: string | null;
}

async function liveProduct(productId: string): Promise<LiveProduct | null> {
  const [row] = await db
    .select({
      name: products.name, category: products.category, status: products.status,
      deletedAt: products.deletedAt, images: products.images,
      sellerSuspendedAt: users.suspendedAt, sellerDeletedAt: users.deletedAt,
    })
    .from(products)
    .leftJoin(users, eq(users.clerkId, products.ownerId))
    .where(eq(products.id, productId))
    .limit(1);
  if (!row || row.status !== "active" || row.deletedAt || row.sellerSuspendedAt || row.sellerDeletedAt) return null;
  return { name: row.name, category: row.category, image: productThumbnail(row.images) };
}

function dedupePairs(pairs: Array<{ userId: string; variantId: string }>) {
  const seen = new Map<string, { userId: string; variantId: string }>();
  for (const p of pairs) seen.set(`${p.userId}\u0000${p.variantId}`, p);
  return [...seen.values()];
}

/**
 * Bag + size-back pushes for a 0 → N variant restock. Never throws for a
 * single failed send; returns who was pushed (for tests and logging).
 */
export async function notifyRestockAudiences(input: RestockAudienceInput): Promise<RestockAudienceResult> {
  const result: RestockAudienceResult = { bag: [], sizeBack: [] };
  if (!isRestock(input)) return result;

  const product = await liveProduct(input.productId);
  if (!product) return result;
  const productName = input.productName || product.name;

  const variants = await db
    .select({ id: productVariants.id, size: productVariants.size })
    .from(productVariants)
    .where(and(
      eq(productVariants.productId, input.productId),
      gt(productVariants.stock, 0),
      ...(input.variantId ? [eq(productVariants.id, input.variantId)] : []),
    ));
  if (variants.length === 0) return result;
  const variantById = new Map(variants.map((v) => [v.id, v]));
  const variantIds = variants.map((v) => v.id);

  const waitlisted = await db
    .selectDistinct({ userId: waitlistEntries.userId })
    .from(waitlistEntries)
    .where(eq(waitlistEntries.productId, input.productId));
  const excluded = new Set<string>([
    input.ownerId,
    ...waitlisted.map((w) => w.userId),
    ...(await blockedUserIds(input.ownerId)),
  ]);

  // ── Bag restock ────────────────────────────────────────────────────────────
  const bagRows = await db
    .selectDistinct({ userId: cartItems.userId, variantId: cartItems.variantId })
    .from(cartItems)
    .where(and(inArray(cartItems.variantId, variantIds), eq(cartItems.savedForLater, false)));
  const bagAudience = new Set(bagRows.map((r) => r.userId));
  const bagPairs = dedupePairs(bagRows.filter((r) => !excluded.has(r.userId)));
  const bagSent = new Set<string>();
  for (const chunk of chunks(bagPairs)) {
    const won = await claimRestockPushes("bag_restock", chunk);
    await Promise.all(won.map((p) =>
      publishNotification({
        userId: p.userId,
        category: "cart",
        type: "bag_restock",
        title: "Back in stock",
        body: bagRestockBody(productName, variantById.get(p.variantId)?.size),
        targetId: input.productId,
        targetType: "product",
        targetImageUrl: product.image,
        cta: "Shop now",
        analyticsOwnerId: input.ownerId,
        pushChannelId: "stock",
      })
        .then(() => { bagSent.add(p.userId); })
        .catch((err) => logger.warn({ err, userId: p.userId, productId: input.productId }, "Bag restock notification failed"))
    ));
  }
  result.bag = [...bagSent];

  // ── Your size is back ──────────────────────────────────────────────────────
  const category = productSizeCategory({ category: product.category, name: product.name });
  const sized = variants.filter((v) => v.size && v.size.trim());
  if (!category || sized.length === 0) return result;

  const since = new Date(Date.now() - SIZE_BACK_VIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [savers, viewers] = await Promise.all([
    db.selectDistinct({ userId: savedItems.userId }).from(savedItems)
      .where(and(eq(savedItems.itemType, "product"), eq(savedItems.targetId, input.productId))),
    db.selectDistinct({ userId: recentlyViewedProducts.userId }).from(recentlyViewedProducts)
      .where(and(eq(recentlyViewedProducts.productId, input.productId), gte(recentlyViewedProducts.viewedAt, since))),
  ]);
  const candidates = [...new Set([...savers, ...viewers].map((r) => r.userId))]
    .filter((userId) => !excluded.has(userId) && !bagAudience.has(userId));

  const sizeSent = new Set<string>();
  for (const chunk of chunks(candidates)) {
    const prefs = await db
      .select({ userId: buyerPreferences.userId, sizes: buyerPreferences.sizes })
      .from(buyerPreferences)
      .where(inArray(buyerPreferences.userId, chunk));
    const pairs: Array<{ userId: string; variantId: string }> = [];
    for (const pref of prefs) {
      for (const v of sized) {
        if (savedSizeMatchesVariant(pref.sizes as StoredSizes, category, v.size)) pairs.push({ userId: pref.userId, variantId: v.id });
      }
    }
    const won = await claimRestockPushes("size_back", dedupePairs(pairs));
    // One push per buyer per event even when two variants share their size (M / Black, M / White).
    const perUser = new Map<string, string>();
    for (const p of won) if (!perUser.has(p.userId)) perUser.set(p.userId, p.variantId);
    await Promise.all([...perUser].map(([userId, variantId]) =>
      publishNotification({
        userId,
        category: "stock",
        type: "size_back",
        title: "Your size is back",
        body: sizeBackBody(productName, variantById.get(variantId)?.size ?? ""),
        targetId: input.productId,
        targetType: "product",
        targetImageUrl: product.image,
        cta: "Shop now",
        analyticsOwnerId: input.ownerId,
        pushChannelId: "stock",
      })
        .then(() => { sizeSent.add(userId); })
        .catch((err) => logger.warn({ err, userId, productId: input.productId }, "Size-back notification failed"))
    ));
  }
  result.sizeBack = [...sizeSent];
  return result;
}
