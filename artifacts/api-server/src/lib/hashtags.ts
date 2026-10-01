/**
 * Hashtag normalisation, caption extraction and index sync.
 *
 * A tag is stored lowercase, NFKC-normalised, without the leading '#', made of
 * unicode letters/marks, digits and '_', at most 30 characters. A post carries
 * at most 30 distinct tags.
 */
import { eq } from "drizzle-orm";
import { db, postHashtags } from "@workspace/db";
import { evaluateContent } from "./contentModerator";

export const MAX_TAG_LENGTH = 30;
export const MAX_TAGS_PER_POST = 30;

const DISALLOWED = /[^\p{L}\p{M}\p{Nd}_]/gu;
const CAPTION_TAG = /(?:^|[^\p{L}\p{M}\p{Nd}_&#/])#([\p{L}\p{M}\p{Nd}_]{1,60})/gu;

/** Normalise one raw tag; returns null when nothing usable is left. */
export function normalizeHashtag(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const tag = raw
    .normalize("NFKC")
    .toLowerCase()
    .replace(DISALLOWED, "")
    .slice(0, MAX_TAG_LENGTH);
  return tag.length > 0 ? tag : null;
}

/** Normalise, dedupe (first occurrence wins) and cap a list of raw tags. */
export function normalizeHashtags(raw: unknown, max = MAX_TAGS_PER_POST): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const item of raw) {
    const tag = normalizeHashtag(item);
    if (tag) seen.add(tag);
    if (seen.size >= max) break;
  }
  return [...seen];
}

/**
 * `#tags` written in a caption. Purely numeric tokens ("#1 seller", "#2")
 * are ordinals, not tags, so they are skipped here (an explicit hashtags
 * array may still carry them).
 */
export function extractHashtagsFromCaption(caption: unknown): string[] {
  if (typeof caption !== "string") return [];
  const text = caption.normalize("NFKC");
  if (!text.includes("#")) return [];
  const found: string[] = [];
  for (const match of text.matchAll(CAPTION_TAG)) {
    const tag = normalizeHashtag(match[1]);
    if (tag && !/^\p{Nd}+$/u.test(tag)) found.push(tag);
  }
  return found;
}

/** Explicit tags first, then tags found in the caption; normalised, deduped, capped. */
export function mergeHashtags(explicit: unknown, caption: unknown): string[] {
  return normalizeHashtags([
    ...(Array.isArray(explicit) ? explicit : []),
    ...extractHashtagsFromCaption(caption),
  ]);
}

/** True when a tag may appear on public surfaces (trending/search/tag pages). */
export function isTagAllowedPublicly(tag: string): boolean {
  return evaluateContent(tag, "public").action === "allow"
    && evaluateContent(tag.replace(/_/g, " "), "public").action === "allow";
}

type Executor = Pick<typeof db, "delete" | "insert">;

/** Replace the indexed tags of a post. Safe to call repeatedly. */
export async function syncPostHashtags(
  postId: string,
  tags: readonly string[],
  createdAt: Date,
  executor: Executor = db,
): Promise<void> {
  await executor.delete(postHashtags).where(eq(postHashtags.postId, postId));
  if (tags.length === 0) return;
  await executor
    .insert(postHashtags)
    .values(tags.map((tag) => ({ postId, tag, createdAt })))
    .onConflictDoNothing();
}
