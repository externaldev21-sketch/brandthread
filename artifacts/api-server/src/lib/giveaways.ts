/**
 * Giveaways: entry derivation, rules template and an auditable random draw.
 *
 * Entries are never self-reported. They are derived from real `follows` and
 * `post_comments` rows (materialised into giveaway_entries at draw time and
 * whenever an entrant views the giveaway). One entry per person.
 */
import crypto from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  follows,
  giveawayDraws,
  giveawayEntries,
  giveaways,
  giveawayWinners,
  postComments,
  users,
} from "@workspace/db";
import { publishNotification } from "../routes/notifications-feed";
import { evaluateContent } from "./contentModerator";
import { logger } from "./logger";

export const SHARE_BASE_URL = "https://brandthread.app/g/";

export type GiveawayPhase = "upcoming" | "live" | "ended" | "drawn" | "cancelled";

// ─── Pure helpers ────────────────────────────────────────────────────────────

export function giveawayPhase(
  g: { status: string; startsAt: Date; endsAt: Date },
  now: Date = new Date(),
): GiveawayPhase {
  if (g.status === "cancelled") return "cancelled";
  if (g.status === "drawn") return "drawn";
  if (now.getTime() < g.startsAt.getTime()) return "upcoming";
  if (now.getTime() < g.endsAt.getTime()) return "live";
  return "ended";
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function generateShareCode(length = 8, randomInt: (max: number) => number = crypto.randomInt): string {
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export interface RulesTemplateInput {
  sellerName: string;
  prizeText: string;
  startsAt: Date;
  endsAt: Date;
  winnerCount: number;
  region?: string;
  eligibility?: string;
  postEntry: boolean;
}

/**
 * App Store 5.3.3 (and Google Play's contest policy): official rules must say
 * Apple / Google are not sponsors. Always part of the stored rules, whatever
 * the seller edits (QA-0100).
 */
export const PLATFORM_SPONSOR_DISCLAIMER =
  "Apple Inc. and Google LLC are not sponsors of, and are not involved in, this giveaway in any way.";

/** The rules exactly as stored: the seller's text plus the platform disclaimer once. */
export function withPlatformDisclaimer(rulesText: string): string {
  const text = rulesText.trim();
  if (text.includes(PLATFORM_SPONSOR_DISCLAIMER)) return text;
  return `${text}\n${PLATFORM_SPONSOR_DISCLAIMER}`;
}

/** Editable starting point for the rules field. Always states "No purchase necessary". */
export function buildRulesTemplate(i: RulesTemplateInput): string {
  const region = i.region?.trim() || "the regions where Brandthread is available";
  const eligibility = i.eligibility?.trim() || "Open to individuals aged 18 or older (or the age of majority where they live)";
  const how = i.postEntry
    ? `Follow ${i.sellerName} on Brandthread and comment on the featured post.`
    : `Follow ${i.sellerName} on Brandthread.`;
  const winners = i.winnerCount === 1 ? "1 winner" : `${i.winnerCount} winners`;
  return [
    "NO PURCHASE NECESSARY TO ENTER OR WIN. A purchase will not improve your chances of winning.",
    "",
    `Sponsor: ${i.sellerName}. This giveaway is not sponsored, endorsed or administered by Brandthread.`,
    PLATFORM_SPONSOR_DISCLAIMER,
    `Giveaway period: ${fmtDate(i.startsAt)} to ${fmtDate(i.endsAt)} (UTC).`,
    `Eligibility: ${eligibility}. Open in ${region}. The sponsor and blocked accounts are not eligible.`,
    `How to enter: ${how} Each person gets one entry. Duplicate, automated or fake accounts are disqualified.`,
    `Prize: ${i.prizeText}.`,
    `Winner selection: ${winners} will be chosen at random from all eligible entries after the giveaway ends. Winners are notified in the app. If a winner cannot be reached or is ineligible, another winner may be drawn.`,
    "Void where prohibited by law.",
  ].join("\n");
}

/** SHA-256 over the sorted eligible ids, so an audit can re-derive the exact pool. */
export function hashEligible(ids: readonly string[]): string {
  return crypto.createHash("sha256").update([...ids].sort().join("\n")).digest("hex");
}

/**
 * Uniform draw without replacement (partial Fisher-Yates with rejection-free
 * crypto.randomInt). Never returns a duplicate; returns fewer than `count`
 * when the pool is smaller.
 */
export function pickWinners<T>(
  pool: readonly T[],
  count: number,
  randomInt: (max: number) => number = crypto.randomInt,
): T[] {
  const arr = [...pool];
  const n = Math.min(Math.max(0, Math.floor(count)), arr.length);
  for (let i = 0; i < n; i++) {
    const j = i + randomInt(arr.length - i);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr.slice(0, n);
}

export interface CandidateComment {
  id: string;
  body: string;
  createdAt: Date;
}

/** A comment counts when it is real text: not empty, not only @mentions / links. */
export function isQualifyingComment(body: string): boolean {
  const stripped = body.replace(/https?:\/\/\S+/gi, "").replace(/@[\w.]+/g, "").replace(/\s+/g, "");
  return stripped.length >= 2;
}

export type ExcludedReason =
  | "seller"
  | "blocked"
  | "inactive_account"
  | "not_following"
  | "no_comment"
  | "spam_comment";

export interface EntryDecision {
  userId: string;
  followed: boolean;
  commented: boolean;
  commentId: string | null;
  eligible: boolean;
  excludedReason: ExcludedReason | null;
}

export interface ClassifyInput {
  sellerId: string;
  userIds: readonly string[];
  following: ReadonlySet<string>;
  blocked: ReadonlySet<string>;
  inactive: ReadonlySet<string>;
  /** Comments by user on the giveaway post; omit when the giveaway is follow-only. */
  comments: ReadonlyMap<string, readonly CandidateComment[]> | null;
  startsAt: Date;
  endsAt: Date;
}

/** One decision per distinct person, in sorted order, deterministic for a given input. */
export function classifyEntries(input: ClassifyInput): EntryDecision[] {
  const seen = new Set<string>();
  const out: EntryDecision[] = [];
  for (const userId of [...input.userIds].sort()) {
    if (seen.has(userId)) continue; // one entry per person
    seen.add(userId);
    const followed = input.following.has(userId);
    const userComments = input.comments?.get(userId) ?? [];
    const inWindow = userComments.filter((c) =>
      c.createdAt.getTime() >= input.startsAt.getTime() && c.createdAt.getTime() <= input.endsAt.getTime());
    const good = inWindow.filter((c) => isQualifyingComment(c.body))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
    const commented = !!good;

    let excludedReason: ExcludedReason | null = null;
    if (userId === input.sellerId) excludedReason = "seller";
    else if (input.blocked.has(userId)) excludedReason = "blocked";
    else if (input.inactive.has(userId)) excludedReason = "inactive_account";
    else if (!followed) excludedReason = "not_following";
    else if (input.comments) {
      if (inWindow.length === 0) excludedReason = "no_comment";
      else if (!commented) excludedReason = "spam_comment";
    }
    out.push({
      userId, followed, commented,
      commentId: good?.id ?? null,
      eligible: excludedReason === null,
      excludedReason,
    });
  }
  return out;
}

// ─── Input validation ────────────────────────────────────────────────────────

export interface GiveawayInput {
  title: string;
  prizeText: string;
  productId: string | null;
  postId: string | null;
  startsAt: Date;
  endsAt: Date;
  rulesText: string;
  eligibility: string;
  region: string;
  winnerCount: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_GIVEAWAY_DAYS = 90;

export function validateGiveawayInput(raw: unknown, now: Date = new Date(), opts: { requireFutureEnd?: boolean } = {}):
  | { ok: true; value: GiveawayInput }
  | { ok: false; error: string } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const title = str(r.title);
  const prizeText = str(r.prizeText);
  const rawRules = str(r.rulesText);
  const eligibility = str(r.eligibility);
  const region = str(r.region);
  if (!title) return { ok: false, error: "A title is required." };
  if (title.length > 80) return { ok: false, error: "Title must be 80 characters or fewer." };
  if (!prizeText) return { ok: false, error: "Describe the prize." };
  if (prizeText.length > 200) return { ok: false, error: "Prize must be 200 characters or fewer." };
  if (!rawRules) return { ok: false, error: "Official rules are required." };
  if (rawRules.length > 5000) return { ok: false, error: "Rules must be 5000 characters or fewer." };
  const rulesText = withPlatformDisclaimer(rawRules);
  if (eligibility.length > 300) return { ok: false, error: "Eligibility must be 300 characters or fewer." };
  if (region.length > 100) return { ok: false, error: "Region must be 100 characters or fewer." };

  const winnerCount = Number(r.winnerCount ?? 1);
  if (!Number.isInteger(winnerCount) || winnerCount < 1 || winnerCount > 50) {
    return { ok: false, error: "Winners must be a whole number from 1 to 50." };
  }
  const startsAt = new Date(String(r.startsAt ?? ""));
  const endsAt = new Date(String(r.endsAt ?? ""));
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    return { ok: false, error: "Start and end dates are required." };
  }
  if (endsAt.getTime() <= startsAt.getTime()) return { ok: false, error: "The end must be after the start." };
  if (opts.requireFutureEnd !== false && endsAt.getTime() <= now.getTime()) {
    return { ok: false, error: "The end must be in the future." };
  }
  if (endsAt.getTime() - startsAt.getTime() > MAX_GIVEAWAY_DAYS * 86_400_000) {
    return { ok: false, error: `A giveaway can run for at most ${MAX_GIVEAWAY_DAYS} days.` };
  }
  const productId = r.productId ? String(r.productId) : null;
  const postId = r.postId ? String(r.postId) : null;
  if (productId && !UUID_RE.test(productId)) return { ok: false, error: "Invalid product." };
  if (postId && !UUID_RE.test(postId)) return { ok: false, error: "Invalid post." };

  const decision = evaluateContent([title, prizeText, rulesText, eligibility, region].join("\n"), "public");
  if (decision.action !== "allow") {
    return { ok: false, error: "This text breaks the community guidelines. Edit it and try again." };
  }
  return { ok: true, value: { title, prizeText, productId, postId, startsAt, endsAt, rulesText, eligibility, region, winnerCount } };
}

// ─── DB: entries ─────────────────────────────────────────────────────────────

type GiveawayRow = typeof giveaways.$inferSelect;

async function loadSignals(g: GiveawayRow, candidateIds: string[]) {
  if (candidateIds.length === 0) {
    return { following: new Set<string>(), blocked: new Set<string>(), inactive: new Set<string>() };
  }
  const [followRows, blockRows, inactiveRows] = await Promise.all([
    db.select({ id: follows.followerId }).from(follows)
      .where(and(eq(follows.followingId, g.sellerId), inArray(follows.followerId, candidateIds))),
    db.execute(sql`
      SELECT blocker_id, blocked_id FROM blocks
      WHERE (blocker_id = ${g.sellerId} AND blocked_id IN (${sql.join(candidateIds.map((i) => sql`${i}`), sql`, `)}))
         OR (blocked_id = ${g.sellerId} AND blocker_id IN (${sql.join(candidateIds.map((i) => sql`${i}`), sql`, `)}))`),
    db.select({ id: users.clerkId }).from(users)
      .where(and(
        inArray(users.clerkId, candidateIds),
        sql`(${users.deletedAt} IS NOT NULL OR ${users.suspendedAt} IS NOT NULL)`,
      )),
  ]);
  const blocked = new Set<string>();
  for (const b of ((blockRows as any).rows ?? []) as { blocker_id: string; blocked_id: string }[]) {
    blocked.add(b.blocker_id === g.sellerId ? b.blocked_id : b.blocker_id);
  }
  return {
    following: new Set(followRows.map((r) => r.id)),
    blocked,
    inactive: new Set(inactiveRows.map((r) => r.id)),
  };
}

async function loadComments(g: GiveawayRow, userIds?: string[]) {
  if (!g.postId) return null;
  const rows = await db.select({
    id: postComments.id, authorId: postComments.authorId, body: postComments.body, createdAt: postComments.createdAt,
  }).from(postComments)
    .where(and(
      eq(postComments.postId, g.postId),
      eq(postComments.moderationStatus, "visible"),
      ...(userIds ? [inArray(postComments.authorId, userIds)] : []),
    ));
  const map = new Map<string, CandidateComment[]>();
  for (const c of rows) {
    const list = map.get(c.authorId) ?? [];
    list.push({ id: c.id, body: c.body, createdAt: c.createdAt });
    map.set(c.authorId, list);
  }
  return map;
}

async function upsertEntries(giveawayId: string, decisions: EntryDecision[]) {
  const now = new Date();
  for (let i = 0; i < decisions.length; i += 500) {
    const chunk = decisions.slice(i, i + 500);
    await db.insert(giveawayEntries).values(chunk.map((d) => ({
      giveawayId,
      userId: d.userId,
      followed: d.followed,
      commented: d.commented,
      commentId: d.commentId,
      eligible: d.eligible,
      excludedReason: d.excludedReason,
      materialisedAt: now,
    }))).onConflictDoUpdate({
      target: [giveawayEntries.giveawayId, giveawayEntries.userId],
      set: {
        followed: sql`excluded.followed`,
        commented: sql`excluded.commented`,
        commentId: sql`excluded.comment_id`,
        eligible: sql`excluded.eligible`,
        excludedReason: sql`excluded.excluded_reason`,
        materialisedAt: sql`excluded.materialised_at`,
      },
    });
  }
}

/** Recompute every entry for a giveaway from the live follows/comments tables. */
export async function materialiseAllEntries(g: GiveawayRow): Promise<EntryDecision[]> {
  const comments = await loadComments(g);
  const existing = await db.select({ userId: giveawayEntries.userId }).from(giveawayEntries)
    .where(eq(giveawayEntries.giveawayId, g.id));
  const candidateSet = new Set<string>(existing.map((e) => e.userId));
  if (comments) {
    for (const uid of comments.keys()) candidateSet.add(uid);
  } else {
    const followers = await db.select({ id: follows.followerId }).from(follows)
      .where(eq(follows.followingId, g.sellerId));
    for (const f of followers) candidateSet.add(f.id);
  }
  const candidateIds = [...candidateSet];
  const signals = await loadSignals(g, candidateIds);
  const decisions = classifyEntries({
    sellerId: g.sellerId, userIds: candidateIds, comments,
    startsAt: g.startsAt, endsAt: g.endsAt, ...signals,
  });
  await upsertEntries(g.id, decisions);
  return decisions;
}

/** Recompute a single person's entry (used when an entrant views the giveaway). */
export async function materialiseEntryFor(g: GiveawayRow, userId: string): Promise<EntryDecision> {
  const comments = await loadComments(g, [userId]);
  const signals = await loadSignals(g, [userId]);
  const [decision] = classifyEntries({
    sellerId: g.sellerId, userIds: [userId], comments,
    startsAt: g.startsAt, endsAt: g.endsAt, ...signals,
  });
  // Don't rewrite the entry pool once the draw is final.
  if (g.status === "open") await upsertEntries(g.id, [decision!]);
  return decision!;
}

// ─── DB: draw ────────────────────────────────────────────────────────────────

export class GiveawayError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

type RandomInt = (max: number) => number;

async function lockGiveaway(tx: any, giveawayId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"giveaway:" + giveawayId}))`);
}

async function eligibleIds(giveawayId: string): Promise<string[]> {
  const rows = await db.select({ userId: giveawayEntries.userId }).from(giveawayEntries)
    .where(and(eq(giveawayEntries.giveawayId, giveawayId), eq(giveawayEntries.eligible, true)))
    .orderBy(asc(giveawayEntries.userId));
  return rows.map((r) => r.userId);
}

export async function drawGiveaway(
  giveawayId: string,
  sellerId: string,
  opts: { now?: Date; randomInt?: RandomInt } = {},
) {
  const now = opts.now ?? new Date();
  const rand = opts.randomInt ?? crypto.randomInt;

  const [g0] = await db.select().from(giveaways)
    .where(and(eq(giveaways.id, giveawayId), eq(giveaways.sellerId, sellerId))).limit(1);
  if (!g0) throw new GiveawayError(404, "NOT_FOUND", "Giveaway not found");

  const result = await db.transaction(async (tx) => {
    await lockGiveaway(tx, giveawayId);
    const [g] = await tx.select().from(giveaways).where(eq(giveaways.id, giveawayId)).limit(1);
    if (!g || g.sellerId !== sellerId) throw new GiveawayError(404, "NOT_FOUND", "Giveaway not found");
    if (g.status === "drawn") throw new GiveawayError(409, "ALREADY_DRAWN", "Winners have already been drawn. Use redraw to replace a winner.");
    if (g.status === "cancelled") throw new GiveawayError(409, "CANCELLED", "This giveaway was cancelled.");
    if (now.getTime() < g.endsAt.getTime()) throw new GiveawayError(409, "NOT_ENDED", "The giveaway hasn't ended yet. End it early or wait for the end time.");
    return g;
  });

  // Materialise from real follows + comments, then draw from the eligible pool.
  await materialiseAllEntries(result);

  return db.transaction(async (tx) => {
    await lockGiveaway(tx, giveawayId);
    const [g] = await tx.select().from(giveaways).where(eq(giveaways.id, giveawayId)).limit(1);
    if (!g || g.status !== "open") throw new GiveawayError(409, "ALREADY_DRAWN", "Winners have already been drawn.");

    const eligibleRows = await tx.select({ userId: giveawayEntries.userId }).from(giveawayEntries)
      .where(and(eq(giveawayEntries.giveawayId, giveawayId), eq(giveawayEntries.eligible, true)))
      .orderBy(asc(giveawayEntries.userId));
    const pool = eligibleRows.map((r) => r.userId);
    if (pool.length === 0) throw new GiveawayError(409, "NO_ELIGIBLE_ENTRIES", "There are no eligible entries to draw from.");

    const winnerIds = pickWinners(pool, g.winnerCount, rand);
    const [draw] = await tx.insert(giveawayDraws).values({
      giveawayId, drawNumber: 1, eligibleCount: pool.length, eligibleHash: hashEligible(pool),
      winnerIds, drawnBy: sellerId, drawnAt: now,
    }).returning();
    const winners = await tx.insert(giveawayWinners).values(winnerIds.map((userId, i) => ({
      giveawayId, drawId: draw!.id, userId, position: i + 1,
    }))).returning();
    await tx.update(giveaways).set({ status: "drawn", drawnAt: now, updatedAt: now }).where(eq(giveaways.id, giveawayId));
    return { giveaway: g, draw: draw!, winners };
  }).then(async (res) => {
    await notifyWinners(res.giveaway, res.winners.map((w) => w.id));
    return res;
  });
}

/**
 * Replace one winner (e.g. unreachable or ineligible). The previous winner is
 * kept on record as "replaced" with the reason; the new winner is drawn from
 * eligible entrants who have never won this giveaway.
 */
export async function redrawWinner(
  giveawayId: string,
  sellerId: string,
  winnerId: string,
  reason: string,
  opts: { now?: Date; randomInt?: RandomInt } = {},
) {
  const now = opts.now ?? new Date();
  const rand = opts.randomInt ?? crypto.randomInt;
  const trimmed = reason.trim();
  if (trimmed.length < 3) throw new GiveawayError(400, "REASON_REQUIRED", "Give a reason for the redraw.");
  if (trimmed.length > 300) throw new GiveawayError(400, "REASON_TOO_LONG", "Reason must be 300 characters or fewer.");

  const [g0] = await db.select().from(giveaways)
    .where(and(eq(giveaways.id, giveawayId), eq(giveaways.sellerId, sellerId))).limit(1);
  if (!g0) throw new GiveawayError(404, "NOT_FOUND", "Giveaway not found");
  if (g0.status !== "drawn") throw new GiveawayError(409, "NOT_DRAWN", "Draw winners before redrawing.");
  await materialiseAllEntries(g0);

  return db.transaction(async (tx) => {
    await lockGiveaway(tx, giveawayId);
    const [old] = await tx.select().from(giveawayWinners)
      .where(and(eq(giveawayWinners.id, winnerId), eq(giveawayWinners.giveawayId, giveawayId))).limit(1);
    if (!old) throw new GiveawayError(404, "WINNER_NOT_FOUND", "Winner not found");
    if (old.status !== "active") throw new GiveawayError(409, "ALREADY_REPLACED", "This winner was already replaced.");

    const everWon = await tx.select({ userId: giveawayWinners.userId }).from(giveawayWinners)
      .where(eq(giveawayWinners.giveawayId, giveawayId));
    const excluded = new Set(everWon.map((w) => w.userId));
    const eligibleRows = await tx.select({ userId: giveawayEntries.userId }).from(giveawayEntries)
      .where(and(eq(giveawayEntries.giveawayId, giveawayId), eq(giveawayEntries.eligible, true)))
      .orderBy(asc(giveawayEntries.userId));
    const pool = eligibleRows.map((r) => r.userId).filter((id) => !excluded.has(id));
    if (pool.length === 0) throw new GiveawayError(409, "NO_ELIGIBLE_ENTRIES", "No other eligible entrants are left to draw.");

    const [last] = await tx.select({ n: giveawayDraws.drawNumber }).from(giveawayDraws)
      .where(eq(giveawayDraws.giveawayId, giveawayId)).orderBy(desc(giveawayDraws.drawNumber)).limit(1);
    const [pick] = pickWinners(pool, 1, rand);
    const [draw] = await tx.insert(giveawayDraws).values({
      giveawayId, drawNumber: (last?.n ?? 0) + 1, eligibleCount: pool.length, eligibleHash: hashEligible(pool),
      winnerIds: [pick!], reason: trimmed, drawnBy: sellerId, drawnAt: now,
    }).returning();
    await tx.update(giveawayWinners)
      .set({ status: "replaced", replacedReason: trimmed, replacedAt: now })
      .where(eq(giveawayWinners.id, old.id));
    const [winner] = await tx.insert(giveawayWinners).values({
      giveawayId, drawId: draw!.id, userId: pick!, position: old.position, replacesWinnerId: old.id,
    }).returning();
    return { giveaway: g0, draw: draw!, winner: winner!, replaced: old };
  }).then(async (res) => {
    await notifyWinners(res.giveaway, [res.winner.id]);
    return res;
  });
}

/** In-app notification + push (publishNotification runs both) for each new winner. */
export async function notifyWinners(g: GiveawayRow, winnerRowIds: string[]) {
  if (winnerRowIds.length === 0) return;
  const rows = await db.select().from(giveawayWinners).where(inArray(giveawayWinners.id, winnerRowIds));
  const [seller] = await db.select({ displayName: users.displayName, username: users.username })
    .from(users).where(eq(users.clerkId, g.sellerId)).limit(1);
  const sellerName = seller?.displayName || seller?.username || "The brand";
  for (const w of rows) {
    try {
      await publishNotification({
        userId: w.userId,
        category: "giveaways",
        type: "giveaway_won",
        title: "You won a giveaway",
        body: `${sellerName} picked you for "${g.title}". ${g.prizeText}`,
        actorId: g.sellerId,
        actorName: sellerName,
        actorHandle: seller?.username ?? undefined,
        targetType: "giveaway",
        targetId: g.shareCode,
        cta: "View",
        analyticsOwnerId: g.sellerId,
      });
      await db.update(giveawayWinners).set({ notifiedAt: new Date() }).where(eq(giveawayWinners.id, w.id));
    } catch (err) {
      logger.warn({ err, giveawayId: g.id }, "Failed to notify giveaway winner");
    }
  }
}

export async function loadEligibleIds(giveawayId: string) {
  return eligibleIds(giveawayId);
}
