/**
 * Photo replies in post comments (F6 item 83).
 *
 * The ONLY writer of comment photos is the moderated
 * `POST /api/comment-media/upload` route: it re-encodes the image (EXIF/GPS
 * stripped, long edge capped), screens it with the same automatic media
 * screening posts use, stores it under `comment-media/<userId>/` and records a
 * `post_comment_media` row. A comment then references that row by id (or by
 * the exact URL the upload returned); a pasted URL from anywhere else is
 * refused.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, postCommentMedia } from "@workspace/db";
import { IMMUTABLE_PUBLIC_CACHE_CONTROL } from "./productImageResize";

/** What a comment row carries to the client. */
export interface CommentMediaView {
  id: string;
  url: string;
  width: number;
  height: number;
}

export const COMMENT_MEDIA_MIME_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
/** Base64 payload cap (~15 MB of image bytes). */
export const MAX_COMMENT_MEDIA_BASE64 = 20 * 1024 * 1024;
/** Long edge of the stored photo. Comment photos never show larger than the screen. */
export const COMMENT_MEDIA_MAX_EDGE = 1600;

function bucketId(): string {
  return (process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID ?? "").trim();
}

export function commentMediaPrefix(): string | null {
  const id = bucketId();
  return id ? `https://storage.googleapis.com/${id}/comment-media/` : null;
}

/** True when `url` points at an object written by the comment-media upload route. */
export function isCommentMediaUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  const prefix = commentMediaPrefix();
  return !!prefix && url.startsWith(prefix) && !url.includes("..") && !url.includes("?") && !url.includes("#");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CommentMediaRef = { id: string } | { url: string };

/**
 * Parse the optional `media` field of POST .../comments.
 *  - absent / null → { ok: true, ref: null }
 *  - { id } with a uuid, or { url } on our comment-media prefix → { ok: true, ref }
 *  - anything else → { ok: false }
 */
export function parseCommentMediaInput(raw: unknown):
  | { ok: true; ref: CommentMediaRef | null }
  | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, ref: null };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "media must be an uploaded photo." };
  }
  const { id, url } = raw as { id?: unknown; url?: unknown };
  if (typeof id === "string" && UUID_RE.test(id)) return { ok: true, ref: { id } };
  if (id === undefined && isCommentMediaUrl(url)) return { ok: true, ref: { url } };
  return { ok: false, error: "Upload the photo through Brandthread first." };
}

export type CommentMediaRow = typeof postCommentMedia.$inferSelect;

/** An unattached upload owned by `ownerId` matching `ref`, or null. */
export async function findAttachableMedia(ref: CommentMediaRef, ownerId: string): Promise<CommentMediaRow | null> {
  const [row] = await db
    .select()
    .from(postCommentMedia)
    .where(and(
      eq(postCommentMedia.ownerId, ownerId),
      isNull(postCommentMedia.commentId),
      "id" in ref ? eq(postCommentMedia.id, ref.id) : eq(postCommentMedia.url, ref.url),
    ))
    .limit(1);
  return row ?? null;
}

export function isHeldUpload(row: Pick<CommentMediaRow, "moderationVerdict">): boolean {
  return row.moderationVerdict === "hold";
}

/** Photos for a set of comments, keyed by comment id. */
export async function mediaForComments(commentIds: string[]): Promise<Map<string, CommentMediaView>> {
  const out = new Map<string, CommentMediaView>();
  if (commentIds.length === 0) return out;
  const rows = await db
    .select({
      id: postCommentMedia.id,
      commentId: postCommentMedia.commentId,
      url: postCommentMedia.url,
      width: postCommentMedia.width,
      height: postCommentMedia.height,
    })
    .from(postCommentMedia)
    .where(inArray(postCommentMedia.commentId, commentIds));
  for (const row of rows) {
    if (row.commentId) out.set(row.commentId, { id: row.id, url: row.url, width: row.width, height: row.height });
  }
  return out;
}

export function toMediaView(row: CommentMediaRow): CommentMediaView {
  return { id: row.id, url: row.url, width: row.width, height: row.height };
}

// ─── Storage seam ─────────────────────────────────────────────────────────────

export class CommentMediaStorageNotConfiguredError extends Error {}

export type CommentMediaStore = (input: { buffer: Buffer; mimeType: string; userId: string }) => Promise<string>;

const gcsStore: CommentMediaStore = async ({ buffer, mimeType, userId }) => {
  const id = bucketId();
  if (!id) throw new CommentMediaStorageNotConfiguredError("Object storage not configured");
  const filename = `comment-media/${userId}/${randomUUID()}.jpg`;
  const { objectStorageClient } = await import("./objectStorage");
  const file = objectStorageClient.bucket(id).file(filename);
  // Object keys are random UUIDs and never rewritten, so they can be cached forever.
  await file.save(buffer, {
    contentType: mimeType,
    resumable: false,
    metadata: { cacheControl: IMMUTABLE_PUBLIC_CACHE_CONTROL },
  });
  await file.makePublic();
  return `https://storage.googleapis.com/${id}/${filename}`;
};

let store: CommentMediaStore = gcsStore;

/** Test seam. Pass nothing to restore the default store. */
export function setCommentMediaStore(next?: CommentMediaStore): void {
  store = next ?? gcsStore;
}

export function storeCommentMedia(input: { buffer: Buffer; mimeType: string; userId: string }): Promise<string> {
  return store(input);
}
