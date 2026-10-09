/**
 * Scheduled product launches.
 *
 * A product with no product_launches row is unaffected. A product with a row
 * is purchasable once launched_at is set or launch_at has passed on the
 * server clock (so a late job run never blocks buyers).
 */
import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { db, follows, productLaunchAlerts, productLaunches, products } from "@workspace/db";
import type { DbExecutor } from "./money/ledger";
import { publishNotification } from "../routes/notifications-feed";
import { logger } from "./logger";
import { bumpResponseCacheGeneration } from "../middlewares/responseCache";

export function isProductLive(
  launch: { launchAt: Date; launchedAt: Date | null } | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!launch) return true;
  if (launch.launchedAt) return true;
  return launch.launchAt.getTime() <= now.getTime();
}

export function validateLaunchAt(launchAt: Date, now: Date = new Date()): string | null {
  if (Number.isNaN(launchAt.getTime())) return "Enter a valid launch time.";
  if (launchAt.getTime() <= now.getTime()) return "The launch time must be in the future.";
  return null;
}

/** IDs among `productIds` that are scheduled and not yet live. Empty for products without a launch row. */
export async function unlaunchedProductIds(
  productIds: string[],
  now: Date = new Date(),
  executor: DbExecutor = db,
): Promise<string[]> {
  if (productIds.length === 0) return [];
  const rows = await executor
    .select({ productId: productLaunches.productId })
    .from(productLaunches)
    .where(and(
      inArray(productLaunches.productId, productIds),
      isNull(productLaunches.launchedAt),
      sql`${productLaunches.launchAt} > ${now}`,
    ));
  return rows.map((r) => r.productId);
}

const FANOUT_CHUNK = 50;

/**
 * Flips due launches to launched and notifies "Notify me" subscribers (and
 * followers when enabled). The launched_at UPDATE ... WHERE launched_at IS
 * NULL is the claim: whichever worker wins it sends, everyone else skips, so
 * overlapping runs and re-runs never notify twice.
 */
export async function runProductLaunches(now: Date = new Date()): Promise<{ launched: number; notified: number }> {
  const due = await db
    .select({ productId: productLaunches.productId })
    .from(productLaunches)
    .where(and(isNull(productLaunches.launchedAt), lte(productLaunches.launchAt, now)));

  let launched = 0;
  let notified = 0;
  for (const { productId } of due) {
    const [claimed] = await db
      .update(productLaunches)
      .set({ launchedAt: now, updatedAt: now })
      .where(and(eq(productLaunches.productId, productId), isNull(productLaunches.launchedAt)))
      .returning({ productId: productLaunches.productId, notifyFollowers: productLaunches.notifyFollowers });
    if (!claimed) continue;
    launched++;
    try {
      notified += await notifyLaunch(productId, claimed.notifyFollowers, now);
    } catch (err) {
      logger.error({ err, productId, job: "productLaunches" }, "Launch notifications failed");
    }
  }
  // A launched product becomes searchable now, not when the cached page expires.
  if (launched > 0) await bumpResponseCacheGeneration("search").catch(() => undefined);
  return { launched, notified };
}

async function notifyLaunch(productId: string, notifyFollowers: boolean, now: Date): Promise<number> {
  const [product] = await db
    .select({ name: products.name, ownerId: products.ownerId, status: products.status, deletedAt: products.deletedAt })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  if (!product || product.status !== "active" || product.deletedAt) return 0;

  // Claim each subscriber row individually so a retry can never resend.
  const claimedAlerts = await db
    .update(productLaunchAlerts)
    .set({ notifiedAt: now })
    .where(and(eq(productLaunchAlerts.productId, productId), isNull(productLaunchAlerts.notifiedAt)))
    .returning({ userId: productLaunchAlerts.userId });
  const recipients = new Set(claimedAlerts.map((a) => a.userId));

  if (notifyFollowers) {
    const followerRows = await db
      .select({ userId: follows.followerId })
      .from(follows)
      .where(eq(follows.followingId, product.ownerId));
    for (const f of followerRows) recipients.add(f.userId);
  }
  recipients.delete(product.ownerId);

  const ids = [...recipients];
  for (let i = 0; i < ids.length; i += FANOUT_CHUNK) {
    await Promise.all(ids.slice(i, i + FANOUT_CHUNK).map((userId) =>
      publishNotification({
        userId,
        category: "stock",
        type: "product_launched",
        title: "Just launched",
        body: `${product.name} is live now.`,
        targetId: productId,
        targetType: "product",
        cta: "Shop now",
        analyticsOwnerId: product.ownerId,
        pushChannelId: "stock",
      }).catch((err) => logger.warn({ err, userId, productId }, "Launch notification failed"))
    ));
  }
  return ids.length;
}
