/**
 * DB helpers for Fits (stitches, buyer fit checks, brand repost requests).
 * Pure rules live in ./fitsRules.
 */
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db, follows, postFitChecks, repostRequests, users } from "@workspace/db";
import { brandRepostNeedsPermission, isQualifyingPurchase } from "./fitsRules";

/** Product ids (of `productIds`, or all) the buyer has a qualifying purchase of. */
export async function purchasedProductIds(buyerId: string, productIds?: string[]): Promise<Set<string>> {
  if (productIds && productIds.length === 0) return new Set();
  const filter = productIds ? sql`AND pv.product_id IN (${sql.join(productIds.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``;
  const r = await db.execute(sql`
    SELECT pv.product_id AS product_id, o.status AS order_status, o.paid_at AS paid_at, oi.refunded_at AS item_refunded_at
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    JOIN product_variants pv ON pv.id = oi.variant_id
    WHERE o.buyer_id = ${buyerId} ${filter}
  `);
  const ids = new Set<string>();
  for (const row of r.rows as Array<{ product_id: string; order_status: string | null; paid_at: Date | null; item_refunded_at: Date | null }>) {
    if (isQualifyingPurchase({ orderStatus: row.order_status, paidAt: row.paid_at, itemRefundedAt: row.item_refunded_at })) {
      ids.add(row.product_id);
    }
  }
  return ids;
}

/** Both follow each other (the audience for a buyer's profile posts). */
export async function isMutualFollow(a: string, b: string): Promise<boolean> {
  if (a === b) return true;
  const edges = await db.select({ followerId: follows.followerId }).from(follows).where(or(
    and(eq(follows.followerId, a), eq(follows.followingId, b)),
    and(eq(follows.followerId, b), eq(follows.followingId, a)),
  ));
  return edges.some((e) => e.followerId === a) && edges.some((e) => e.followerId === b);
}

export async function isFitCheckPost(postId: string): Promise<boolean> {
  const [row] = await db.select({ postId: postFitChecks.postId }).from(postFitChecks)
    .where(eq(postFitChecks.postId, postId)).limit(1);
  return !!row;
}

export async function accountTypes(ids: string[]): Promise<Map<string, string | null>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await db.select({ clerkId: users.clerkId, accountType: users.accountType })
    .from(users).where(inArray(users.clerkId, unique));
  return new Map(rows.map((r) => [r.clerkId, r.accountType]));
}

/**
 * True when `reposterId` is a brand trying to repost a buyer's post without
 * an approved repost request. Used by every repost path (plain repost, quote,
 * stitch) so the permission rule cannot be bypassed.
 */
export async function brandRepostBlocked(reposterId: string, ownerId: string | null | undefined, postId: string): Promise<boolean> {
  if (!ownerId) return false;
  const types = await accountTypes([reposterId, ownerId]);
  if (!brandRepostNeedsPermission(types.get(reposterId) ?? null, types.get(ownerId) ?? null, reposterId === ownerId)) return false;
  const [approved] = await db.select({ id: repostRequests.id }).from(repostRequests).where(and(
    eq(repostRequests.postId, postId),
    eq(repostRequests.requesterSellerId, reposterId),
    eq(repostRequests.status, "approved"),
  )).limit(1);
  return !approved;
}

export const REPOST_PERMISSION_REQUIRED = {
  error: "Ask for permission to repost this post.",
  code: "REPOST_PERMISSION_REQUIRED",
} as const;
