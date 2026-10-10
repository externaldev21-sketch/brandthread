/**
 * Story stickers: server-side sanitising + live sticker state.
 *
 * `sanitizeStoryOverlays` runs on POST /stories before anything is stored. It
 * whitelists sticker types, drops unknown fields, caps the sticker count and
 * validates ids (products must exist and be live, countdown drops must be the
 * author's own upcoming drop). Existing overlay types (text / mention /
 * location / time / link / gif / threadcash / shop / reshare_card) keep every
 * field they already used.
 *
 * `withStickerState` adds the additive `stickerState` field to story payloads:
 * poll results (only to the author and to people who voted), question status,
 * live product data and live drop data for countdown stickers.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db, products, productVariants, drops, dropAlertSubscriptions, storyPollVotes, storyQuestionAnswers,
} from "@workspace/db";
import { evaluateContent } from "./contentModerator";

export const MAX_OVERLAYS_PER_SLIDE = 12;
export const MAX_PRODUCT_STICKERS_PER_SLIDE = 4;
export const POLL_QUESTION_MAX = 80;
export const POLL_OPTION_MAX = 30;
export const QUESTION_PROMPT_MAX = 100;
export const QUESTION_ANSWER_MAX = 200;
export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 4;

export type StickerType =
  | "text" | "mention" | "location" | "time" | "link" | "gif" | "threadcash" | "shop" | "reshare_card"
  | "poll" | "question" | "product" | "countdown";

const COMMON = ["id", "type", "x", "y", "rotation", "scale", "opacity"] as const;
const TEXT_FIELDS = ["text", "color", "size", "align", "fontKey", "bgStyle", "textEffect", "textAnimation"] as const;

/** Fields kept for each legacy sticker type (beyond COMMON). Interactive types are rebuilt field by field. */
const LEGACY_FIELDS: Record<string, readonly string[]> = {
  text: [...TEXT_FIELDS, "mentionHandle", "mentionUserId", "mentionName", "mentionStyle"],
  mention: ["mentionHandle", "mentionUserId", "mentionName", "mentionStyle"],
  location: ["locationLabel"],
  time: ["text"],
  link: ["linkUrl", "linkText"],
  gif: ["gifUrl", "gifW", "gifH"],
  threadcash: ["text"],
  shop: ["shopUrl", "shopLabel"],
  reshare_card: ["cardImageUri", "cardRadius"],
};

const NEW_TYPES = new Set(["poll", "question", "product", "countdown"]);

export class StickerValidationError extends Error {
  constructor(message: string, public readonly code = "VALIDATION_ERROR", public readonly status = 400) {
    super(message);
  }
}

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanString(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
}

export interface CleanedOverlay {
  overlay: Record<string, unknown>;
  /** ids that need a database check before the sticker may be stored */
  productId?: string;
  dropId?: string;
}

/**
 * Pure shape-level cleaning of ONE overlay. Returns null when the sticker must
 * be dropped (unknown type or invalid content). `takenIds` keeps overlay ids
 * unique per story (votes / answers are keyed by them).
 */
export function cleanOverlay(raw: unknown, takenIds: Set<string>): CleanedOverlay | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const type = typeof src.type === "string" ? src.type : "";
  const legacy = Object.hasOwn(LEGACY_FIELDS, type) ? LEGACY_FIELDS[type] : undefined;
  if (!legacy && !NEW_TYPES.has(type)) return null;

  let id = cleanString(src.id, 64);
  if (!id || takenIds.has(id)) id = `ov_${randomUUID()}`;
  takenIds.add(id);

  const out: Record<string, unknown> = { id, type };
  for (const key of COMMON.slice(2)) {
    if (isFiniteNumber(src[key])) out[key] = src[key];
  }
  if (!isFiniteNumber(out.x)) out.x = 0;
  if (!isFiniteNumber(out.y)) out.y = 0;

  if (legacy) {
    for (const key of legacy) {
      const v = src[key];
      if (typeof v === "string") out[key] = v.slice(0, 2000);
      else if (isFiniteNumber(v)) out[key] = v;
    }
    return { overlay: out };
  }

  if (type === "poll") {
    const question = cleanString(src.pollQuestion, POLL_QUESTION_MAX);
    const rawOptions = Array.isArray(src.pollOptions) ? src.pollOptions : [];
    const options = rawOptions
      .map((o) => cleanString(typeof o === "string" ? o : (o as any)?.label, POLL_OPTION_MAX))
      .filter((l): l is string => !!l)
      .slice(0, POLL_MAX_OPTIONS);
    if (!question || options.length < POLL_MIN_OPTIONS) return null;
    out.pollQuestion = question;
    out.pollOptions = options.map((label) => ({ label, votes: 0 })); // votes live in story_poll_votes
    return { overlay: out };
  }
  if (type === "question") {
    const prompt = cleanString(src.questionPrompt, QUESTION_PROMPT_MAX);
    if (!prompt) return null;
    out.questionPrompt = prompt;
    return { overlay: out };
  }
  if (type === "product") {
    const productId = typeof src.productId === "string" && UUID_RE.test(src.productId) ? src.productId : null;
    if (!productId) return null;
    out.productId = productId;
    return { overlay: out, productId };
  }
  // countdown
  const dropId = typeof src.dropId === "string" && UUID_RE.test(src.dropId) ? src.dropId : null;
  if (!dropId) return null;
  out.dropId = dropId;
  return { overlay: out, dropId };
}

/** All text a sticker shows, for content moderation. */
function stickerTexts(overlay: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const key of ["pollQuestion", "questionPrompt"]) if (typeof overlay[key] === "string") out.push(overlay[key] as string);
  if (Array.isArray(overlay.pollOptions)) for (const o of overlay.pollOptions as any[]) if (typeof o?.label === "string") out.push(o.label);
  return out;
}

/** Live product facts (name / image / price / availability) for product stickers. */
export async function loadProductFacts(ids: string[]) {
  const map = new Map<string, { name: string; imageUrl: string | null; priceCents: number | null; available: boolean; soldOut: boolean; ownerId: string }>();
  const unique = [...new Set(ids)];
  if (!unique.length) return map;
  const rows = await db.select({
    id: products.id, name: products.name, images: products.images, status: products.status,
    deletedAt: products.deletedAt, ownerId: products.ownerId,
  }).from(products).where(inArray(products.id, unique));
  const prices = await db.select({
    productId: productVariants.productId,
    minPrice: sql<number>`min(${productVariants.priceCents})`,
    stock: sql<number>`coalesce(sum(${productVariants.stock}), 0)`,
  }).from(productVariants).where(inArray(productVariants.productId, unique)).groupBy(productVariants.productId);
  const priceBy = new Map(prices.map((p) => [p.productId, p]));
  for (const r of rows) {
    const p = priceBy.get(r.id);
    const images = Array.isArray(r.images) ? r.images : [];
    map.set(r.id, {
      name: r.name,
      imageUrl: typeof images[0] === "string" ? images[0] : null,
      priceCents: p ? Number(p.minPrice) : null,
      available: r.status === "active" && !r.deletedAt,
      soldOut: p ? Number(p.stock) <= 0 : false,
      ownerId: r.ownerId,
    });
  }
  return map;
}

/**
 * Whitelist + validate every slide's overlays. Throws StickerValidationError
 * (422) when a sticker's text is hateful / harassing, matching the story text rule.
 */
export async function sanitizeStoryOverlays(
  media: any[],
  ctx: { authorId: string; accountType: string | null },
): Promise<any[]> {
  const takenIds = new Set<string>();
  const cleaned = media.map((item) => {
    if (!item || typeof item !== "object" || !Array.isArray(item.overlays)) return { item, entries: [] as CleanedOverlay[] };
    const entries: CleanedOverlay[] = [];
    let products = 0;
    const seenSingle = new Set<string>();
    for (const raw of item.overlays as unknown[]) {
      if (entries.length >= MAX_OVERLAYS_PER_SLIDE) break;
      const probeType = (raw as any)?.type;
      // one poll / question / countdown per slide keeps results unambiguous
      if ((probeType === "poll" || probeType === "question" || probeType === "countdown") && seenSingle.has(probeType)) continue;
      if (probeType === "product" && products >= MAX_PRODUCT_STICKERS_PER_SLIDE) continue;
      const c = cleanOverlay(raw, takenIds);
      if (!c) continue;
      if (probeType === "poll" || probeType === "question" || probeType === "countdown") seenSingle.add(probeType);
      if (probeType === "product") products += 1;
      entries.push(c);
    }
    return { item, entries };
  });

  for (const { entries } of cleaned) {
    for (const { overlay } of entries) {
      for (const text of stickerTexts(overlay)) {
        const d = evaluateContent(text, "dm");
        if (d.action === "reject" && (d.category === "hate_speech" || d.category === "harassment")) {
          throw new StickerValidationError(d.reason, "CONTENT_REJECTED", 422);
        }
      }
    }
  }

  const productIds = cleaned.flatMap(({ entries }) => entries.map((e) => e.productId).filter((v): v is string => !!v));
  const dropIds = cleaned.flatMap(({ entries }) => entries.map((e) => e.dropId).filter((v): v is string => !!v));
  const [facts, dropRows] = await Promise.all([
    loadProductFacts(productIds),
    dropIds.length
      ? db.select({ id: drops.id, name: drops.name, ownerId: drops.ownerId, status: drops.status, releaseAt: drops.releaseAt })
        .from(drops).where(inArray(drops.id, [...new Set(dropIds)]))
      : Promise.resolve([]),
  ]);
  const dropBy = new Map(dropRows.map((d) => [d.id, d]));
  const sellerAuthor = ctx.accountType === "seller" || ctx.accountType === "both";

  return cleaned.map(({ item, entries }) => {
    if (!item || typeof item !== "object" || !Array.isArray(item.overlays)) return item;
    const overlays: Record<string, unknown>[] = [];
    for (const e of entries) {
      if (e.productId) {
        const f = facts.get(e.productId);
        if (!f || !f.available) continue;
        e.overlay.productName = f.name;
        if (f.imageUrl) e.overlay.productImageUri = f.imageUrl;
        if (f.priceCents !== null) e.overlay.productPriceCents = f.priceCents;
      }
      if (e.dropId) {
        const d = dropBy.get(e.dropId);
        // Only a seller's own drop that is still upcoming can be counted down to.
        if (!sellerAuthor || !d || d.ownerId !== ctx.authorId || d.status !== "active"
          || !d.releaseAt || new Date(d.releaseAt).getTime() <= Date.now()) continue;
        e.overlay.dropName = d.name;
        e.overlay.dropReleaseAt = new Date(d.releaseAt).toISOString();
      }
      overlays.push(e.overlay);
    }
    return { ...item, overlays };
  });
}

// ─── Live sticker state ──────────────────────────────────────────────────────

export interface PollState { counts: number[] | null; percentages: number[] | null; total: number | null; myVote: number | null }
export interface QuestionState { answered: boolean; count: number | null }
export interface ProductState { productId: string; name: string; imageUrl: string | null; priceCents: number | null; available: boolean; soldOut: boolean }
export interface CountdownState { dropId: string; name: string; releaseAt: string | null; launched: boolean; live: boolean; subscribed: boolean }
export interface StickerState {
  serverNow: number;
  polls: Record<string, PollState>;
  questions: Record<string, QuestionState>;
  products: Record<string, ProductState>;
  countdowns: Record<string, CountdownState>;
}

/** Whole-number percentages that add up to 100 (largest remainder). */
export function percentages(counts: number[]): number[] {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return counts.map(() => 0);
  const raw = counts.map((c) => (c / total) * 100);
  const floor = raw.map(Math.floor);
  let left = 100 - floor.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, rem: r - floor[i] })).sort((a, b) => b.rem - a.rem);
  for (const { i } of order) { if (left <= 0) break; floor[i] += 1; left -= 1; }
  return floor;
}

interface StoryLike { id: string; authorId: string; media: unknown }

export async function withStickerState<T extends StoryLike>(views: T[], viewerId: string): Promise<Array<T & { stickerState: StickerState | null }>> {
  const overlaysOf = (v: StoryLike) => (Array.isArray(v.media) ? v.media : [])
    .flatMap((m: any) => (Array.isArray(m?.overlays) ? m.overlays : []) as any[]);
  const wanted = views.filter((v) => overlaysOf(v).some((o) => o && NEW_TYPES.has(o.type)));
  if (!wanted.length) return views.map((v) => ({ ...v, stickerState: null }));

  const storyIds = wanted.map((v) => v.id);
  const ownStoryIds = wanted.filter((v) => v.authorId === viewerId).map((v) => v.id);
  const productIds: string[] = [];
  const dropIds: string[] = [];
  for (const v of wanted) for (const o of overlaysOf(v)) {
    if (o?.type === "product" && typeof o.productId === "string") productIds.push(o.productId);
    if (o?.type === "countdown" && typeof o.dropId === "string") dropIds.push(o.dropId);
  }

  const [voteRows, myVotes, myAnswers, answerCounts, facts, dropRows, subs] = await Promise.all([
    db.select({
      storyId: storyPollVotes.storyId, overlayId: storyPollVotes.overlayId, optionIndex: storyPollVotes.optionIndex,
      n: sql<number>`cast(count(*) as int)`,
    }).from(storyPollVotes).where(inArray(storyPollVotes.storyId, storyIds))
      .groupBy(storyPollVotes.storyId, storyPollVotes.overlayId, storyPollVotes.optionIndex),
    db.select({ storyId: storyPollVotes.storyId, overlayId: storyPollVotes.overlayId, optionIndex: storyPollVotes.optionIndex })
      .from(storyPollVotes).where(and(inArray(storyPollVotes.storyId, storyIds), eq(storyPollVotes.userId, viewerId))),
    db.select({ storyId: storyQuestionAnswers.storyId, overlayId: storyQuestionAnswers.overlayId })
      .from(storyQuestionAnswers).where(and(inArray(storyQuestionAnswers.storyId, storyIds), eq(storyQuestionAnswers.userId, viewerId))),
    ownStoryIds.length
      ? db.select({
        storyId: storyQuestionAnswers.storyId, overlayId: storyQuestionAnswers.overlayId, n: sql<number>`cast(count(*) as int)`,
      }).from(storyQuestionAnswers).where(inArray(storyQuestionAnswers.storyId, ownStoryIds))
        .groupBy(storyQuestionAnswers.storyId, storyQuestionAnswers.overlayId)
      : Promise.resolve([]),
    loadProductFacts(productIds),
    dropIds.length
      ? db.select({ id: drops.id, name: drops.name, status: drops.status, releaseAt: drops.releaseAt })
        .from(drops).where(inArray(drops.id, [...new Set(dropIds)]))
      : Promise.resolve([]),
    dropIds.length
      ? db.select({ dropId: dropAlertSubscriptions.dropId }).from(dropAlertSubscriptions)
        .where(and(inArray(dropAlertSubscriptions.dropId, [...new Set(dropIds)]), eq(dropAlertSubscriptions.userId, viewerId)))
      : Promise.resolve([]),
  ]);

  const key = (s: string, o: string) => `${s}:${o}`;
  const votes = new Map<string, number[]>();
  for (const r of voteRows) {
    const k = key(r.storyId, r.overlayId);
    if (!votes.has(k)) votes.set(k, []);
    const arr = votes.get(k)!;
    while (arr.length <= r.optionIndex) arr.push(0);
    arr[r.optionIndex] = r.n;
  }
  const mine = new Map(myVotes.map((r) => [key(r.storyId, r.overlayId), r.optionIndex]));
  const answered = new Set(myAnswers.map((r) => key(r.storyId, r.overlayId)));
  const counts = new Map(answerCounts.map((r) => [key(r.storyId, r.overlayId), r.n]));
  const dropBy = new Map(dropRows.map((d) => [d.id, d]));
  const subscribed = new Set(subs.map((s) => s.dropId));
  const now = Date.now();
  const wantedIds = new Set(storyIds);

  return views.map((v) => {
    if (!wantedIds.has(v.id)) return { ...v, stickerState: null };
    const state: StickerState = { serverNow: now, polls: {}, questions: {}, products: {}, countdowns: {} };
    const isAuthor = v.authorId === viewerId;
    for (const o of overlaysOf(v)) {
      if (!o || typeof o.id !== "string") continue;
      if (o.type === "poll") {
        const n = Array.isArray(o.pollOptions) ? o.pollOptions.length : 0;
        const k = key(v.id, o.id);
        const arr = Array.from({ length: n }, (_, i) => votes.get(k)?.[i] ?? 0);
        const myVote = mine.get(k) ?? null;
        const reveal = isAuthor || myVote !== null;
        state.polls[o.id] = {
          counts: reveal ? arr : null,
          percentages: reveal ? percentages(arr) : null,
          total: reveal ? arr.reduce((a, b) => a + b, 0) : null,
          myVote,
        };
      } else if (o.type === "question") {
        const k = key(v.id, o.id);
        state.questions[o.id] = { answered: answered.has(k), count: isAuthor ? (counts.get(k) ?? 0) : null };
      } else if (o.type === "product" && typeof o.productId === "string") {
        const f = facts.get(o.productId);
        state.products[o.id] = f
          ? { productId: o.productId, name: f.name, imageUrl: f.imageUrl, priceCents: f.priceCents, available: f.available, soldOut: f.soldOut }
          : { productId: o.productId, name: o.productName ?? "", imageUrl: null, priceCents: null, available: false, soldOut: false };
      } else if (o.type === "countdown" && typeof o.dropId === "string") {
        const d = dropBy.get(o.dropId);
        const releaseMs = d?.releaseAt ? new Date(d.releaseAt).getTime() : null;
        state.countdowns[o.id] = {
          dropId: o.dropId,
          name: d?.name ?? o.dropName ?? "",
          releaseAt: releaseMs !== null ? new Date(releaseMs).toISOString() : (o.dropReleaseAt ?? null),
          launched: releaseMs !== null && releaseMs <= now,
          live: !!d && d.status === "active" && releaseMs !== null && releaseMs <= now,
          subscribed: subscribed.has(o.dropId),
        };
      }
    }
    return { ...v, stickerState: state };
  });
}

