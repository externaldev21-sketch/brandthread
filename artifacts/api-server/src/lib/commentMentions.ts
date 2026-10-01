/**
 * Comment @mentions: the server-side rules. Mirrors `sanitizeStoryMentions`
 * (storyMentions.ts): anything that can't be tagged — yourself, a missing,
 * deleted or suspended account, anyone blocked in either direction — is
 * dropped silently, so a mention can never be used to reach someone who has
 * blocked you (or whom you blocked).
 */
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { blocks, commentMentions, db, users } from "@workspace/db";
import { extractMentions } from "./activityEvents";

export const MAX_COMMENT_MENTIONS = 5;

export interface CommentMention {
  userId: string;
  handle: string;
}

/** Resolve the @handles in `body` into taggable people (capped, in body order). */
export async function resolveCommentMentions(body: string, authorId: string): Promise<CommentMention[]> {
  const handles = extractMentions(body);
  if (handles.length === 0) return [];
  const [found, blockRows] = await Promise.all([
    db.select({ clerkId: users.clerkId, username: users.username })
      .from(users)
      .where(and(inArray(sql`lower(${users.username})`, handles), isNull(users.deletedAt), isNull(users.suspendedAt))),
    db.select({ blockerId: blocks.blockerId, blockedId: blocks.blockedId })
      .from(blocks)
      .where(or(eq(blocks.blockerId, authorId), eq(blocks.blockedId, authorId))),
  ]);
  const blocked = new Set(blockRows.map((r) => (r.blockerId === authorId ? r.blockedId : r.blockerId)));
  const byHandle = new Map(found.filter((u) => u.username).map((u) => [u.username!.toLowerCase(), u]));
  const out: CommentMention[] = [];
  const taken = new Set<string>();
  for (const handle of handles) {
    const user = byHandle.get(handle);
    if (!user || user.clerkId === authorId || blocked.has(user.clerkId) || taken.has(user.clerkId)) continue;
    if (out.length >= MAX_COMMENT_MENTIONS) break;
    taken.add(user.clerkId);
    out.push({ userId: user.clerkId, handle: user.username! });
  }
  return out;
}

export async function recordCommentMentions(commentId: string, mentions: CommentMention[]): Promise<void> {
  if (mentions.length === 0) return;
  await db.insert(commentMentions)
    .values(mentions.map((m) => ({ commentId, mentionedUserId: m.userId })))
    .onConflictDoNothing();
}

/** Mentions for many comments at once (handles come from the users table). */
export async function mentionsForComments(commentIds: string[]): Promise<Map<string, CommentMention[]>> {
  const out = new Map<string, CommentMention[]>();
  if (commentIds.length === 0) return out;
  const rows = await db
    .select({ commentId: commentMentions.commentId, userId: users.clerkId, handle: users.username })
    .from(commentMentions)
    .innerJoin(users, eq(users.clerkId, commentMentions.mentionedUserId))
    .where(and(inArray(commentMentions.commentId, commentIds), isNull(users.deletedAt), isNull(users.suspendedAt)));
  for (const r of rows) {
    if (!r.handle) continue;
    const list = out.get(r.commentId) ?? [];
    list.push({ userId: r.userId, handle: r.handle });
    out.set(r.commentId, list);
  }
  return out;
}
