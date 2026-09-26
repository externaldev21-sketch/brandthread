/**
 * Activity Center event publishers.
 *
 * Every function here writes to the shared `notifications_feed` through
 * `publishNotification()` (so push delivery and preferences stay in one place)
 * and is deliberately non-throwing: a notification failure must never fail the
 * like, comment, price change or product publish that caused it. Callers fire
 * these without awaiting the HTTP response.
 *
 * Event types published here (all `category: "social"`):
 *   post_like      — someone liked your post            (actor, post thumbnail)
 *   post_comment   — someone commented on your post     (actor, post thumbnail)
 *   comment_reply  — someone replied to your comment    (actor, post thumbnail)
 *   mention        — someone @mentioned you in a comment (actor, post thumbnail)
 *   new_product    — a brand you follow listed something (brand, product image)
 *
 * price_drop and back_in_stock are published from ./stockNotifications
 * instead (merged from the push-notifications work), which also owns the
 * seller-facing low/out-of-stock alert.
 */
import {
  db, follows, notificationsFeed, posts, products, stories, users,
} from "@workspace/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { publishNotification } from "../routes/notifications-feed";
import { blockedUserIds, profilesById, type ProfileSummary } from "./safety";
import { logger } from "./logger";

const AVATAR_COLORS = [
  "#8B5CF6", "#EC4899", "#3B82F6", "#10B981", "#F59E0B",
  "#EF4444", "#6366F1", "#14B8A6", "#F97316", "#64748B",
];

/** Stable per-user avatar colour (same hash the social routes use). */
export function avatarColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

/** Large follower lists are fanned out in small parallel batches. */
const FANOUT_BATCH = 10;
const MAX_MENTIONS = 10;

export interface ActorFields {
  actorId: string;
  actorName: string;
  actorHandle?: string;
  actorInitials: string;
  actorColor: string;
}

export function actorFieldsFromProfile(profile: ProfileSummary): ActorFields {
  return {
    actorId: profile.userId,
    actorName: profile.name,
    actorHandle: profile.handle || undefined,
    actorInitials: profile.initials || "?",
    actorColor: avatarColor(profile.userId),
  };
}

async function actorFields(userId: string): Promise<ActorFields | null> {
  const profile = (await profilesById([userId])).get(userId);
  if (!profile || profile.deleted || profile.suspended) return null;
  return actorFieldsFromProfile(profile);
}

function excerpt(text: string, max = 120): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/** Best thumbnail for a post: explicit thumbnail, else a still image. */
export function postThumbnail(post: {
  thumbnailUrl: string | null;
  mediaUrl: string | null;
  mediaUrls?: string[] | null;
  mediaType: string | null;
}): string | null {
  if (post.thumbnailUrl) return post.thumbnailUrl;
  if (post.mediaType !== "video" && post.mediaUrl) return post.mediaUrl;
  const first = post.mediaUrls?.find((url) => typeof url === "string" && url.length > 0);
  return post.mediaType !== "video" && first ? first : null;
}

export function productThumbnail(images: unknown): string | null {
  if (!Array.isArray(images)) return null;
  const first = images.find((value) => typeof value === "string" && value.length > 0);
  return typeof first === "string" ? first : null;
}

/** `@handle` tokens in a comment, lower-cased and de-duplicated. */
export function extractMentions(body: string): string[] {
  const handles = new Set<string>();
  const re = /(^|[^\w@.])@([A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) && handles.size < MAX_MENTIONS) {
    handles.add(match[2].toLowerCase());
  }
  return [...handles];
}

async function fanOut<T>(items: T[], send: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += FANOUT_BATCH) {
    await Promise.all(items.slice(i, i + FANOUT_BATCH).map((item) =>
      send(item).catch((err) => logger.warn({ err }, "Activity notification delivery failed"))));
  }
}

async function loadPost(postId: string) {
  const [post] = await db
    .select({
      id: posts.id,
      userId: posts.userId,
      thumbnailUrl: posts.thumbnailUrl,
      mediaUrl: posts.mediaUrl,
      mediaUrls: posts.mediaUrls,
      mediaType: posts.mediaType,
    })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);
  return post ?? null;
}

// ─── Post likes ───────────────────────────────────────────────────────────────

/**
 * Tell a post's owner someone liked it. A like → unlike → like toggle from the
 * same person produces one notification, not three.
 */
export async function notifyPostLike(input: { postId: string; likerId: string }): Promise<void> {
  try {
    const post = await loadPost(input.postId);
    if (!post || post.userId === input.likerId) return;

    const [existing] = await db
      .select({ id: notificationsFeed.id })
      .from(notificationsFeed)
      .where(and(
        eq(notificationsFeed.userId, post.userId),
        eq(notificationsFeed.type, "post_like"),
        eq(notificationsFeed.targetId, post.id),
        eq(notificationsFeed.actorId, input.likerId),
      ))
      .limit(1);
    if (existing) return;

    const actor = await actorFields(input.likerId);
    if (!actor) return;

    await publishNotification({
      userId: post.userId,
      category: "social",
      type: "post_like",
      title: `${actor.actorName} liked your post`,
      ...actor,
      targetId: post.id,
      targetType: "post",
      targetImageUrl: postThumbnail(post),
    });
  } catch (err) {
    logger.warn({ err, postId: input.postId }, "Post like notification failed");
  }
}

// ─── Reposts ──────────────────────────────────────────────────────────────────

/** Tell a post's owner someone reposted it. Idempotent per (owner, reposter, post). */
export async function notifyRepost(input: { postId: string; reposterId: string }): Promise<void> {
  try {
    const post = await loadPost(input.postId);
    if (!post || post.userId === input.reposterId) return;
    if ((await blockedUserIds(post.userId)).has(input.reposterId)) return;

    const [existing] = await db
      .select({ id: notificationsFeed.id })
      .from(notificationsFeed)
      .where(and(
        eq(notificationsFeed.userId, post.userId),
        eq(notificationsFeed.type, "repost"),
        eq(notificationsFeed.targetId, post.id),
        eq(notificationsFeed.actorId, input.reposterId),
      ))
      .limit(1);
    if (existing) return;

    const actor = await actorFields(input.reposterId);
    if (!actor) return;

    await publishNotification({
      userId: post.userId,
      category: "social",
      type: "repost",
      title: `${actor.actorName} reposted your post`,
      ...actor,
      targetId: post.id,
      targetType: "post",
      targetImageUrl: postThumbnail(post),
    });
  } catch (err) {
    logger.warn({ err, postId: input.postId }, "Repost notification failed");
  }
}

// ─── Story / highlight likes ──────────────────────────────────────────────────

/**
 * Tell a story's author someone liked it. Highlights are saved stories with
 * no separate backend identity, so this covers both "liked your story" and
 * "liked your highlight" — the client renders the same event either way.
 */
export async function notifyStoryLike(input: { storyId: string; likerId: string }): Promise<void> {
  try {
    const [story] = await db
      .select({ id: stories.id, authorId: stories.authorId, media: stories.media })
      .from(stories)
      .where(eq(stories.id, input.storyId))
      .limit(1);
    if (!story || story.authorId === input.likerId) return;
    if ((await blockedUserIds(story.authorId)).has(input.likerId)) return;

    const [existing] = await db
      .select({ id: notificationsFeed.id })
      .from(notificationsFeed)
      .where(and(
        eq(notificationsFeed.userId, story.authorId),
        eq(notificationsFeed.type, "story_like"),
        eq(notificationsFeed.targetId, story.id),
        eq(notificationsFeed.actorId, input.likerId),
      ))
      .limit(1);
    if (existing) return;

    const actor = await actorFields(input.likerId);
    if (!actor) return;
    const media = Array.isArray(story.media) ? story.media : [];
    const thumbnail = media.find((m: any) => typeof m?.url === "string")?.url ?? null;

    await publishNotification({
      userId: story.authorId,
      category: "social",
      type: "story_like",
      title: `${actor.actorName} liked your story`,
      ...actor,
      targetId: story.id,
      targetType: "story",
      targetImageUrl: thumbnail,
    });
  } catch (err) {
    logger.warn({ err, storyId: input.storyId }, "Story like notification failed");
  }
}

// ─── Thread Cash ──────────────────────────────────────────────────────────────

/** Tell the recipient someone sent them Thread Cash. Idempotent per transfer. */
export async function notifyThreadCashReceived(input: {
  transferId: string;
  fromUserId: string;
  toUserId: string;
  amountCents: number;
}): Promise<void> {
  try {
    if (input.toUserId === input.fromUserId) return;
    if ((await blockedUserIds(input.toUserId)).has(input.fromUserId)) return;

    const [existing] = await db
      .select({ id: notificationsFeed.id })
      .from(notificationsFeed)
      .where(and(
        eq(notificationsFeed.userId, input.toUserId),
        eq(notificationsFeed.type, "thread_cash_received"),
        eq(notificationsFeed.targetId, input.transferId),
      ))
      .limit(1);
    if (existing) return;

    const actor = await actorFields(input.fromUserId);
    if (!actor) return;
    const dollars = (input.amountCents / 100).toLocaleString(undefined, {
      style: "currency",
      currency: "USD",
    });

    await publishNotification({
      userId: input.toUserId,
      category: "social",
      type: "thread_cash_received",
      title: `${actor.actorName} sent you Thread Cash`,
      body: `${dollars} · tap to view`,
      ...actor,
      targetId: input.transferId,
      targetType: "thread_cash_transfer",
    });
  } catch (err) {
    logger.warn({ err, transferId: input.transferId }, "Thread Cash notification failed");
  }
}

// ─── Comments, replies and mentions ───────────────────────────────────────────

/**
 * One visible comment can notify three kinds of people; each person hears
 * about it once, in priority order: the post owner (post_comment), the author
 * of the comment being replied to (comment_reply), then anyone @mentioned.
 * The commenter is never notified, and blocked relationships are respected.
 */
export async function notifyCommentActivity(input: {
  postId: string;
  commentId: string;
  authorId: string;
  body: string;
  parentAuthorId?: string | null;
}): Promise<void> {
  try {
    const post = await loadPost(input.postId);
    if (!post) return;
    const actor = await actorFields(input.authorId);
    if (!actor) return;

    const blocked = await blockedUserIds(input.authorId);
    const notified = new Set<string>([input.authorId]);
    const thumbnail = postThumbnail(post);
    const preview = excerpt(input.body);
    const base = {
      category: "social",
      body: preview,
      ...actor,
      targetId: post.id,
      targetType: "post",
      targetImageUrl: thumbnail,
    } as const;

    const deliveries: Array<Parameters<typeof publishNotification>[0]> = [];
    if (!notified.has(post.userId) && !blocked.has(post.userId)) {
      notified.add(post.userId);
      deliveries.push({ ...base, userId: post.userId, type: "post_comment", title: `${actor.actorName} commented on your post` });
    }
    if (input.parentAuthorId && !notified.has(input.parentAuthorId) && !blocked.has(input.parentAuthorId)) {
      notified.add(input.parentAuthorId);
      deliveries.push({ ...base, userId: input.parentAuthorId, type: "comment_reply", title: `${actor.actorName} replied to your comment` });
    }

    const handles = extractMentions(input.body);
    if (handles.length > 0) {
      const mentioned = await db
        .select({ clerkId: users.clerkId })
        .from(users)
        .where(and(inArray(sql`lower(${users.username})`, handles), isNull(users.deletedAt)));
      for (const { clerkId } of mentioned) {
        if (notified.has(clerkId) || blocked.has(clerkId)) continue;
        notified.add(clerkId);
        deliveries.push({ ...base, userId: clerkId, type: "mention", title: `${actor.actorName} mentioned you in a comment` });
      }
    }

    await fanOut(deliveries, (delivery) => publishNotification(delivery));
  } catch (err) {
    logger.warn({ err, postId: input.postId, commentId: input.commentId }, "Comment notification failed");
  }
}

// ─── Saved-product alerts ─────────────────────────────────────────────────────

async function loadListedProduct(productId: string) {
  const [product] = await db
    .select({
      id: products.id,
      ownerId: products.ownerId,
      name: products.name,
      status: products.status,
      images: products.images,
      deletedAt: products.deletedAt,
    })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  if (!product || product.deletedAt || product.status !== "active") return null;
  return product;
}

async function brandActor(ownerId: string): Promise<ActorFields | null> {
  return actorFields(ownerId);
}

// ─── Followed brands ──────────────────────────────────────────────────────────

/**
 * Tell a brand's followers about a newly listed product. The partial unique
 * index on (user, type, target) keeps this to one alert per follower even if
 * the listing is unpublished and published again.
 */
export async function notifyNewProduct(input: { productId: string }): Promise<void> {
  try {
    const product = await loadListedProduct(input.productId);
    if (!product) return;
    const followerRows = await db
      .select({ followerId: follows.followerId })
      .from(follows)
      .where(eq(follows.followingId, product.ownerId));
    const followers = followerRows.map((row) => row.followerId).filter((id) => id !== product.ownerId);
    if (followers.length === 0) return;
    const actor = await brandActor(product.ownerId);
    if (!actor) return;
    const image = productThumbnail(product.images);

    await fanOut(followers, (userId) => publishNotification({
      userId,
      category: "social",
      type: "new_product",
      title: `${actor.actorName} just listed ${product.name}`,
      body: "New from a brand you follow.",
      ...actor,
      targetId: product.id,
      targetType: "product",
      targetImageUrl: image,
      pushCategory: "drop",
    }));
  } catch (err) {
    logger.warn({ err, productId: input.productId }, "New product notification failed");
  }
}
