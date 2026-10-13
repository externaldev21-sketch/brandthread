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
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
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
/**
 * Past-buyer messages (audience 'past_buyers'): buyers with a non-cancelled
 * order from the seller. Their own cap, separate from the follower push:
 * one per seller per rolling 7 days, to at most PAST_BUYER_RECIPIENT_CAP
 * people (most recent buyers first). The device push is promotional, so it
 * also needs the buyer's promotional-push opt-in (lib/pushPolicy.ts).
 */
export const PAST_BUYER_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const PAST_BUYER_RECIPIENT_CAP = 2000;
export type BroadcastAudience = "followers" | "past_buyers";
export const BROADCAST_AUDIENCES: readonly BroadcastAudience[] = ["followers", "past_buyers"];

export function audienceWindowMs(audience: BroadcastAudience): number {
  return audience === "past_buyers" ? PAST_BUYER_WINDOW_MS : BROADCAST_WINDOW_MS;
}

/** Missing/empty means followers (the original behaviour); anything else unknown is rejected. */
export function parseAudience(raw: unknown): BroadcastAudience | null {
  if (raw === undefined || raw === null || raw === "") return "followers";
  return BROADCAST_AUDIENCES.includes(raw as BroadcastAudience) ? (raw as BroadcastAudience) : null;
}
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
  windowMs: number = BROADCAST_WINDOW_MS,
): { canSend: boolean; nextAt: Date | null; retryAfterSec: number } {
  if (!lastSentAt) return { canSend: true, nextAt: null, retryAfterSec: 0 };
  const nextAt = new Date(lastSentAt.getTime() + windowMs);
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
/**
 * The opt-out filter shared by both audiences, for a candidate id column
 * `idCol` joined to `users u`. One definition so the past-buyer audience can
 * never be looser than the follower one.
 */
function eligibleRecipientSql(idCol: SQL, sellerId: string): SQL {
  return sql`(
    ${idCol} <> ${sellerId}
    AND (u.id IS NULL OR (
      u.deleted_at IS NULL
      AND u.suspended_at IS NULL
      AND u.push_enabled IS NOT FALSE
      AND COALESCE(u.notification_preferences->>'seller_announcements', 'true') <> 'false'
    ))
    AND NOT EXISTS (
      SELECT 1 FROM blocks b
      WHERE (b.blocker_id = ${idCol} AND b.blocked_id = ${sellerId})
         OR (b.blocker_id = ${sellerId} AND b.blocked_id = ${idCol})
    )
    AND NOT EXISTS (
      SELECT 1 FROM activity_mutes m
      WHERE m.user_id = ${idCol} AND m.mute_key = ${"actor:" + sellerId}
    )
  )`;
}

export async function resolveAudience(sellerId: string): Promise<Audience> {
  const res = await db.execute(sql`
    SELECT f.follower_id AS id, ${eligibleRecipientSql(sql`f.follower_id`, sellerId)} AS ok
    FROM follows f
    LEFT JOIN users u ON u.clerk_id = f.follower_id
    WHERE f.following_id = ${sellerId}
  `);
  const rows = ((res as any).rows ?? []) as { id: string; ok: boolean }[];
  const recipientIds = rows.filter((r) => r.ok).map((r) => r.id);
  return { followers: rows.length, recipientIds, skipped: rows.length - recipientIds.length };
}

export interface PastBuyerAudience {
  /** Signed-in buyers with at least one non-cancelled order from the seller. */
  buyers: number;
  /** Eligible after opt-outs, before the recipient cap. */
  eligible: number;
  /** Who will get it: the most recent `cap` eligible buyers. */
  recipientIds: string[];
  /** Opted out (push off, announcements off, blocked, muted, deleted/suspended). */
  skipped: number;
  cap: number;
}

/**
 * Past buyers who should receive a message. Guest checkouts have no account to
 * notify, so only orders with a buyer_id count. Same opt-outs as followers;
 * when more than `cap` qualify, the most recent buyers are kept.
 */
export async function resolvePastBuyerAudience(
  sellerId: string,
  cap: number = PAST_BUYER_RECIPIENT_CAP,
): Promise<PastBuyerAudience> {
  const res = await db.execute(sql`
    WITH pb AS (
      SELECT o.buyer_id AS id, MAX(o.created_at) AS last_at
      FROM orders o
      WHERE o.owner_id = ${sellerId}
        AND o.status <> 'cancelled'
        AND o.buyer_id IS NOT NULL
        AND o.buyer_id <> ${sellerId}
      GROUP BY o.buyer_id
    )
    SELECT pb.id, ${eligibleRecipientSql(sql`pb.id`, sellerId)} AS ok
    FROM pb
    LEFT JOIN users u ON u.clerk_id = pb.id
    ORDER BY pb.last_at DESC, pb.id
  `);
  const rows = ((res as any).rows ?? []) as { id: string; ok: boolean }[];
  const eligibleIds = rows.filter((r) => r.ok).map((r) => r.id);
  return {
    buyers: rows.length,
    eligible: eligibleIds.length,
    recipientIds: eligibleIds.slice(0, cap),
    skipped: rows.length - eligibleIds.length,
    cap,
  };
}

/** Audience summary the API returns (no ids). */
export async function audienceSummary(sellerId: string, audience: BroadcastAudience) {
  if (audience === "past_buyers") {
    const a = await resolvePastBuyerAudience(sellerId);
    return { buyers: a.buyers, eligible: a.eligible, recipients: a.recipientIds.length, cap: a.cap };
  }
  const a = await resolveAudience(sellerId);
  return { followers: a.followers, recipients: a.recipientIds.length };
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
  audience: BroadcastAudience = "followers",
): Promise<ClaimResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"seller_push_broadcast:" + sellerId}))`);
    const [last] = await tx.select({ createdAt: sellerPushBroadcasts.createdAt })
      .from(sellerPushBroadcasts)
      .where(and(eq(sellerPushBroadcasts.sellerId, sellerId), eq(sellerPushBroadcasts.audience, audience)))
      .orderBy(desc(sellerPushBroadcasts.createdAt))
      .limit(1);
    const window = broadcastWindow(last?.createdAt, now, audienceWindowMs(audience));
    if (!window.canSend) return { ok: false as const, nextAt: window.nextAt!, retryAfterSec: window.retryAfterSec };
    const [row] = await tx.insert(sellerPushBroadcasts).values({
      sellerId,
      audience,
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
  audienceType: BroadcastAudience = "followers",
): Promise<BroadcastDelivery> {
  const [audience, identity] = await Promise.all([
    audienceType === "past_buyers" ? resolvePastBuyerAudience(sellerId) : resolveAudience(sellerId),
    sellerIdentity(sellerId),
  ]);
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
      // Seller-to-follower marketing: only followers who opted in to
      // promotional notifications get the push (App Store 4.5.4, QA-0148).
      pushKind: "promotional",
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
      // A message to past buyers is marketing: the device push also needs the
      // buyer's promotional-push opt-in (Guideline 4.5.4, lib/pushPolicy.ts).
      ...(audienceType === "past_buyers" ? { pushKind: "promotional" as const } : {}),
    })));
    for (const r of results) {
      if (r.status === "fulfilled") sent += 1;
      else { failed += 1; logger.warn({ err: r.reason, audience: audienceType }, "Seller broadcast delivery failed for a recipient"); }
    }
  }

  await db.update(sellerPushBroadcasts)
    .set({ status: "sent", sentCount: sent, completedAt: new Date() })
    .where(eq(sellerPushBroadcasts.id, claimId));
  return { recipients: audience.recipientIds.length, sent, failed, skipped: audience.skipped };
}

// ─── DB: results ─────────────────────────────────────────────────────────────

/**
 * Distinct recipients who opened/tapped a broadcast, read from the same
 * notification_events pipeline the app reports into. A seller sends at most
 * one broadcast per audience per window, so feed rows of type
 * seller_broadcast created in [createdAt, createdAt + window) with the same
 * title and body belong to exactly this broadcast (the text match keeps a
 * follower push and a past-buyer message sent in the same window apart).
 */
export async function countOpens(
  sellerId: string,
  createdAt: Date,
  match?: { title: string; body: string; audience?: BroadcastAudience },
): Promise<number> {
  const windowEnd = new Date(createdAt.getTime() + audienceWindowMs(match?.audience ?? "followers"));
  const textMatch = match ? sql`AND n.title = ${match.title} AND n.body = ${match.body}` : sql``;
  const res = await db.execute(sql`
    SELECT COUNT(DISTINCT e.user_id)::int AS opened
    FROM ${notificationEvents} e
    JOIN ${notificationsFeed} n ON n.id::text = e.notification_id AND n.user_id = e.user_id
    WHERE n.actor_id = ${sellerId}
      AND n.type = ${BROADCAST_FEED_TYPE}
      AND n.created_at::timestamptz >= ${createdAt.toISOString()}::timestamptz
      AND n.created_at::timestamptz < ${windowEnd.toISOString()}::timestamptz
      AND e.event_type IN ('open', 'tap')
      ${textMatch}
  `);
  return Number(((res as any).rows?.[0]?.opened) ?? 0);
}

export async function latestBroadcast(sellerId: string, audience: BroadcastAudience = "followers") {
  const [row] = await db.select().from(sellerPushBroadcasts)
    .where(and(eq(sellerPushBroadcasts.sellerId, sellerId), eq(sellerPushBroadcasts.audience, audience)))
    .orderBy(desc(sellerPushBroadcasts.createdAt)).limit(1);
  return row ?? null;
}

