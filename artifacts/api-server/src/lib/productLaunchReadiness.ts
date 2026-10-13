/**
 * DB side of the launch readiness checklist and the follower activity
 * summary. The decisions themselves live in the pure modules
 * (productLaunchChecklist.ts, followerActivity.ts).
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db, follows, productLaunches, productVariants, products, shippingRates, shippingZones, users,
} from "@workspace/db";
import { deriveProductLaunchChecklist, type ProductLaunchChecklist } from "./productLaunchChecklist";
import { ACTIVITY_WINDOW_DAYS, summarizeFollowerActivity, type ActivityPair, type FollowerActivitySummary } from "./followerActivity";

export interface ReadinessOverride { launchAt?: Date | null; notifyFollowers?: boolean }

/**
 * Checklists for the owner's products (missing / deleted / other sellers'
 * products are absent from the map). `override` replaces the saved launch
 * time and follower toggle for every product — used by PUT to judge the
 * schedule being proposed.
 */
export async function loadProductLaunchReadiness(
  ownerId: string,
  productIds: string[],
  override: ReadinessOverride = {},
  now: Date = new Date(),
): Promise<Map<string, ProductLaunchChecklist>> {
  const out = new Map<string, ProductLaunchChecklist>();
  if (productIds.length === 0) return out;

  const [productRows, variantRows, launchRows, [user], [zone], [rate], [followerRow]] = await Promise.all([
    db.select({ id: products.id, images: products.images, description: products.description, isPreOrder: products.isPreOrder })
      .from(products)
      .where(and(inArray(products.id, productIds), eq(products.ownerId, ownerId), isNull(products.deletedAt))),
    db.select({ productId: productVariants.productId, priceCents: productVariants.priceCents, stock: productVariants.stock, size: productVariants.size, color: productVariants.color })
      .from(productVariants)
      .where(inArray(productVariants.productId, productIds)),
    db.select({ productId: productLaunches.productId, launchAt: productLaunches.launchAt, notifyFollowers: productLaunches.notifyFollowers })
      .from(productLaunches)
      .where(inArray(productLaunches.productId, productIds)),
    db.select({ stripeAccountStatus: users.stripeAccountStatus }).from(users).where(eq(users.clerkId, ownerId)).limit(1),
    db.select({ id: shippingZones.id }).from(shippingZones).where(and(eq(shippingZones.sellerId, ownerId), eq(shippingZones.active, true))).limit(1),
    db.select({ id: shippingRates.id }).from(shippingRates).where(and(eq(shippingRates.sellerId, ownerId), eq(shippingRates.active, true))).limit(1),
    db.select({ n: sql<number>`count(*)::int` }).from(follows).where(eq(follows.followingId, ownerId)),
  ]);

  const launchById = new Map(launchRows.map((l) => [l.productId, l]));
  for (const p of productRows) {
    const saved = launchById.get(p.id);
    out.set(p.id, deriveProductLaunchChecklist({
      imageCount: Array.isArray(p.images) ? p.images.filter((u) => typeof u === "string" && u.length > 0).length : 0,
      variants: variantRows.filter((v) => v.productId === p.id),
      isPreOrder: p.isPreOrder,
      description: p.description,
      hasShipping: !!zone || !!rate,
      stripeAccountStatus: user?.stripeAccountStatus ?? null,
      launchAt: override.launchAt !== undefined ? override.launchAt : (saved?.launchAt ?? null),
      notifyFollowers: override.notifyFollowers ?? saved?.notifyFollowers ?? false,
      followerCount: Number(followerRow?.n ?? 0),
      now,
    }));
  }
  return out;
}

/**
 * Distinct (follower, UTC hour) pairs of activity over the last 28 days from
 * three sources: feed interactions, store visits (any store) and app opens
 * (push_tokens.last_seen_at). These columns are `timestamp without time
 * zone` written in UTC, so the window and the hour are computed in UTC.
 */
export async function loadFollowerActivityPairs(sellerId: string, now: Date = new Date()): Promise<ActivityPair[]> {
  const since = new Date(now.getTime() - ACTIVITY_WINDOW_DAYS * 24 * 3600 * 1000);
  const sinceUtc = sql`(${since.toISOString()}::timestamptz at time zone 'UTC')`;
  const untilUtc = sql`(${now.toISOString()}::timestamptz at time zone 'UTC')`;
  const result = await db.execute(sql`
    with f as (select follower_id as uid from follows where following_id = ${sellerId} and follower_id <> ${sellerId}),
    ev as (
      select i.user_id as uid, i.created_at as at from interactions i join f on f.uid = i.user_id
        where i.created_at >= ${sinceUtc} and i.created_at < ${untilUtc}
      union all
      select v.viewer_user_id, v.created_at from store_visits v join f on f.uid = v.viewer_user_id
        where v.created_at >= ${sinceUtc} and v.created_at < ${untilUtc}
      union all
      select t.user_id, t.last_seen_at from push_tokens t join f on f.uid = t.user_id
        where t.last_seen_at >= ${sinceUtc} and t.last_seen_at < ${untilUtc}
    )
    select uid, to_char(date_trunc('hour', at), 'YYYY-MM-DD"T"HH24":00:00Z"') as hour
    from ev group by uid, date_trunc('hour', at)
  `);
  const rows = ((result as any).rows ?? result) as Array<{ uid: string; hour: string }>;
  return rows.map((r) => ({ userId: r.uid, hourUtc: new Date(r.hour) }));
}

export async function loadFollowerActivity(sellerId: string, timeZone: string, now: Date = new Date()): Promise<FollowerActivitySummary> {
  return summarizeFollowerActivity(await loadFollowerActivityPairs(sellerId, now), timeZone);
}
