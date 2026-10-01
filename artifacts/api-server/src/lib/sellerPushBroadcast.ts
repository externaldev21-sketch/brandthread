/**
 * Seller -> followers push broadcasts.
 *
 * Reuses the existing delivery pipeline (publishNotification -> in-app feed
 * row + sendPushToUser, which already honours the master push switch, quiet
 * hours and per-category preferences) and adds:
 *   - a hard 1-broadcast-per-seller-per-rolling-24h limit claimed atomically
 *     in the database (per-seller advisory lock + the claim row itself);
 *   - audience filtering (blocked either way, push disabled, brand
 *     announcements switched off, the seller muted, deleted/suspended);
 *   - text moderation via lib/contentModerator.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  drops,
  notificationEvents,
  notificationsFeed,
  posts,
  products,
  sellerPushBroadcasts,
  users,
} from "@workspace/db";
import { publishNotification } from "../routes/notifications-feed";
import { evaluateContent } from "./contentModerator";
import { logger } from "./logger";

export const BROADCAST_WINDOW_MS = 24 * 60 * 60 * 1000;
export const BROADCAST_TITLE_MAX = 50;
export const BROADCAST_BODY_MAX = 178;
export const BROADCAST_FEED_TYPE = "seller_broadcast";
const DELIVERY_CONCURRENCY = 50;

export type DeeplinkType = "product" | "drop" | "post";
const DEEPLINK_TYPES: readonly DeeplinkType[] = ["product", "drop", "post"];

export interface BroadcastInput {
  title: string;
  body: string;
  deeplinkType: DeeplinkType | null;
  deeplinkId: string | null;
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

/**
 * Rolling-window math. A seller may send when their most recent broadcast is
 * at least BROADCAST_WINDOW_MS old; `nextAt` is when the window reopens.
 */
export function broadcastWindow(
  lastSentAt: Date | null | undefined,
  now: Date = new Date(),
): { canSend: boolean; nextAt: Date | null; retryAfterSec: number } {
  if (!lastSentAt) return { canSend: true, nextAt: null, retryAfterSec: 0 };
  const nextAt = new Date(lastSentAt.getTime() + BROADCAST_WINDOW_MS);
  if (nextAt.getTime() <= now.getTime()) return { canSend: true, nextAt: null, retryAfterSec: 0 };
  return {
    canSend: false,
    nextAt,
    retryAfterSec: Math.ceil((nextAt.getTime() - now.getTime()) / 1000),
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateBroadcastInput(raw: unknown):
  | { ok: true; value: BroadcastInput }
  | { ok: false; error: string } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const title = typeof r.title === "string" ? r.title.trim() : "";
  const body = typeof r.body === "string" ? r.body.trim() : "";
  if (!title) return { ok: false, error: "A title is required." };
  if (!body) return { ok: false, error: "A message is required." };
  if (title.length > BROADCAST_TITLE_MAX) return { ok: false, error: `Title must be ${BROADCAST_TITLE_MAX} characters or fewer.` };
  if (body.length > BROADCAST_BODY_MAX) return { ok: false, error: `Message must be ${BROADCAST_BODY_MAX} characters or fewer.` };

  let deeplinkType: DeeplinkType | null = null;
  let deeplinkId: string | null = null;
  const hasType = r.deeplinkType !== undefined && r.deeplinkType !== null && r.deeplinkType !== "";
  const hasId = r.deeplinkId !== undefined && r.deeplinkId !== null && r.deeplinkId !== "";
  if (hasType || hasId) {
    if (!hasType || !hasId || typeof r.deeplinkType !== "string" || typeof r.deeplinkId !== "string") {
      return { ok: false, error: "A link needs both a type and an id." };
    }
    if (!DEEPLINK_TYPES.includes(r.deeplinkType as DeeplinkType)) {
      return { ok: false, error: "Link must point to a product, drop or post." };
    }
    if (!UUID_RE.test(r.deeplinkId)) return { ok: false, error: "Invalid link id." };
    deeplinkType = r.deeplinkType as DeeplinkType;
    deeplinkId = r.deeplinkId;
  }
  return { ok: true, value: { title, body, deeplinkType, deeplinkId } };
}

/** Public-surface moderation: anything that would be held or rejected in a comment is refused here. */
export function moderateBroadcastText(input: Pick<BroadcastInput, "title" | "body">):
  | { ok: true }
  | { ok: false; reason: string } {
  const decision = evaluateContent(`${input.title}\n${input.body}`, "public");
  if (decision.action === "allow") return { ok: true };
  return { ok: false, reason: decision.reason };
}

// ─── DB: deeplink ownership ──────────────────────────────────────────────────

/** A seller can only link to their own live product, drop or published post. */
export async function deeplinkBelongsToSeller(
  sellerId: string,
  type: DeeplinkType,
  id: string,
): Promise<boolean> {
  if (type === "product") {
    const [row] = await db.select({ id: products.id }).from(products)
      .where(and(eq(products.id, id), eq(products.ownerId, sellerId), sql`${products.deletedAt} IS NULL`)).limit(1);
    return !!row;
  }
  if (type === "drop") {
    const [row] = await db.select({ id: drops.id }).from(drops)
      .where(and(eq(drops.id, id), eq(drops.ownerId, sellerId))).limit(1);
    return !!row;
  }
  const [row] = await db.select({ id: posts.id }).from(posts)
    .where(and(eq(posts.id, id), eq(posts.userId, sellerId), eq(posts.postStatus, "published"))).limit(1);
  return !!row;
}

// ─── DB: audience ────────────────────────────────────────────────────────────

export interface Audience {
  followers: number;
  recipientIds: string[];
  skipped: number;
}

/**
 * Followers who should receive the broadcast. A follower is skipped when they
 * blocked the seller (or the seller blocked them), switched push off, turned
 * "Brand announcements" off, muted the seller in Activity, or their account is
 * deleted/suspended. Quiet hours are applied downstream by sendPushToUser (the
 * in-app feed row is kept, the device push is held back).
 */
export async function resolveAudience(sellerId: string): Promise<Audience> {
  const res = await db.execute(sql`
    SELECT f.follower_id AS id,
      (
        f.follower_id <> ${sellerId}
        AND (u.id IS NULL OR (
          u.deleted_at IS NULL
          AND u.suspended_at IS NULL
          AND u.push_enabled IS NOT FALSE
          AND COALESCE(u.notification_preferences->>'seller_announcements', 'true') <> 'false'
        ))
        AND NOT EXISTS (
          SELECT 1 FROM blocks b
          WHERE (b.blocker_id = f.follower_id AND b.blocked_id = ${sellerId})
             OR (b.blocker_id = ${sellerId} AND b.blocked_id = f.follower_id)
        )
        AND NOT EXISTS (
          SELECT 1 FROM activity_mutes m
          WHERE m.user_id = f.follower_id AND m.mute_key = ${"actor:" + sellerId}
        )
      ) AS ok
    FROM follows f
    LEFT JOIN users u ON u.clerk_id = f.follower_id
    WHERE f.following_id = ${sellerId}
  `);
  const rows = ((res as any).rows ?? []) as { id: string; ok: boolean }[];
  const recipientIds = rows.filter((r) => r.ok).map((r) => r.id);
  return { followers: rows.length, recipientIds, skipped: rows.length - recipientIds.length };
}

// ─── DB: claim + deliver ─────────────────────────────────────────────────────

export type ClaimResult =
  | { ok: true; id: string; createdAt: Date }
  | { ok: false; nextAt: Date; retryAfterSec: number };

/**
 * Atomically claim the seller's broadcast slot. The per-seller advisory lock
 * serialises concurrent requests; the loser re-reads the winner's committed
 * row and is refused.
 */
export async function claimBroadcastSlot(
  sellerId: string,
  input: BroadcastInput,
  now: Date = new Date(),
): Promise<ClaimResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"seller_push_broadcast:" + sellerId}))`);
    const [last] = await tx.select({ createdAt: sellerPushBroadcasts.createdAt })
      .from(sellerPushBroadcasts)
      .where(eq(sellerPushBroadcasts.sellerId, sellerId))
      .orderBy(desc(sellerPushBroadcasts.createdAt))
      .limit(1);
    const window = broadcastWindow(last?.createdAt, now);
    if (!window.canSend) return { ok: false as const, nextAt: window.nextAt!, retryAfterSec: window.retryAfterSec };
    const [row] = await tx.insert(sellerPushBroadcasts).values({
      sellerId,
      title: input.title,
      body: input.body,
      deeplinkType: input.deeplinkType,
      deeplinkId: input.deeplinkId,
      createdAt: now,
    }).returning({ id: sellerPushBroadcasts.id, createdAt: sellerPushBroadcasts.createdAt });
    return { ok: true as const, id: row.id, createdAt: row.createdAt };
  });
}

async function sellerIdentity(sellerId: string) {
  const [s] = await db.select({ displayName: users.displayName, username: users.username })
    .from(users).where(eq(users.clerkId, sellerId)).limit(1);
  const name = s?.displayName || s?.username || "A brand you follow";
  return {
    name,
    handle: s?.username ?? undefined,
    initials: name.replace(/[^A-Za-z0-9 ]/g, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "B",
  };
}

export interface BroadcastDelivery {
  recipients: number;
  sent: number;
  failed: number;
  skipped: number;
}

/** Deliver a claimed broadcast. Updates the claim row with the final counts. */
export async function deliverBroadcast(
  claimId: string,
  sellerId: string,
  input: BroadcastInput,
): Promise<BroadcastDelivery> {
  const [audience, identity] = await Promise.all([resolveAudience(sellerId), sellerIdentity(sellerId)]);
  await db.update(sellerPushBroadcasts)
    .set({ recipientCount: audience.recipientIds.length, skippedCount: audience.skipped })
    .where(eq(sellerPushBroadcasts.id, claimId));

  const targetType = input.deeplinkType ?? "user";
  const targetId = input.deeplinkId ?? sellerId;
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < audience.recipientIds.length; i += DELIVERY_CONCURRENCY) {
    const chunk = audience.recipientIds.slice(i, i + DELIVERY_CONCURRENCY);
    const results = await Promise.allSettled(chunk.map((userId) => publishNotification({
      userId,
      category: "announcements",
      type: BROADCAST_FEED_TYPE,
      title: input.title,
      body: input.body,
      actorId: sellerId,
      actorName: identity.name,
      actorHandle: identity.handle,
      actorInitials: identity.initials,
      targetType,
      targetId,
      cta: "View",
      analyticsOwnerId: sellerId,
    })));
    for (const r of results) {
      if (r.status === "fulfilled") sent += 1;
      else { failed += 1; logger.warn({ err: r.reason }, "Seller broadcast delivery failed for a follower"); }
    }
  }

  await db.update(sellerPushBroadcasts)
    .set({ status: "sent", sentCount: sent, completedAt: new Date() })
    .where(eq(sellerPushBroadcasts.id, claimId));
  return { recipients: audience.recipientIds.length, sent, failed, skipped: audience.skipped };
}

// ─── DB: results ─────────────────────────────────────────────────────────────

/**
 * Distinct followers who opened/tapped a broadcast, read from the same
 * notification_events pipeline the app reports into. One seller can only
 * broadcast once per 24h, so feed rows of type seller_broadcast created in
 * [createdAt, createdAt + 24h) belong to exactly this broadcast.
 */
export async function countOpens(sellerId: string, createdAt: Date): Promise<number> {
  const windowEnd = new Date(createdAt.getTime() + BROADCAST_WINDOW_MS);
  const res = await db.execute(sql`
    SELECT COUNT(DISTINCT e.user_id)::int AS opened
    FROM ${notificationEvents} e
    JOIN ${notificationsFeed} n ON n.id::text = e.notification_id AND n.user_id = e.user_id
    WHERE n.actor_id = ${sellerId}
      AND n.type = ${BROADCAST_FEED_TYPE}
      AND n.created_at::timestamptz >= ${createdAt.toISOString()}::timestamptz
      AND n.created_at::timestamptz < ${windowEnd.toISOString()}::timestamptz
      AND e.event_type IN ('open', 'tap')
  `);
  return Number(((res as any).rows?.[0]?.opened) ?? 0);
}

export async function latestBroadcast(sellerId: string) {
  const [row] = await db.select().from(sellerPushBroadcasts)
    .where(eq(sellerPushBroadcasts.sellerId, sellerId))
    .orderBy(desc(sellerPushBroadcasts.createdAt)).limit(1);
  return row ?? null;
}

