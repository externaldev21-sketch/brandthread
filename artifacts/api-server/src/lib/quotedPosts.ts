/**
 * Quote repost read-side helpers.
 *
 * A quote is a normal `posts` row with `repost_kind = 'quote'` and
 * `quoted_post_id` pointing at the DIRECT original (a quote of a quote embeds
 * only the quote it was made from, never the whole chain).
 *
 * `attachQuoteData` decorates a page of already-built post payloads with
 * `quotedPost` and `quotesCount` using a fixed number of queries per page
 * (never per post):
 *   1. quote linkage for the page's ids
 *   2. the referenced originals (public + author info), one query
 *   3. the viewer's block set, one query (skipped when signed out)
 *   4. quote counts for the page's ids, one query
 */
import { and, count, eq, inArray, isNotNull } from "drizzle-orm";
import { db, posts, users } from "@workspace/db";
import { publicPostCondition } from "./postVisibility";
import { blockedUserIds } from "./safety";

export type QuotedPostAvailable = {
  id: string;
  userId: string;
  author: { displayName: string | null; brandName: string | null; username: string | null };
  caption: string;
  thumbnailUrl: string | null;
  mediaType: string;
};
export type QuotedPostUnavailable = { unavailable: true };
export type QuotedPost = QuotedPostAvailable | QuotedPostUnavailable | null;

export type QuoteFields = { quotedPost: QuotedPost; quotesCount: number };

/** Image to show for a post: its thumbnail, else the photo itself, else none (video without a thumbnail). */
export function postCardImage(p: { thumbnailUrl: string | null; mediaUrl: string; mediaType: string }): string | null {
  if (p.thumbnailUrl) return p.thumbnailUrl;
  if (p.mediaType !== "video" && p.mediaUrl) return p.mediaUrl;
  return null;
}

export async function attachQuoteData<T extends { id: string }>(
  items: T[],
  viewerId: string | null | undefined,
): Promise<Array<T & QuoteFields>> {
  if (items.length === 0) return [];
  const ids = [...new Set(items.map((item) => item.id))];

  const [linkRows, countRows] = await Promise.all([
    db.select({ id: posts.id, quotedPostId: posts.quotedPostId, repostKind: posts.repostKind })
      .from(posts)
      .where(and(inArray(posts.id, ids), eq(posts.repostKind, "quote"))),
    db.select({ quotedPostId: posts.quotedPostId, n: count() })
      .from(posts)
      .where(and(inArray(posts.quotedPostId, ids), isNotNull(posts.quotedPostId), publicPostCondition()))
      .groupBy(posts.quotedPostId),
  ]);

  const originalIds = [...new Set(linkRows.map((row) => row.quotedPostId).filter((v): v is string => !!v))];
  const [originals, blocked] = originalIds.length === 0
    ? [[], new Set<string>()]
    : await Promise.all([
        db.select({
          id: posts.id,
          userId: posts.userId,
          caption: posts.caption,
          mediaUrl: posts.mediaUrl,
          thumbnailUrl: posts.thumbnailUrl,
          mediaType: posts.mediaType,
          displayName: users.displayName,
          brandName: users.brandName,
          username: users.username,
          accountType: users.accountType,
        })
          .from(posts)
          .innerJoin(users, eq(users.clerkId, posts.userId))
          .where(and(inArray(posts.id, originalIds), publicPostCondition())),
        blockedUserIds(viewerId),
      ]);

  const originalById = new Map(originals.map((row) => [row.id, row]));
  const linkById = new Map(linkRows.map((row) => [row.id, row]));
  const quotesByPost = new Map(countRows.map((row) => [row.quotedPostId as string, Number(row.n)]));

  return items.map((item) => {
    const link = linkById.get(item.id);
    let quotedPost: QuotedPost = null;
    if (link) {
      const original = link.quotedPostId ? originalById.get(link.quotedPostId) : undefined;
      if (!original || blocked.has(original.userId)) {
        quotedPost = { unavailable: true };
      } else {
        quotedPost = {
          id: original.id,
          userId: original.userId,
          author: {
            displayName: original.displayName ?? null,
            brandName: original.accountType === "seller" ? original.brandName ?? null : null,
            username: original.username ?? null,
          },
          caption: original.caption ?? "",
          thumbnailUrl: postCardImage(original),
          mediaType: original.mediaType,
        };
      }
    }
    return { ...item, quotedPost, quotesCount: quotesByPost.get(item.id) ?? 0 };
  });
}
