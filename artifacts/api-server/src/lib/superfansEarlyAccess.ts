/**
 * Superfans early access (Customers > Superfans > "Give early access").
 *
 * One tap grants every superfan (lib/sellerCustomers.ts `superfans`) early
 * access to the seller's next drop: the earliest draft/active drop whose
 * releaseAt is still in the future. A grant is one drop_early_access_grants
 * row per (drop, buyer); checkoutPlan.ts lets that buyer check out during the
 * drop's early window (earlyAccessMinutes, or 60 when it is 0) even when they
 * don't follow the seller. Granting again is a no-op for buyers who already
 * have it.
 *
 * Each newly granted buyer gets one in-app Activity row ("<Brand> gave you
 * early access to <Drop>") and no push: the row is inserted directly rather
 * than through publishNotification, which always pushes when the category
 * maps to a push channel.
 */
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { activityMutes, db, dropEarlyAccessGrants, drops, notificationsFeed, users } from "@workspace/db";
import { listSellerCustomers, superfans } from "./sellerCustomers";
import { grantEarlyAccessMinutes } from "./money/dropLaunch";
import { isChannelEnabledForUser } from "./notificationChannels";

export const EARLY_ACCESS_NOTIFICATION_TYPE = "drop_early_access";

export interface NextDrop {
  id: string;
  name: string;
  releaseAt: Date;
  earlyAccessMinutes: number;
}

/** The seller's next drop: earliest draft/active drop releasing after `now`. */
export async function nextDropFor(ownerId: string, now: Date = new Date()): Promise<NextDrop | null> {
  const [row] = await db.select({
    id: drops.id, name: drops.name, releaseAt: drops.releaseAt, earlyAccessMinutes: drops.earlyAccessMinutes,
  }).from(drops)
    .where(and(eq(drops.ownerId, ownerId), inArray(drops.status, ["draft", "active"]), gt(drops.releaseAt, now)))
    .orderBy(asc(drops.releaseAt))
    .limit(1);
  if (!row?.releaseAt) return null;
  return { id: row.id, name: row.name, releaseAt: row.releaseAt, earlyAccessMinutes: row.earlyAccessMinutes ?? 0 };
}

/** Signed-in buyer ids of the seller's current superfans. */
export async function superfanBuyerIds(ownerId: string): Promise<string[]> {
  const list = superfans(await listSellerCustomers(ownerId), ownerId);
  return [...new Set(list.flatMap((c) => c.buyerIds))];
}

function dropJson(drop: NextDrop) {
  return {
    id: drop.id,
    name: drop.name,
    releaseAt: drop.releaseAt.toISOString(),
    earlyAccessMinutes: grantEarlyAccessMinutes(drop.earlyAccessMinutes),
  };
}

/** What the Superfans tab's button shows. */
export async function superfansEarlyAccessStatus(ownerId: string, now: Date = new Date()) {
  const [drop, buyerIds] = await Promise.all([nextDropFor(ownerId, now), superfanBuyerIds(ownerId)]);
  if (!drop) return { drop: null, superfans: buyerIds.length, granted: 0, allGranted: false };
  const granted = buyerIds.length
    ? (await db.select({ buyerId: dropEarlyAccessGrants.buyerId }).from(dropEarlyAccessGrants)
      .where(and(eq(dropEarlyAccessGrants.dropId, drop.id), inArray(dropEarlyAccessGrants.buyerId, buyerIds)))).length
    : 0;
  return {
    drop: dropJson(drop),
    superfans: buyerIds.length,
    granted,
    allGranted: buyerIds.length > 0 && granted === buyerIds.length,
  };
}

export type GrantResult =
  | { ok: true; dropId: string; dropName: string; granted: number; alreadyHad: number }
  | { ok: false; status: number; code: "NO_UPCOMING_DROP" | "NO_SUPERFANS"; error: string };

export async function grantSuperfansEarlyAccess(input: {
  ownerId: string;
  grantedBy: string;
  now?: Date;
}): Promise<GrantResult> {
  const now = input.now ?? new Date();
  const drop = await nextDropFor(input.ownerId, now);
  if (!drop) return { ok: false, status: 409, code: "NO_UPCOMING_DROP", error: "Schedule a drop first" };
  const buyerIds = await superfanBuyerIds(input.ownerId);
  if (!buyerIds.length) return { ok: false, status: 409, code: "NO_SUPERFANS", error: "No superfans yet" };

  const inserted = await db.insert(dropEarlyAccessGrants)
    .values(buyerIds.map((buyerId) => ({ dropId: drop.id, buyerId, grantedBy: input.grantedBy, grantedAt: now })))
    .onConflictDoNothing()
    .returning({ buyerId: dropEarlyAccessGrants.buyerId });
  const newly = inserted.map((r) => r.buyerId);

  if (newly.length) await notifyGranted(input.ownerId, drop, newly);

  return { ok: true, dropId: drop.id, dropName: drop.name, granted: newly.length, alreadyHad: buyerIds.length - newly.length };
}

/** One in-app Activity row per newly granted buyer. Never a push. */
async function notifyGranted(ownerId: string, drop: NextDrop, buyerIds: string[]): Promise<void> {
  const [seller] = await db.select({
    brandName: users.brandName, displayName: users.displayName, username: users.username, logoUrl: users.logoUrl,
  }).from(users).where(eq(users.clerkId, ownerId)).limit(1);
  const brand = seller?.brandName?.trim() || seller?.displayName?.trim() || seller?.username?.trim() || "A brand you shop";

  // "See less" (Activity menu) on this type or this brand keeps the row muted;
  // Settings > Notifications > In-app > Drops off skips it entirely — the same
  // rules publishNotification applies to its feed row.
  const mutes = await db.select({ userId: activityMutes.userId }).from(activityMutes)
    .where(and(
      inArray(activityMutes.userId, buyerIds),
      inArray(activityMutes.muteKey, [`type:${EARLY_ACCESS_NOTIFICATION_TYPE}`, `actor:${ownerId}`]),
    ));
  const muted = new Set(mutes.map((m) => m.userId));
  const enabled = await Promise.all(buyerIds.map((id) => isChannelEnabledForUser(id, "drop", "inApp")));
  const rows = buyerIds
    .filter((_, i) => enabled[i])
    .map((userId) => ({
      userId,
      category: "drops",
      type: EARLY_ACCESS_NOTIFICATION_TYPE,
      title: `${brand} gave you early access to ${drop.name}`,
      body: "",
      isMuted: muted.has(userId),
      actorId: ownerId,
      actorName: brand,
      actorHandle: seller?.username ?? null,
      targetId: drop.id,
      targetType: "drop",
      cta: "View drop",
      targetImageUrl: seller?.logoUrl ?? null,
    }));
  if (rows.length) await db.insert(notificationsFeed).values(rows).onConflictDoNothing();
}
