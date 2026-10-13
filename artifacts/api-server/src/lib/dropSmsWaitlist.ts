/**
 * Drop SMS waitlist: which brand/drop the public page brandthread.app/@handle/drop
 * shows, the consent copy, signups, and the once-only "drop is live" text blast.
 *
 * Blast claim boundary mirrors lib/dropBroadcast.ts: a row-locked transaction
 * rechecks that the drop is still active and live, then inserts the unique
 * per-drop claim. Only the inserting caller sends.
 */
import { and, asc, eq, gt, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { db, drops, dropSmsBlasts, dropSmsWaitlist, products, users } from "@workspace/db";
import { CANONICAL_WEB_ORIGIN } from "./webOrigin";
import { getSmsConfig, sendSms } from "./sms/index";

export const HANDLE_RE = /^[A-Za-z0-9_]{3,30}$/;

export interface PublicBrand {
  sellerId: string;
  name: string;
  handle: string;
  avatarUrl: string | null;
}

export interface WaitlistDrop {
  id: string;
  name: string;
  releaseAt: string | null;
  heroImageUrl: string | null;
  launchTimezone: string;
}

export type WaitlistState = "upcoming" | "live" | "none";

function httpsOnly(url: unknown): string | null {
  return typeof url === "string" && url.startsWith("https://") ? url : null;
}

export function brandDisplayName(row: { brandName?: string | null; displayName?: string | null; username?: string | null }): string {
  return (row.brandName || row.displayName || (row.username ? `@${row.username}` : "") || "Brandthread brand").trim();
}

/** Public, visible seller for a handle (case-insensitive), or null. */
export async function resolvePublicBrand(handle: string): Promise<PublicBrand | null> {
  if (!HANDLE_RE.test(handle)) return null;
  const [row] = await db.select({
    clerkId: users.clerkId,
    username: users.username,
    brandName: users.brandName,
    displayName: users.displayName,
    accountType: users.accountType,
    avatarUrl: users.avatarUrl,
    profileImageUrl: users.profileImageUrl,
    deletedAt: users.deletedAt,
    deletionRequestedAt: users.deletionRequestedAt,
    suspendedAt: users.suspendedAt,
  }).from(users).where(sql`lower(${users.username}) = ${handle.toLowerCase()}`).limit(1);
  if (!row || !row.username) return null;
  if (row.deletedAt || row.deletionRequestedAt || row.suspendedAt) return null;
  if (row.accountType !== "seller" && row.accountType !== "both") return null;
  return {
    sellerId: row.clerkId,
    name: brandDisplayName(row),
    handle: row.username,
    avatarUrl: httpsOnly(row.profileImageUrl) ?? httpsOnly(row.avatarUrl),
  };
}

/**
 * The drop the page shows: a currently live public drop wins (buyers should
 * shop it now), otherwise the soonest upcoming one. Same visibility rules as
 * GET /api/public/drops?section=live|upcoming.
 */
export async function findWaitlistDrop(sellerId: string, now = new Date()): Promise<{ state: WaitlistState; drop: WaitlistDrop | null }> {
  const select = {
    id: drops.id,
    name: drops.name,
    releaseAt: drops.releaseAt,
    heroImageUrl: drops.heroImageUrl,
    launchTimezone: drops.launchTimezone,
  };
  const [live] = await db.select(select).from(drops).where(and(
    eq(drops.ownerId, sellerId),
    eq(drops.status, "active"),
    isNotNull(drops.releaseAt),
    lte(drops.releaseAt, now),
    or(isNull(drops.endsAt), gt(drops.endsAt, now)),
  )).orderBy(asc(drops.releaseAt)).limit(1);
  const [upcoming] = live ? [] : await db.select(select).from(drops).where(and(
    eq(drops.ownerId, sellerId),
    eq(drops.status, "active"),
    isNotNull(drops.releaseAt),
    gt(drops.releaseAt, now),
  )).orderBy(asc(drops.releaseAt)).limit(1);
  const row = live ?? upcoming;
  if (!row) return { state: "none", drop: null };

  let hero = httpsOnly(row.heroImageUrl);
  if (!hero) {
    const [product] = await db.select({ images: products.images }).from(products)
      .where(and(eq(products.dropId, row.id), eq(products.status, "active"), isNull(products.deletedAt)))
      .orderBy(asc(products.createdAt)).limit(1);
    const images = Array.isArray(product?.images) ? (product.images as unknown[]) : [];
    hero = images.map(httpsOnly).find(Boolean) ?? null;
  }
  return {
    state: live ? "live" : "upcoming",
    drop: {
      id: row.id,
      name: row.name,
      releaseAt: row.releaseAt ? row.releaseAt.toISOString() : null,
      heroImageUrl: hero,
      launchTimezone: row.launchTimezone || "UTC",
    },
  };
}

/** The exact consent line shown on the page and stored with the signup. */
export function buildConsentText(brandName: string, hasDrop: boolean): string {
  return `By joining you agree to get texts from ${brandName} via Brandthread about ${hasDrop ? "this drop" : "their next drop"}. Msg & data rates may apply. Reply STOP to opt out.`;
}

export function buildBlastMessage(brandName: string, dropName: string, dropId: string): string {
  return `${brandName}: ${dropName} is live. Shop now: ${CANONICAL_WEB_ORIGIN}/drops/${dropId} Reply STOP to opt out.`;
}

/** Insert or re-consent (clears an earlier opt-out) one waitlist entry. */
export async function joinWaitlist(input: {
  sellerId: string;
  dropId: string | null;
  phoneE164: string;
  consentText: string;
}): Promise<void> {
  const now = new Date();
  await db.insert(dropSmsWaitlist).values({
    sellerId: input.sellerId,
    dropId: input.dropId,
    phoneE164: input.phoneE164,
    consentText: input.consentText,
    consentAt: now,
  }).onConflictDoUpdate({
    target: [dropSmsWaitlist.sellerId, dropSmsWaitlist.phoneE164],
    set: {
      dropId: input.dropId,
      consentText: input.consentText,
      consentAt: now,
      optedOutAt: null,
      updatedAt: now,
    },
  });
}

export async function activeWaitlistCount(sellerId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(dropSmsWaitlist)
    .where(and(eq(dropSmsWaitlist.sellerId, sellerId), isNull(dropSmsWaitlist.optedOutAt)));
  return Number(row?.n ?? 0);
}

/** STOP-family keywords opt the number out of every brand (shared sender). */
export const OPT_OUT_KEYWORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
export const OPT_IN_KEYWORDS = new Set(["START", "UNSTOP"]);

export async function applyInboundKeyword(fromE164: string, body: string): Promise<"opted_out" | "opted_in" | null> {
  const keyword = body.trim().toUpperCase();
  const now = new Date();
  if (OPT_OUT_KEYWORDS.has(keyword)) {
    await db.update(dropSmsWaitlist).set({ optedOutAt: now, updatedAt: now })
      .where(and(eq(dropSmsWaitlist.phoneE164, fromE164), isNull(dropSmsWaitlist.optedOutAt)));
    return "opted_out";
  }
  if (OPT_IN_KEYWORDS.has(keyword)) {
    await db.update(dropSmsWaitlist).set({ optedOutAt: null, updatedAt: now })
      .where(and(eq(dropSmsWaitlist.phoneE164, fromE164), isNotNull(dropSmsWaitlist.optedOutAt)));
    return "opted_in";
  }
  return null;
}

export interface DropSmsBlastResult {
  recipients: number;
  sent: number;
  failed: number;
}

export type DeliverDropSmsBlastOutcome =
  | { kind: "sent"; result: DropSmsBlastResult }
  | { kind: "not_configured" }
  | { kind: "not_eligible" }
  | { kind: "already_sent" };

const SEND_CONCURRENCY = 5;

/** Run `worker` over `items` with at most `limit` in flight. */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Live = active, released, not ended. */
export function isDropLive(drop: { status: string; releaseAt: Date | null; endsAt: Date | null }, now = new Date()): boolean {
  if (drop.status !== "active") return false;
  if (drop.releaseAt && drop.releaseAt.getTime() > now.getTime()) return false;
  if (drop.endsAt && drop.endsAt.getTime() <= now.getTime()) return false;
  return true;
}

export async function deliverDropSmsBlast(dropId: string, sellerId: string): Promise<DeliverDropSmsBlastOutcome> {
  const config = getSmsConfig();
  if (!config) return { kind: "not_configured" };

  const claim = await db.transaction(async (tx) => {
    const [drop] = await tx.select({
      id: drops.id, name: drops.name, status: drops.status, releaseAt: drops.releaseAt, endsAt: drops.endsAt,
    }).from(drops)
      .where(and(eq(drops.id, dropId), eq(drops.ownerId, sellerId)))
      .for("update")
      .limit(1);
    if (!drop || !isDropLive(drop)) return { kind: "not_eligible" as const };
    const [inserted] = await tx.insert(dropSmsBlasts)
      .values({ dropId: drop.id, sellerId, status: "sending" })
      .onConflictDoNothing()
      .returning({ id: dropSmsBlasts.id });
    if (!inserted) return { kind: "already_sent" as const };
    return { kind: "claimed" as const, claimId: inserted.id, drop };
  });
  if (claim.kind !== "claimed") return claim;

  const [seller] = await db.select({
    brandName: users.brandName, displayName: users.displayName, username: users.username,
  }).from(users).where(eq(users.clerkId, sellerId)).limit(1);
  const message = buildBlastMessage(brandDisplayName(seller ?? {}), claim.drop.name, claim.drop.id);

  const recipients = await db.select({ phone: dropSmsWaitlist.phoneE164 }).from(dropSmsWaitlist)
    .where(and(eq(dropSmsWaitlist.sellerId, sellerId), isNull(dropSmsWaitlist.optedOutAt)));
  const phones = [...new Set(recipients.map((r) => r.phone))];

  const results = await mapWithConcurrency(phones, SEND_CONCURRENCY, (phone) => sendSms(phone, message, config));
  const sent = results.filter((r) => r.ok).length;
  const failed = results.length - sent;

  if (phones.length > 0 && sent === 0) {
    // Nothing reached anyone (bad credentials, provider outage): release the
    // claim so the seller can retry without anyone getting a duplicate.
    await db.delete(dropSmsBlasts).where(eq(dropSmsBlasts.id, claim.claimId));
  } else {
    await db.update(dropSmsBlasts).set({
      status: "sent", recipientCount: phones.length, sentCount: sent, failedCount: failed, completedAt: new Date(),
    }).where(eq(dropSmsBlasts.id, claim.claimId));
  }
  return { kind: "sent", result: { recipients: phones.length, sent, failed } };
}
