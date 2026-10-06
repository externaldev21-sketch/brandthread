/**
 * Video remixes ("Allow remixes of videos", buyer Settings → Sharing and remixes).
 *
 * A remix is a new video post that starts from another account's published
 * video and records `posts.remix_of_post_id` (migration 119). The source
 * author's `remix_audience` decides who may remix:
 *   'everyone'  — anyone who can see the video
 *   'following' — only people the author follows
 *   'off'       — nobody
 * The server is the authority: routes/remix.ts answers "may I remix this?"
 * and copies the source clip, and POST /api/posts refuses a remixOfPostId the
 * viewer may not use with 403 REMIX_NOT_ALLOWED.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, follows, posts, users } from "@workspace/db";
import { publicPostCondition } from "./postVisibility";
import { isBlockedEitherWay } from "./safety";
import { loadInteractionSettings, type RemixAudience } from "./interactionSettings";

export type RemixRefusalCode =
  | "POST_NOT_FOUND"
  | "NOT_A_VIDEO"
  | "OWN_POST"
  | "REMIX_NOT_ALLOWED"
  | "SOURCE_UNAVAILABLE";

export interface RemixSource {
  id: string;
  authorId: string;
  authorUsername: string | null;
  mediaUrl: string;
  thumbnailUrl: string | null;
  /** Object path of the composed source video (only composed uploads can be remixed). */
  objectPath: string;
}

export type RemixCheck =
  | { allowed: true; source: RemixSource }
  | { allowed: false; code: RemixRefusalCode; status: 403 | 404 | 409 | 422; message: string };

/** Whether the author's audience setting lets this viewer remix. */
export function remixAllowedByAudience(input: {
  audience: RemixAudience;
  authorFollowsViewer: boolean;
}): boolean {
  if (input.audience === "off") return false;
  if (input.audience === "following") return input.authorFollowsViewer;
  return true;
}

export function remixRefusalMessage(audience: RemixAudience): string {
  return audience === "off"
    ? "This account doesn't allow remixes of its videos."
    : "Only people this account follows can remix its videos.";
}

/** "/objects/…" for a composed upload served at /api/posts/media/…; null otherwise. */
export function composedObjectPath(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const pathname = new URL(value, "https://brandthread.invalid").pathname;
    const marker = "/api/posts/media/";
    const index = pathname.indexOf(marker);
    if (index < 0) return null;
    const suffix = decodeURIComponent(pathname.slice(index + marker.length));
    if (!suffix || suffix.split("/").includes("..")) return null;
    return `/objects/${suffix.replace(/^\/+/, "")}`;
  } catch {
    return null;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** May `viewerId` remix `postId`? Every remix path goes through this. */
export async function checkRemix(postId: string, viewerId: string): Promise<RemixCheck> {
  const notFound = { allowed: false as const, code: "POST_NOT_FOUND" as const, status: 404 as const, message: "Post not found" };
  if (!UUID_RE.test(postId)) return notFound;
  const [post] = await db.select({
    id: posts.id,
    authorId: posts.userId,
    mediaType: posts.mediaType,
    mediaUrl: posts.mediaUrl,
    thumbnailUrl: posts.thumbnailUrl,
    authorUsername: users.username,
  }).from(posts)
    .leftJoin(users, eq(users.clerkId, posts.userId))
    .where(and(eq(posts.id, postId), publicPostCondition()))
    .limit(1);
  if (!post) return notFound;
  if (post.authorId !== viewerId && await isBlockedEitherWay(viewerId, post.authorId)) return notFound;
  if (post.mediaType !== "video") {
    return { allowed: false, code: "NOT_A_VIDEO", status: 422, message: "Only videos can be remixed." };
  }
  if (post.authorId === viewerId) {
    return { allowed: false, code: "OWN_POST", status: 422, message: "You can't remix your own video." };
  }
  const { remixAudience } = await loadInteractionSettings(post.authorId);
  let authorFollowsViewer = false;
  if (remixAudience === "following") {
    const [row] = await db.select({ followerId: follows.followerId }).from(follows)
      .where(and(eq(follows.followerId, post.authorId), eq(follows.followingId, viewerId)))
      .limit(1);
    authorFollowsViewer = !!row;
  }
  if (!remixAllowedByAudience({ audience: remixAudience, authorFollowsViewer })) {
    return { allowed: false, code: "REMIX_NOT_ALLOWED", status: 403, message: remixRefusalMessage(remixAudience) };
  }
  const objectPath = composedObjectPath(post.mediaUrl);
  if (!objectPath) {
    return { allowed: false, code: "SOURCE_UNAVAILABLE", status: 409, message: "This video can't be remixed." };
  }
  return {
    allowed: true,
    source: {
      id: post.id,
      authorId: post.authorId,
      authorUsername: post.authorUsername ?? null,
      mediaUrl: post.mediaUrl,
      thumbnailUrl: post.thumbnailUrl ?? null,
      objectPath,
    },
  };
}

export interface RemixCredit {
  postId: string;
  authorId: string;
  username: string | null;
}

/** "Remix of @handle" credits for posts that are remixes, keyed by the remix's id. */
export async function remixCredits(
  rows: Array<{ id: string; remixOfPostId?: string | null }>,
): Promise<Map<string, RemixCredit>> {
  const sourceIds = Array.from(new Set(rows.map((r) => r.remixOfPostId).filter((id): id is string => !!id)));
  const credits = new Map<string, RemixCredit>();
  if (sourceIds.length === 0) return credits;
  const sources = await db.select({ id: posts.id, authorId: posts.userId, username: users.username })
    .from(posts)
    .leftJoin(users, eq(users.clerkId, posts.userId))
    .where(inArray(posts.id, sourceIds));
  const byId = new Map(sources.map((s) => [s.id, s]));
  for (const row of rows) {
    const source = row.remixOfPostId ? byId.get(row.remixOfPostId) : undefined;
    if (source) credits.set(row.id, { postId: source.id, authorId: source.authorId, username: source.username ?? null });
  }
  return credits;
}
