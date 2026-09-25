/**
 * For You feed + behavioral event ingestion.
 *
 * POST /api/feed/events   — batched, idempotent ranking-signal ingestion (requireAuth)
 * GET  /api/feed/for-you  — buyer's personalized ranked feed, cursor-paginated (requireAuth)
 *
 * Likes/saves/reposts/comments/follows/purchases already have their own
 * write paths elsewhere (posts.ts /:id/interact, saved.ts, orders) and are
 * read directly from those tables by the ranking pipeline — this endpoint is
 * only for the behavioral signals that have nowhere else to land: view,
 * watch_time, rewatch, shop taps, add-to-bag, skip, and not-interested.
 */
import { Router } from "express";
import { db, posts, interactions, users, liveStreams, postTaggedProducts, products, productVariants } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { z } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { validateRequest } from "../middlewares/validateRequest";
import { rateLimit } from "../middlewares/rateLimit";
import { deriveSellerVerified } from "../lib/sellerEligibility";
import { getForYouFeed, applyEventToProfile, type ForYouResultItem } from "../lib/ranking/forYou";
import { parsePagination, setPaginationHeaders } from "../lib/pagination";

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

      // Insert every event idempotently (client_event_id is unique per user);
      // RETURNING tells us which ones were newly inserted vs. duplicates, so
      // we only update the taste profile once per real event.
      const inserted: { postId: string; type: string; value: string | null }[] = [];
      for (const event of events) {
        const post = postById.get(event.postId);
        if (!post) continue; // silently skip unknown/deleted posts — not an ingestion error
        const [row] = await db
          .insert(interactions)
          .values({
            userId,
            postId: event.postId,
            type: event.type,
            value: event.value ?? null,
            clientEventId: event.clientEventId,
          })
          .onConflictDoNothing({
            target: [interactions.userId, interactions.clientEventId],
            where: sql`${interactions.clientEventId} IS NOT NULL`,
          })
          .returning({ postId: interactions.postId, type: interactions.type, value: interactions.value });
        if (row) inserted.push({ postId: row.postId as string, type: row.type, value: row.value });
      }

      for (const row of inserted) {
        const post = postById.get(row.postId);
        if (!post) continue;
        await applyEventToProfile(userId, {
          type: row.type,
          value: row.value,
          styleTags: Array.isArray(post.styleTags) ? (post.styleTags as string[]) : [],
          sellerId: post.userId,
        }).catch((err) => req.log.error({ err, userId }, "Failed to apply feed event to taste profile"));
      }

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
    const ranked = await getForYouFeed(userId);
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
      .where(inArray(postTaggedProducts.postId, postIds))
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

    // Blocked-seller filtering already happened during candidate generation
    // in computeForYouRankingForUser (via the `blocks` table), so this page
    // hydration doesn't need to re-check it.
    const items = slice.map((item) => {
      if (item.isLive) {
        const stream = liveById.get(item.liveStreamId!);
        if (!stream) return null;
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
      if (!post) return null;
      const seller = sellerById.get(post.userId);
      return {
        type: "post" as const,
        id: post.id,
        userId: post.userId,
        mediaUrl: post.mediaUrl,
        thumbnailUrl: post.thumbnailUrl,
        mediaUrls: post.mediaUrls,
        mediaType: post.mediaType,
        aspectRatio: post.aspectRatio,
        caption: post.caption,
        hashtags: post.hashtags,
        styleTags: post.styleTags,
        sound: post.sound,
        createdAt: post.createdAt,
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

    res.json({
      items,
      nextOffset: offset + slice.length < ranked.length ? offset + slice.length : null,
    });
  } catch (err) {
    req.log.error({ err, userId }, "Failed to build For You feed");
    res.status(500).json({ error: "Failed to load feed" });
  }
});

export default router;
