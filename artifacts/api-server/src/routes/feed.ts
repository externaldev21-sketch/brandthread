/**
 * For You feed + behavioral event ingestion.
 *
 * POST /api/feed/events   — batched, idempotent ranking-signal ingestion (requireAuth)
 * GET  /api/feed/for-you  — buyer's personalized ranked feed, cursor-paginated (requireAuth)
 * DELETE /api/feed/not-interested/:postId — undo a "Not interested" hide (requireAuth)
 * GET/PUT /api/feed/ranking-config — read / update tunable ranking weights (moderators only)
 *
 * Likes/saves/reposts/comments/follows/purchases already have their own
 * write paths elsewhere (posts.ts /:id/interact, saved.ts, orders) and are
 * read directly from those tables by the ranking pipeline — this endpoint is
 * only for the behavioral signals that have nowhere else to land: view,
 * watch_time, rewatch, shop taps, add-to-bag, skip, and not-interested.
 */
import { attachQuoteData } from "../lib/quotedPosts";
import { taggedProductVisibleTo } from "../lib/productVisibility";
import { attachPostExtras } from "../lib/postExtras";
import { Router } from "express";
import { db, posts, interactions, users, liveStreams, postTaggedProducts, products, productVariants, feedNotInterested } from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "@workspace/api-zod";
import { requireAuth, requireModerator } from "../middlewares/requireAuth";
import { validateRequest } from "../middlewares/validateRequest";
import { rateLimit } from "../middlewares/rateLimit";
import { deriveSellerVerified } from "../lib/sellerEligibility";
import { getForYouFeed, applyEventsToProfile, type ForYouResultItem } from "../lib/ranking/forYou";
import { authorInGoodStanding, mutedUserIds, notBlockedWith } from "../lib/safety";
import { getRankingConfig, saveRankingConfig, DEFAULT_RANKING_CONFIG } from "../lib/ranking/config";
import { hidePostFromForYou, unhidePostFromForYou } from "../lib/ranking/signals";
import { parsePagination, setPaginationHeaders } from "../lib/pagination";
import { serveSponsoredSlots } from "../lib/promotions/sponsoredService";
import { injectSponsored } from "../lib/promotions/sponsored";
import { withoutSuggestedWhenSnoozed } from "../lib/interactionSettings";
import { blockedUserIds } from "../lib/safety";
import { engagementFields, postEngagementCounts } from "../lib/postEngagement";
import { locationsByPlaceId } from "../lib/places";
import { mutedPhrasesFor } from "../lib/safety";
import { matchesMutedWords } from "../lib/contentModerator";
import { planOfficialSeed, recordOfficialSeedProgress } from "../lib/officialSeed/service";
import { isPlatformAdmin } from "../lib/platformAdmin";

const router = Router();

const EVENT_TYPES = ["view", "watch_time", "rewatch", "shop_click", "add_to_bag", "skip", "not_interested"] as const;

const eventSchema = z.object({
  postId: z.string().uuid(),
  type: z.enum(EVENT_TYPES),
  value: z.string().max(40).optional(),
  clientEventId: z.string().trim().min(1).max(120),
});

const batchSchema = z.object({
  events: z.array(eventSchema).min(1).max(50),
}).passthrough();

// ─── POST /api/feed/events ────────────────────────────────────────────────────
router.post(
  "/events",
  requireAuth,
  rateLimit("feed-event"),
  validateRequest({ body: batchSchema }),
  async (req, res) => {
    const userId = (req as any).clerkUserId as string;
    const events = req.body.events as z.infer<typeof eventSchema>[];

    try {
      const postIds = [...new Set(events.map((e) => e.postId))];
      const postRows = postIds.length === 0 ? [] : await db
        .select({ id: posts.id, userId: posts.userId, styleTags: posts.styleTags })
        .from(posts)
        .where(inArray(posts.id, postIds));
      const postById = new Map(postRows.map((p) => [p.id, p]));

      // Insert every event idempotently (client_event_id is unique per user)
      // in ONE statement; RETURNING tells us which ones were newly inserted
      // vs. duplicates (already stored, or repeated within this batch), so we
      // only update the taste profile once per real event.
      const known = events.filter((event) => postById.has(event.postId)); // unknown/deleted posts are skipped, not an error
      const returned = known.length === 0 ? [] : await db
        .insert(interactions)
        .values(known.map((event) => ({
          userId,
          postId: event.postId,
          type: event.type,
          value: event.value ?? null,
          clientEventId: event.clientEventId,
        })))
        .onConflictDoNothing({
          target: [interactions.userId, interactions.clientEventId],
          where: sql`${interactions.clientEventId} IS NOT NULL`,
        })
        .returning({
          postId: interactions.postId,
          type: interactions.type,
          value: interactions.value,
          clientEventId: interactions.clientEventId,
        });
      // Restore client order (RETURNING order is not guaranteed) so profile
      // updates fold in exactly the order the per-event path applied them.
      const byClientEventId = new Map(returned.map((row) => [row.clientEventId, row]));
      const inserted: { postId: string; type: string; value: string | null }[] = [];
      for (const event of known) {
        const row = byClientEventId.get(event.clientEventId);
        if (!row) continue;
        byClientEventId.delete(event.clientEventId);
        inserted.push({ postId: row.postId as string, type: row.type, value: row.value });
      }

      for (const row of inserted) {
        if (row.type !== "not_interested") continue;
        const post = postById.get(row.postId)!;
        // Persist the hide too (same as POST /posts/:id/interact) so the post leaves For You.
        await hidePostFromForYou(userId, { id: row.postId, sellerId: post.userId })
          .catch((err) => req.log.error({ err, userId }, "Failed to persist not-interested hide"));
      }
      await applyEventsToProfile(userId, inserted.map((row) => {
        const post = postById.get(row.postId)!;
        return {
          type: row.type,
          value: row.value,
          styleTags: Array.isArray(post.styleTags) ? (post.styleTags as string[]) : [],
          sellerId: post.userId,
        };
      })).catch((err) => req.log.error({ err, userId }, "Failed to apply feed events to taste profile"));

      res.status(202).json({ accepted: inserted.length, deduped: events.length - inserted.length });
    } catch (err) {
      req.log.error({ err, userId }, "Failed to ingest feed events");
      res.status(500).json({ error: "Failed to record events" });
    }
  },
);

// ─── GET /api/feed/for-you ─────────────────────────────────────────────────────
// Cursor pagination over the buyer's cached ranked list: `cursor` is an opaque
// offset into the current ranking (stable within the cache's TTL so paging
// doesn't skip/repeat items mid-session), `limit` caps the page size.
router.get("/for-you", requireAuth, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const page = parsePagination(req.query, { limit: 20 });
  if (!page.success) {
    res.status(400).json({ error: "Invalid pagination", code: "VALIDATION_ERROR" });
    return;
  }
  const { limit, offset } = page.data;

  try {
    // The ranking is cached for a short TTL, so a person muted since it was
    // built is dropped here too (candidate generation also excludes them).
    const [rankedAll, muted] = await Promise.all([getForYouFeed(userId), mutedUserIds(userId, "posts")]);
    const visibleRanked = muted.size === 0 ? rankedAll : rankedAll.filter((i) => i.isLive || !muted.has(i.sellerId));
    const ranked = await withoutSuggestedWhenSnoozed(userId, visibleRanked, item => item.sellerId);
    const slice = ranked.slice(offset, offset + limit);
    setPaginationHeaders(res, page.data, slice.length, ranked.length);

    if (slice.length === 0) {
      res.json({ items: [], nextOffset: null });
      return;
    }

    const postIds = slice.filter((i) => !i.isLive).map((i) => i.postId);
    const liveIds = slice.filter((i) => i.isLive).map((i) => i.liveStreamId!).filter(Boolean);

    const [postRows, liveRows] = await Promise.all([
      postIds.length === 0 ? Promise.resolve([]) : db
        .select()
        .from(posts)
        .where(inArray(posts.id, postIds)),
      liveIds.length === 0 ? Promise.resolve([]) : db
        .select()
        .from(liveStreams)
        .where(inArray(liveStreams.id, liveIds)),
    ]);

    const sellerIds = [...new Set([...postRows.map((p) => p.userId), ...liveRows.map((l) => l.sellerId)])];
    const sellerRows = sellerIds.length === 0 ? [] : await db
      .select({
        clerkId: users.clerkId, displayName: users.displayName, brandName: users.brandName,
        verified: users.verified, verificationStatus: users.verificationStatus,
        activeStanding: users.activeStanding, policyRestricted: users.policyRestricted,
      })
      .from(users)
      .where(inArray(users.clerkId, sellerIds));
    const sellerById = new Map(sellerRows.map((s) => [s.clerkId, s]));

    const tagRows = postIds.length === 0 ? [] : await db
      .select({
        postId: postTaggedProducts.postId, productId: postTaggedProducts.productId,
        position: postTaggedProducts.position, name: products.name, images: products.images,
      })
      .from(postTaggedProducts)
      .leftJoin(products, eq(products.id, postTaggedProducts.productId))
      .where(and(inArray(postTaggedProducts.postId, postIds), taggedProductVisibleTo(userId)))
      .orderBy(postTaggedProducts.position);
    const productIds = [...new Set(tagRows.map((t) => t.productId))];
    const priceRows = productIds.length === 0 ? [] : await db
      .select({ productId: productVariants.productId, minPriceCents: sql<number>`min(${productVariants.priceCents})` })
      .from(productVariants)
      .where(inArray(productVariants.productId, productIds))
      .groupBy(productVariants.productId);
    const minPriceByProduct = Object.fromEntries(priceRows.map((r) => [r.productId, Number(r.minPriceCents)]));
    const tagsByPost: Record<string, typeof tagRows> = {};
    for (const t of tagRows) (tagsByPost[t.postId] ??= []).push(t);

    const postById = new Map(postRows.map((p) => [p.id, p]));
    const liveById = new Map(liveRows.map((l) => [l.id, l]));
    // Same counts, location and muted-word filtering as GET /api/public/posts,
    // so the Home For You tab looks the same whichever source serves it.
    const [engagementById, locationById, muted] = await Promise.all([
      postEngagementCounts(postIds),
      locationsByPlaceId(postRows.map((p) => p.placeId)),
      mutedPhrasesFor(userId),
    ]);

    // Candidate generation already dropped blocked sellers, and a block clears
    // the cached ranking (lib/relationshipCaches.ts). Re-checking here is one
    // indexed query and keeps a block made by the *other* side mid-page honest.
    const blockedIds = await blockedUserIds(userId);
    const rawItems = slice.map((item) => {
      if (item.isLive) {
        const stream = liveById.get(item.liveStreamId!);
        if (!stream || blockedIds.has(stream.sellerId)) return null;
        const seller = sellerById.get(stream.sellerId);
        return {
          type: "live" as const,
          liveStreamId: stream.id,
          sellerId: stream.sellerId,
          title: stream.title,
          thumbnailUrl: stream.thumbnailUrl,
          viewerCount: stream.viewerCount,
          seller: seller ? {
            displayName: seller.displayName, brandName: seller.brandName,
            verified: deriveSellerVerified(seller),
          } : null,
          score: item.score,
        };
      }
      const post = postById.get(item.postId);
      if (!post || blockedIds.has(post.userId)) return null;
      if (muted.length > 0 && matchesMutedWords([post.caption ?? "", ...(post.hashtags ?? [])].join(" "), muted)) return null;
      const seller = sellerById.get(post.userId);
      return {
        type: "post" as const,
        id: post.id,
        userId: post.userId,
        mediaUrl: post.mediaUrl,
        thumbnailUrl: post.thumbnailUrl,
        mediaUrls: post.mediaUrls,
        mediaType: post.mediaType,
        videoHlsUrl: post.videoHlsUrl ?? null,
        aspectRatio: post.aspectRatio,
        caption: post.caption,
        hashtags: post.hashtags,
        styleTags: post.styleTags,
        sound: post.sound,
        visibility: post.visibility,
        location: post.placeId ? locationById.get(post.placeId) ?? null : null,
        createdAt: post.createdAt,
        ...engagementFields(post.visibility as { showLikeCount?: boolean } | null, engagementById.get(post.id)),
        seller: seller ? {
          displayName: seller.displayName, brandName: seller.brandName,
          verified: deriveSellerVerified(seller),
        } : null,
        taggedProducts: (tagsByPost[post.id] ?? []).map((t) => ({
          productId: t.productId, position: t.position, name: t.name, images: t.images,
          priceCents: minPriceByProduct[t.productId] ?? 0,
        })),
        score: item.score,
      };
    }).filter((i): i is NonNullable<typeof i> => i !== null);

    // One batched lookup for every post item on the page (quotedPost + quotesCount).
    const quoteById = new Map(
      (await attachQuoteData(rawItems.filter((i) => i.type === "post").map((i) => ({ id: (i as { id: string }).id })), userId))
        .map((q) => [q.id, { quotedPost: q.quotedPost, quotesCount: q.quotesCount }]),
    );
    const extrasById = new Map(
      (await attachPostExtras(rawItems.filter((i) => i.type === "post").map((i) => ({ id: (i as { id: string }).id }))))
        .map((x) => [x.id, { productMentions: x.productMentions, labels: x.labels }]),
    );
    const items = rawItems.map((i) => (i.type === "post" ? { ...i, ...quoteById.get((i as { id: string }).id), ...extrasById.get((i as { id: string }).id) } : i));

    // Sponsored placement (opt-in via ?sessionId=): approved, paid boosts are
    // spliced in as clearly labelled items under the frequency cap. Failure
    // never affects the organic page.
    let outItems: unknown[] = items;
    const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : "";
    if (/^[A-Za-z0-9_-]{8,64}$/.test(sessionId)) {
      try {
        const slots = await serveSponsoredSlots({ viewerId: userId, sessionId, organicOffset: offset, organicCount: items.length });
        if (slots.length > 0) {
          const sponsoredPostIds = new Set(slots.map((s) => s.post.id));
          const organic = items.filter((i) => !(i.type === "post" && sponsoredPostIds.has(i.id)));
          outItems = injectSponsored(organic, slots.map((s) => ({
            afterIndex: Math.min(s.afterIndex, organic.length - 1),
            item: { type: "post" as const, ...s.post, sponsored: true, boostId: s.boostId, label: "Sponsored" as const, score: 0 },
          })));
        }
      } catch (err) {
        req.log.error({ err, userId }, "Failed to inject sponsored items");
      }
    }

    res.json({
      items: outItems,
      nextOffset: offset + slice.length < ranked.length ? offset + slice.length : null,
    });
  } catch (err) {
    req.log.error({ err, userId }, "Failed to build For You feed");
    res.status(500).json({ error: "Failed to load feed" });
  }
});

// ─── GET /api/feed/official-seed ──────────────────────────────────────────────
// New-user seeding of @brandthread official Threads into one page of the
// Threads (For You) feed. The client sends the organic page it fetched and
// gets back the merged order. Users outside the seeding window get
// `{ seeding: false }` and keep their organic page untouched.
//   ?organicIds=a,b,c       organic post ids on this page, in order (≤50)
//   &position=&lastOfficialPosition=   session cursor from the previous page
//   &exclude=x,y            official ids already served this session (≤50)
//   &last=1                 no further organic page exists
//   &preview=1              admins only: preview the new-user experience
const UUID_LIST_RE = /^[0-9a-f-]{36}(,[0-9a-f-]{36}){0,49}$/i;

function uuidList(value: unknown): string[] | null {
  if (value === undefined || value === "") return [];
  if (typeof value !== "string" || !UUID_LIST_RE.test(value)) return null;
  const ids = value.split(",");
  return ids.every((id) => z.string().uuid().safeParse(id).success) ? [...new Set(ids)] : null;
}

function nonNegativeInt(value: unknown, max: number): number | null {
  if (value === undefined) return 0;
  if (typeof value !== "string" || !/^\d{1,6}$/.test(value)) return null;
  const n = Number(value);
  return n <= max ? n : null;
}

router.get("/official-seed", requireAuth, rateLimit("feed-event"), async (req, res) => {
  const viewerId = (req as any).clerkUserId as string;
  const organicIds = uuidList(req.query.organicIds);
  const exclude = uuidList(req.query.exclude);
  const position = nonNegativeInt(req.query.position, 100_000);
  const lastOfficialPosition = nonNegativeInt(req.query.lastOfficialPosition, 100_000);
  if (!organicIds || !exclude || position === null || lastOfficialPosition === null) {
    return res.status(400).json({ error: "Invalid official seed query", code: "VALIDATION_ERROR" });
  }
  try {
    const preview = req.query.preview === "1" && await isPlatformAdmin(viewerId);
    const result = await planOfficialSeed({
      viewerId,
      organicIds,
      cursor: { position, lastOfficialPosition },
      exclude,
      isLastPage: req.query.last === "1",
      preview,
    });
    return res.json({ ...result, preview });
  } catch (err) {
    req.log.error({ err, viewerId }, "Failed to plan official seed page");
    // Seeding is optional: a failure must never break the organic feed.
    return res.json({ seeding: false, reason: "error" });
  }
});

// ─── POST /api/feed/official-seed/progress ────────────────────────────────────
// Sent only while the client is in the seeding window. `seenPostIds` are
// official Threads that were actually on screen (never seeded again);
// `viewedCount` is how many Threads were viewed since the last report.
const seedProgressSchema = z.object({
  seenPostIds: z.array(z.string().uuid()).max(20).default([]),
  viewedCount: z.number().int().min(0).max(100).default(0),
}).passthrough();

router.post(
  "/official-seed/progress",
  requireAuth,
  rateLimit("feed-event"),
  validateRequest({ body: seedProgressSchema }),
  async (req, res) => {
    const viewerId = (req as any).clerkUserId as string;
    const body = req.body as z.infer<typeof seedProgressSchema>;
    try {
      const result = await recordOfficialSeedProgress({
        viewerId, seenPostIds: [...new Set(body.seenPostIds)], viewedCount: body.viewedCount,
      });
      return res.status(202).json(result);
    } catch (err) {
      req.log.error({ err, viewerId }, "Failed to record official seed progress");
      return res.status(500).json({ error: "Failed to record progress" });
    }
  },
);

// ─── GET /api/feed/not-interested ─────────────────────────────────────────────
// The viewer's own "Not interested" hides, newest first, so they can be undone
// from Settings → Hidden posts. Deleted posts cascade out of the table.
router.get("/not-interested", requireAuth, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "50"), 10) || 50, 1), 100);
  const offset = Math.max(parseInt(String(req.query.offset ?? "0"), 10) || 0, 0);
  try {
    const rows = await db
      .select({
        postId: feedNotInterested.postId,
        hiddenAt: feedNotInterested.createdAt,
        caption: posts.caption,
        mediaType: posts.mediaType,
        mediaUrl: posts.mediaUrl,
        thumbnailUrl: posts.thumbnailUrl,
        authorId: posts.userId,
        authorName: sql<string | null>`coalesce(${users.displayName}, ${users.name})`,
        authorUsername: users.username,
      })
      .from(feedNotInterested)
      .innerJoin(posts, eq(posts.id, feedNotInterested.postId))
      .leftJoin(users, eq(users.clerkId, posts.userId))
      .where(and(
        eq(feedNotInterested.userId, userId),
        // Only posts the viewer could still see: not deleted/archived, not
        // removed by moderation, author in good standing and not blocked.
        sql`${posts.postStatus} NOT IN ('deleted', 'archived')`,
        eq(posts.moderationStatus, "visible"),
        authorInGoodStanding(posts.userId),
        notBlockedWith(userId, posts.userId),
      ))
      .orderBy(desc(feedNotInterested.createdAt))
      .limit(limit)
      .offset(offset);
    res.json({
      items: rows.map((row) => ({ ...row, hiddenAt: row.hiddenAt.toISOString() })),
      nextOffset: rows.length === limit ? offset + limit : null,
    });
  } catch (err) {
    req.log.error({ err, userId }, "Failed to list not-interested posts");
    res.status(500).json({ error: "Failed to load hidden posts" });
  }
});

// ─── DELETE /api/feed/not-interested/:postId ──────────────────────────────────
router.delete("/not-interested/:postId", requireAuth, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const postId = String(req.params.postId);
  if (!z.string().uuid().safeParse(postId).success) {
    res.status(404).json({ error: "Post not found" });
    return;
  }
  try {
    const removed = await unhidePostFromForYou(userId, postId);
    res.json({ ok: true, removed });
  } catch (err) {
    req.log.error({ err, userId }, "Failed to undo not-interested");
    res.status(500).json({ error: "Failed to update feed preferences" });
  }
});

// ─── GET/PUT /api/feed/ranking-config (moderators) ────────────────────────────
router.get("/ranking-config", requireAuth, requireModerator, async (_req, res) => {
  res.json({ config: await getRankingConfig(), defaults: DEFAULT_RANKING_CONFIG });
});

router.put("/ranking-config", requireAuth, requireModerator, async (req, res) => {
  try {
    // Unknown keys are ignored and numbers clamped; the merged, validated config is returned.
    const config = await saveRankingConfig(req.body);
    res.json({ config });
  } catch (err) {
    req.log.error({ err }, "Failed to save ranking config");
    res.status(500).json({ error: "Failed to save ranking config" });
  }
});

export default router;
