/**
 * Saved-product alerts: "Back in stock" and "Price drop" for buyers who saved
 * (wishlisted) a product. Every stock/price write path funnels in here —
 * directly (product-level edits, Shopify re-import) or through
 * lib/stockNotifications.ts's notifyBackInStock / notifyPriceDrop (inventory
 * quick adjust, variant edit, new variant, order cancel/refund restock).
 *
 * Rules
 * ─────
 * Back in stock — product level. A buyer saves a product, not a size, so the
 *   alert fires when the product as a whole goes from 0 units (every variant
 *   sold out) to any units. A variant restock while another size is still in
 *   stock is not an alert. Each saver gets at most one back-in-stock alert per
 *   BACK_IN_STOCK_COOLDOWN_MS. Variant-level calls arriving together (one
 *   cancelled order restocking two sizes) are coalesced per product for
 *   COALESCE_MS so their deltas are judged as one change.
 * Price drop — against each saver's own reference price: the lower of the
 *   price snapshotted when they saved it and the price they were last alerted
 *   at. The product's new lowest variant price must be at least
 *   PRICE_DROP_MIN_PERCENT lower AND at least PRICE_DROP_MIN_CENTS lower than
 *   that reference; the alert then moves the reference down
 *   (last_notified_price_cents), so repeated small edits never re-alert.
 * Opt-in — per item: notify_on_back_in_stock / notify_on_price_drop off means
 *   nothing at all (no Activity row, no push). Otherwise the Activity row is
 *   always written and the push goes through sendPushToUser, which honours the
 *   buyer's push master switch, quiet hours and the "Price & stock alerts"
 *   (price_alerts) preference.
 * Never — to a buyer who blocked the seller or whom the seller blocked, for a
 *   product that isn't live (draft/archived/deleted), or from a suspended or
 *   deleted seller. The seller never alerts themself.
 *
 * Fan-out runs after the seller's response (fire-and-forget, logged) and in
 * chunks of FANOUT_CHUNK so a product with thousands of savers doesn't hold a
 * request or flood the pool. Tests await it with drainSavedProductAlerts().
 */
import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  blocks, db, notificationsFeed, productSaveAlertRuns, productVariants, products, savedItems, users,
} from "@workspace/db";
import { publishNotification } from "../routes/notifications-feed";
import { logger } from "./logger";

export const PRICE_DROP_MIN_PERCENT = 5;
export const PRICE_DROP_MIN_CENTS = 100;
export const BACK_IN_STOCK_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const COALESCE_MS = 250;
export const FANOUT_CHUNK = 100;

export type SavedProductAlertKind = "back_in_stock" | "price_drop";

/** True when `nextCents` is a big enough drop below `referenceCents` to alert on. */
export function qualifiesForPriceDrop(referenceCents: number | null | undefined, nextCents: number): boolean {
  if (referenceCents == null || !Number.isFinite(referenceCents) || nextCents < 0) return false;
  const drop = referenceCents - nextCents;
  if (drop < PRICE_DROP_MIN_CENTS) return false;
  return drop * 100 >= referenceCents * PRICE_DROP_MIN_PERCENT;
}

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// ─── In-flight tracking (tests + graceful logging) ───────────────────────────

const inflight = new Set<Promise<unknown>>();

function track<T>(promise: Promise<T>): Promise<T> {
  inflight.add(promise);
  void promise.finally(() => inflight.delete(promise)).catch(() => undefined);
  return promise;
}

/** Resolves once every scheduled/coalesced alert fan-out has finished. */
export async function drainSavedProductAlerts(): Promise<void> {
  while (inflight.size > 0) {
    await Promise.allSettled([...inflight]);
  }
}

// ─── Product snapshots ───────────────────────────────────────────────────────

export interface ProductStockPriceSnapshot {
  totalStock: number;
  minPriceCents: number | null;
}

type Executor = Pick<typeof db, "select">;

export async function snapshotProduct(productId: string, executor: Executor = db): Promise<ProductStockPriceSnapshot> {
  const [row] = await executor
    .select({
      totalStock: sql<number>`coalesce(sum(${productVariants.stock}), 0)::int`,
      minPriceCents: sql<number | null>`min(${productVariants.priceCents})::int`,
    })
    .from(productVariants)
    .where(eq(productVariants.productId, productId));
  return { totalStock: Number(row?.totalStock ?? 0), minPriceCents: row?.minPriceCents ?? null };
}

/**
 * A write changed a product's stock and/or prices and the caller has the
 * before/after snapshots (product-level edit, Shopify re-import). Decides and
 * schedules the right alerts; never throws, never blocks the caller.
 */
export function onProductStockPriceChanged(
  productId: string,
  before: ProductStockPriceSnapshot,
  after: ProductStockPriceSnapshot,
): void {
  if (before.totalStock <= 0 && after.totalStock > 0) scheduleFanOut(productId, "back_in_stock");
  if (after.minPriceCents != null && (before.minPriceCents == null || after.minPriceCents < before.minPriceCents)) {
    scheduleFanOut(productId, "price_drop");
  }
}

// ─── Variant-level entry points (via lib/stockNotifications.ts) ──────────────

const pendingRestock = new Map<string, number>();
const pendingPrice = new Set<string>();

/**
 * One variant's stock went up by `delta`. Deltas for the same product within
 * COALESCE_MS are summed, then judged once: alert if the product had 0 units
 * before them and has units now.
 */
export function noteVariantStockRaised(productId: string, delta: number): void {
  if (!(delta > 0)) return;
  const existing = pendingRestock.get(productId);
  pendingRestock.set(productId, (existing ?? 0) + delta);
  if (existing !== undefined) return;
  track(new Promise<void>((resolve) => {
    setTimeout(() => {
      const total = pendingRestock.get(productId) ?? 0;
      pendingRestock.delete(productId);
      void (async () => {
        try {
          const now = await snapshotProduct(productId);
          if (now.totalStock > 0 && now.totalStock - total <= 0) await runFanOut(productId, "back_in_stock");
        } catch (err) {
          logger.warn({ err, productId }, "Back-in-stock evaluation failed");
        }
      })().finally(resolve);
    }, COALESCE_MS);
  }));
}

/** A variant's price went down; re-evaluate savers against the product's new lowest price. */
export function noteVariantPriceLowered(productId: string): void {
  if (pendingPrice.has(productId)) return;
  pendingPrice.add(productId);
  track(new Promise<void>((resolve) => {
    setTimeout(() => {
      pendingPrice.delete(productId);
      void runFanOut(productId, "price_drop").finally(resolve);
    }, COALESCE_MS);
  }));
}

function scheduleFanOut(productId: string, kind: SavedProductAlertKind): void {
  if (kind === "price_drop") { noteVariantPriceLowered(productId); return; }
  track(new Promise<void>((resolve) => {
    setImmediate(() => { void runFanOut(productId, kind).finally(resolve); });
  }));
}

// ─── Fan-out ─────────────────────────────────────────────────────────────────

interface LiveProduct {
  id: string;
  name: string;
  ownerId: string;
  image: string | null;
}

async function liveProduct(productId: string): Promise<LiveProduct | null> {
  const [row] = await db
    .select({
      id: products.id,
      name: products.name,
      ownerId: products.ownerId,
      status: products.status,
      deletedAt: products.deletedAt,
      images: products.images,
      sellerSuspendedAt: users.suspendedAt,
      sellerDeletedAt: users.deletedAt,
    })
    .from(products)
    .leftJoin(users, eq(users.clerkId, products.ownerId))
    .where(eq(products.id, productId))
    .limit(1);
  if (!row || row.status !== "active" || row.deletedAt || row.sellerSuspendedAt || row.sellerDeletedAt) return null;
  const images = Array.isArray(row.images) ? row.images.filter((i): i is string => typeof i === "string") : [];
  return { id: row.id, name: row.name, ownerId: row.ownerId, image: images[0] ?? null };
}

/** Atomically claim the savers this alert goes to (so concurrent runs never double-send). */
async function claimRecipients(product: LiveProduct, kind: SavedProductAlertKind, priceCents: number | null): Promise<string[]> {
  const isProductRow = and(eq(savedItems.itemType, "product"), eq(savedItems.targetId, product.id));
  if (kind === "back_in_stock") {
    const now = new Date();
    // The Saved screen's "Back in stock" badge is for every saver, opted in or not.
    await db.update(savedItems).set({ backInStockAt: now, wasOutOfStock: false }).where(isProductRow);
    const cutoff = new Date(now.getTime() - BACK_IN_STOCK_COOLDOWN_MS);
    const claimed = await db.update(savedItems)
      .set({ backInStockNotifiedAt: now })
      .where(and(
        isProductRow,
        eq(savedItems.notifyOnBackInStock, true),
        sql`(${savedItems.backInStockNotifiedAt} IS NULL OR ${savedItems.backInStockNotifiedAt} < ${cutoff})`,
      ))
      .returning({ userId: savedItems.userId });
    return claimed.map((r) => r.userId);
  }
  if (priceCents == null) return [];
  // Rows saved before price snapshots existed get a baseline, not an alert.
  await db.update(savedItems)
    .set({ savedPriceCents: priceCents, lastNotifiedPriceCents: priceCents })
    .where(and(isProductRow, sql`${savedItems.savedPriceCents} IS NULL AND ${savedItems.lastNotifiedPriceCents} IS NULL`));
  const reference = sql`LEAST(${savedItems.savedPriceCents}, ${savedItems.lastNotifiedPriceCents})`;
  const claimed = await db.update(savedItems)
    .set({ lastNotifiedPriceCents: priceCents })
    .where(and(
      isProductRow,
      eq(savedItems.notifyOnPriceDrop, true),
      sql`${reference} - ${priceCents} >= ${PRICE_DROP_MIN_CENTS}`,
      sql`(${reference} - ${priceCents}) * 100 >= ${reference} * ${PRICE_DROP_MIN_PERCENT}`,
    ))
    .returning({ userId: savedItems.userId });
  return claimed.map((r) => r.userId);
}

async function blockedWithSeller(ownerId: string, buyerIds: string[]): Promise<Set<string>> {
  if (buyerIds.length === 0) return new Set();
  const rows = await db.select({ blockerId: blocks.blockerId, blockedId: blocks.blockedId })
    .from(blocks)
    .where(or(
      and(eq(blocks.blockerId, ownerId), inArray(blocks.blockedId, buyerIds)),
      and(eq(blocks.blockedId, ownerId), inArray(blocks.blockerId, buyerIds)),
    ));
  return new Set(rows.map((r) => (r.blockerId === ownerId ? r.blockedId : r.blockerId)));
}

/**
 * Sends one alert kind for one product to every eligible saver. Returns how
 * many buyers got an Activity row. Never throws.
 */
export async function runFanOut(productId: string, kind: SavedProductAlertKind): Promise<number> {
  try {
    const product = await liveProduct(productId);
    if (!product) return 0;
    const snapshot = await snapshotProduct(productId);
    if (kind === "back_in_stock" && snapshot.totalStock <= 0) return 0;
    const priceCents = snapshot.minPriceCents;
    if (kind === "price_drop" && priceCents == null) return 0;

    const claimed = (await claimRecipients(product, kind, priceCents)).filter((id) => id !== product.ownerId);
    if (claimed.length === 0) return 0;

    let reached = 0;
    for (let i = 0; i < claimed.length; i += FANOUT_CHUNK) {
      const chunk = claimed.slice(i, i + FANOUT_CHUNK);
      const blocked = await blockedWithSeller(product.ownerId, chunk);
      const recipients = chunk.filter((id) => !blocked.has(id));
      if (recipients.length === 0) continue;
      // notifications_feed has one row per (buyer, type, product) by unique
      // index — replace the previous alert so the new one surfaces (and pushes).
      await db.delete(notificationsFeed).where(and(
        eq(notificationsFeed.type, kind),
        eq(notificationsFeed.targetId, product.id),
        inArray(notificationsFeed.userId, recipients),
      ));
      const results = await Promise.allSettled(recipients.map((userId) => publishNotification({
        userId,
        category: "stock",
        type: kind,
        title: kind === "back_in_stock" ? "Back in stock" : "Price drop",
        body: kind === "back_in_stock"
          ? `${product.name} is back in stock — get it before it's gone again.`
          : `${product.name} just dropped to ${formatUsd(priceCents!)}.`,
        targetId: product.id,
        targetType: "product",
        targetImageUrl: product.image,
        cta: "Shop now",
        analyticsOwnerId: product.ownerId,
        pushChannelId: "stock",
      })));
      results.forEach((result, index) => {
        if (result.status === "fulfilled") reached += 1;
        else logger.warn({ err: result.reason, userId: recipients[index], productId, kind }, "Saved-product alert failed");
      });
    }

    await db.insert(productSaveAlertRuns).values({
      productId: product.id,
      ownerId: product.ownerId,
      kind,
      recipientCount: reached,
      priceCents: kind === "price_drop" ? priceCents : null,
    });
    logger.info({ productId, kind, reached, claimed: claimed.length }, "Saved-product alert fan-out finished");
    return reached;
  } catch (err) {
    logger.warn({ err, productId, kind }, "Saved-product alert fan-out failed");
    return 0;
  }
}

// ─── Seller-facing stats ─────────────────────────────────────────────────────

export interface ProductSaveStats {
  saves: number;
  priceAlertsOn: number;
  restockAlertsOn: number;
  backInStockReached: number;
  priceDropReached: number;
  lastAlertAt: string | null;
}

export async function productSaveStats(productId: string): Promise<ProductSaveStats> {
  const [saveRow] = await db
    .select({
      saves: sql<number>`count(*)::int`,
      priceAlertsOn: sql<number>`count(*) filter (where ${savedItems.notifyOnPriceDrop})::int`,
      restockAlertsOn: sql<number>`count(*) filter (where ${savedItems.notifyOnBackInStock})::int`,
    })
    .from(savedItems)
    .where(and(eq(savedItems.itemType, "product"), eq(savedItems.targetId, productId)));
  const [runRow] = await db
    .select({
      backInStockReached: sql<number>`coalesce(sum(${productSaveAlertRuns.recipientCount}) filter (where ${productSaveAlertRuns.kind} = 'back_in_stock'), 0)::int`,
      priceDropReached: sql<number>`coalesce(sum(${productSaveAlertRuns.recipientCount}) filter (where ${productSaveAlertRuns.kind} = 'price_drop'), 0)::int`,
      lastAlertAt: sql<string | null>`max(${productSaveAlertRuns.createdAt})`,
    })
    .from(productSaveAlertRuns)
    .where(eq(productSaveAlertRuns.productId, productId));
  return {
    saves: Number(saveRow?.saves ?? 0),
    priceAlertsOn: Number(saveRow?.priceAlertsOn ?? 0),
    restockAlertsOn: Number(saveRow?.restockAlertsOn ?? 0),
    backInStockReached: Number(runRow?.backInStockReached ?? 0),
    priceDropReached: Number(runRow?.priceDropReached ?? 0),
    lastAlertAt: runRow?.lastAlertAt ? new Date(runRow.lastAlertAt).toISOString() : null,
  };
}

/** Current lowest variant price — the server-side snapshot taken when a buyer saves a product. */
export async function currentProductPriceCents(productId: string): Promise<number | null> {
  try {
    return (await snapshotProduct(productId)).minPriceCents;
  } catch {
    return null;
  }
}
