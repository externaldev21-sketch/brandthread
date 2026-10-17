/**
 * DB-facing half of new-user seeding: loads the viewer's window + the official
 * candidates, runs the pure planner (./plan), hydrates the official posts in
 * the same shape as GET /api/public/posts, and records what was seen.
 */
import { and, asc, count, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import {
  db, interactions, officialSeedImpressions, officialSeedProgress, posts, savedItems, users,
} from "@workspace/db";
import { matchesMutedWords } from "../contentModerator";
import { publicPostCondition, visibleCommentCounts } from "../postVisibility";
import { mutedPhrasesFor, notBlockedWith } from "../safety";
import { deriveSellerVerified } from "../sellerEligibility";
import { attachCredits } from "./credit";
import { OFFICIAL_ACCOUNT_CLERK_ID, OFFICIAL_SEED_CONFIG } from "./config";
import { planSeedPage, seedEligibility, type SeedCursor, type SeedPageItem } from "./plan";
import { postDimsPayload } from "../mediaDimensions";
import { postDimsColumns } from "../postDimsColumns";

// ─── Real-post pool size (cached) ────────────────────────────────────────────

let poolCache: { value: number; at: number } | null = null;

/** Publicly visible Thread posts by real (non-official) sellers. */
export async function realPostPoolSize(now = new Date()): Promise<number> {
  if (poolCache && now.getTime() - poolCache.at < OFFICIAL_SEED_CONFIG.poolCountTtlMs) return poolCache.value;
  const [row] = await db
    .select({ n: count() })
    .from(posts)
    .innerJoin(users, eq(users.clerkId, posts.userId))
    .where(and(
      eq(users.accountType, "seller"),
      eq(posts.surface, "thread"),
      ne(posts.userId, OFFICIAL_ACCOUNT_CLERK_ID),
      publicPostCondition(now),
    ));
  poolCache = { value: Number(row?.n ?? 0), at: now.getTime() };
  return poolCache.value;
}

/** Test hook: forget the cached pool size. */
export function resetPoolSizeCache(): void {
  poolCache = null;
}

// ─── Candidates ──────────────────────────────────────────────────────────────

/**
 * Official Threads this viewer may see and has not seen yet, oldest first (the
 * order the starter set was published). `exclude` = ids already served in the
 * viewer's current session.
 */
async function unseenOfficialPostIds(viewerId: string, exclude: string[], includeSeen: boolean, now: Date): Promise<string[]> {
  const rows = await db
    .select({ id: posts.id, caption: posts.caption, hashtags: posts.hashtags })
    .from(posts)
    .where(and(
      eq(posts.userId, OFFICIAL_ACCOUNT_CLERK_ID),
      eq(posts.surface, "thread"),
      publicPostCondition(now, undefined, { officialViewerId: viewerId }),
      notBlockedWith(viewerId, posts.userId),
      exclude.length > 0 ? notInArray(posts.id, exclude) : undefined,
      includeSeen ? undefined : sql`not exists (
        select 1 from official_seed_impressions osi
        where osi.user_id = ${viewerId} and osi.post_id = ${posts.id}
      )`,
    ))
    .orderBy(asc(posts.createdAt), asc(posts.id))
    .limit(OFFICIAL_SEED_CONFIG.candidateLimit);
  const muted = await mutedPhrasesFor(viewerId);
  return rows
    .filter((r) => muted.length === 0 || !matchesMutedWords([r.caption ?? "", ...(r.hashtags ?? [])].join(" "), muted))
    .map((r) => r.id);
}

// ─── Hydration (same shape as GET /api/public/posts) ─────────────────────────

export async function hydrateOfficialPosts(postIds: string[]) {
  if (postIds.length === 0) return [];
  const rows = await db
    .select({
      id: posts.id, userId: posts.userId, mediaUrl: posts.mediaUrl, thumbnailUrl: posts.thumbnailUrl,
      mediaUrls: posts.mediaUrls, slides: posts.slides, mediaType: posts.mediaType, aspectRatio: posts.aspectRatio,
      ...postDimsColumns,
      caption: posts.caption, hashtags: posts.hashtags, styleTags: posts.styleTags, sound: posts.sound,
      visibility: posts.visibility, createdAt: posts.createdAt,
      creditHandle: posts.creditHandle, creditName: posts.creditName,
      displayName: users.displayName, brandName: users.brandName, username: users.username,
      isOfficialAccount: users.isOfficialAccount,
      verified: users.verified, verificationStatus: users.verificationStatus,
      activeStanding: users.activeStanding, policyRestricted: users.policyRestricted,
    })
    .from(posts)
    .innerJoin(users, eq(users.clerkId, posts.userId))
    .where(inArray(posts.id, postIds));

  const [interactionRows, saveRows, comments] = await Promise.all([
    db.select({ postId: interactions.postId, type: interactions.type, n: count() })
      .from(interactions)
      .where(and(inArray(interactions.postId, postIds), inArray(interactions.type, ["like", "repost", "share"])))
      .groupBy(interactions.postId, interactions.type),
    db.select({ postId: savedItems.targetId, n: count() })
      .from(savedItems)
      .where(and(inArray(savedItems.targetId, postIds), eq(savedItems.itemType, "post")))
      .groupBy(savedItems.targetId),
    visibleCommentCounts(postIds),
  ]);
  const counter = (type: string) => new Map(
    interactionRows.filter((r) => r.type === type).map((r) => [r.postId as string, Number(r.n)]),
  );
  const likes = counter("like");
  const reposts = counter("repost");
  const shares = counter("share");
  const saves = new Map(saveRows.map((r) => [r.postId, Number(r.n)]));

  const base = rows.map((p) => ({
    id: p.id, userId: p.userId, mediaUrl: p.mediaUrl, thumbnailUrl: p.thumbnailUrl,
    mediaUrls: p.mediaUrls, slides: p.slides, mediaType: p.mediaType, aspectRatio: p.aspectRatio,
    ...postDimsPayload(p),
    caption: p.caption, hashtags: p.hashtags, styleTags: p.styleTags, sound: p.sound,
    visibility: p.visibility, createdAt: p.createdAt,
    creditHandle: p.creditHandle, creditName: p.creditName,
    seller: {
      displayName: p.displayName, brandName: p.brandName, username: p.username ?? null,
      verified: deriveSellerVerified(p), isOfficial: p.isOfficialAccount === true,
    },
    taggedProducts: [] as unknown[],
    likesCount: p.visibility?.showLikeCount === false ? null : likes.get(p.id) ?? 0,
    repostsCount: reposts.get(p.id) ?? 0,
    sharesCount: shares.get(p.id) ?? 0,
    savesCount: saves.get(p.id) ?? 0,
    commentsCount: comments.get(p.id) ?? 0,
    official: true as const,
  }));
  return attachCredits(base);
}

export type OfficialSeedPost = Awaited<ReturnType<typeof hydrateOfficialPosts>>[number];

export type OfficialSeedResponse =
  | { seeding: false; reason: string }
  | {
      seeding: true;
      every: number;
      items: Array<{ type: "organic"; id: string } | { type: "official"; post: OfficialSeedPost }>;
      dropped: string[];
      cursor: SeedCursor;
    };

/**
 * Plans one page of the viewer's Threads (For You) feed. `organicIds` is the
 * page of organic posts the client fetched (in order); which of them are
 * official is looked up here, never trusted from the client.
 */
export async function planOfficialSeed(input: {
  viewerId: string;
  organicIds: string[];
  cursor: SeedCursor;
  exclude: string[];
  isLastPage: boolean;
  /** Admin-only: ignore the new-user window and seen history to preview the experience. */
  preview?: boolean;
  now?: Date;
}): Promise<OfficialSeedResponse> {
  const now = input.now ?? new Date();
  const [viewerRows, progressRows] = await Promise.all([
    db.select({ createdAt: users.createdAt }).from(users).where(eq(users.clerkId, input.viewerId)).limit(1),
    db.select({ threadsViewed: officialSeedProgress.threadsViewed }).from(officialSeedProgress)
      .where(eq(officialSeedProgress.userId, input.viewerId)).limit(1),
  ]);
  const [candidates, poolSize] = await Promise.all([
    unseenOfficialPostIds(input.viewerId, input.exclude, input.preview === true, now),
    realPostPoolSize(now),
  ]);
  const eligibility = seedEligibility({
    accountCreatedAt: input.preview ? now : viewerRows[0]?.createdAt ?? null,
    now,
    threadsViewed: input.preview ? 0 : progressRows[0]?.threadsViewed ?? 0,
    poolSize,
    unseenCount: candidates.length,
  });
  if (!eligibility.eligible) return { seeding: false, reason: eligibility.reason };

  const officialOrganic = input.organicIds.length === 0 ? new Set<string>() : new Set(
    (await db.select({ id: posts.id }).from(posts)
      .where(and(inArray(posts.id, input.organicIds), eq(posts.userId, OFFICIAL_ACCOUNT_CLERK_ID))))
      .map((r) => r.id),
  );
  const plan = planSeedPage({
    organic: input.organicIds.map((id) => ({ id, official: officialOrganic.has(id) })),
    candidates,
    cursor: input.cursor,
    every: eligibility.every,
    isLastPage: input.isLastPage,
  });
  const officialIds = plan.items.filter((i): i is Extract<SeedPageItem, { kind: "official" }> => i.kind === "official").map((i) => i.id);
  const hydrated = new Map((await hydrateOfficialPosts(officialIds)).map((p) => [p.id, p]));
  type Item = Extract<OfficialSeedResponse, { seeding: true }>["items"][number];
  const items = plan.items.flatMap((item): Item[] => {
    if (item.kind === "organic") return [{ type: "organic", id: item.id }];
    const post = hydrated.get(item.id);
    return post ? [{ type: "official", post }] : [];
  });
  return { seeding: true, every: eligibility.every, items, dropped: plan.dropped, cursor: plan.cursor };
}

/**
 * Records progress for a viewer in the seeding window: official posts that were
 * actually on screen (never seeded again) and how many Threads they viewed.
 * Ids that are not official posts are ignored.
 */
export async function recordOfficialSeedProgress(input: {
  viewerId: string;
  seenPostIds: string[];
  viewedCount: number;
  now?: Date;
}): Promise<{ recorded: number }> {
  const now = input.now ?? new Date();
  let recorded = 0;
  if (input.seenPostIds.length > 0) {
    const official = await db.select({ id: posts.id }).from(posts)
      .where(and(inArray(posts.id, input.seenPostIds), eq(posts.userId, OFFICIAL_ACCOUNT_CLERK_ID)));
    if (official.length > 0) {
      const inserted = await db.insert(officialSeedImpressions)
        .values(official.map((p) => ({ userId: input.viewerId, postId: p.id, seenAt: now })))
        .onConflictDoNothing()
        .returning({ postId: officialSeedImpressions.postId });
      recorded = inserted.length;
    }
  }
  const viewed = Math.max(0, Math.min(100, Math.floor(input.viewedCount)));
  if (viewed > 0) {
    await db.insert(officialSeedProgress)
      .values({ userId: input.viewerId, threadsViewed: viewed, updatedAt: now })
      .onConflictDoUpdate({
        target: officialSeedProgress.userId,
        set: { threadsViewed: sql`${officialSeedProgress.threadsViewed} + ${viewed}`, updatedAt: now },
      });
  }
  return { recorded };
}
