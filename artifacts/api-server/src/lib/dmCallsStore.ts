/**
 * Database access for 1:1 DM calls (table dm_calls, migration 118).
 * Every state change is a conditional UPDATE (WHERE id = ? AND status = ?),
 * so of two concurrent transitions only one can win.
 */
import { blocks, conversationParticipants, conversations, db, dmCalls, users } from "@workspace/db";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import {
  LIVE_CALL_STATUSES,
  type DmCallRole,
  type DmCallMode,
  type DmCallPeerSource,
  type DmCallRow,
  type DmCallStatus,
  transitionPatch,
} from "./dmCalls";

export async function getConversationForCall(conversationId: string): Promise<{ id: string; deletedAt: Date | null } | undefined> {
  const [row] = await db.select({ id: conversations.id, deletedAt: conversations.deletedAt })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  return row;
}

export async function getCallParticipants(conversationId: string): Promise<DmCallPeerSource[]> {
  return db.select({
    userId: conversationParticipants.userId,
    name: conversationParticipants.name,
    initials: conversationParticipants.initials,
    color: conversationParticipants.color,
  }).from(conversationParticipants)
    .where(eq(conversationParticipants.conversationId, conversationId));
}

/** True when either user has blocked the other. */
export async function isBlockedEitherWay(a: string, b: string): Promise<boolean> {
  const rows = await db.select({ blockerId: blocks.blockerId })
    .from(blocks)
    .where(or(
      and(eq(blocks.blockerId, a), eq(blocks.blockedId, b)),
      and(eq(blocks.blockerId, b), eq(blocks.blockedId, a)),
    ))
    .limit(1);
  return rows.length > 0;
}

/** Profile image per Clerk user id (profile_image_url, falling back to avatar_url). */
export async function getAvatarUrls(userIds: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return out;
  const rows = await db.select({
    clerkId: users.clerkId,
    profileImageUrl: users.profileImageUrl,
    avatarUrl: users.avatarUrl,
  }).from(users)
    .where(inArray(users.clerkId, ids));
  for (const r of rows) out.set(r.clerkId, r.profileImageUrl || r.avatarUrl || null);
  return out;
}

export async function getCall(callId: string): Promise<DmCallRow | undefined> {
  const [row] = await db.select().from(dmCalls).where(eq(dmCalls.id, callId)).limit(1);
  return row as DmCallRow | undefined;
}

/** Ringing/accepted calls the user is on, either side. */
export async function getLiveCallsForUser(userId: string): Promise<DmCallRow[]> {
  const rows = await db.select().from(dmCalls)
    .where(and(
      or(eq(dmCalls.callerId, userId), eq(dmCalls.calleeId, userId)),
      inArray(dmCalls.status, LIVE_CALL_STATUSES),
    ));
  return rows as DmCallRow[];
}

export async function getRingingCallsForCallee(userId: string): Promise<DmCallRow[]> {
  const rows = await db.select().from(dmCalls)
    .where(and(eq(dmCalls.calleeId, userId), eq(dmCalls.status, "ringing")))
    .orderBy(desc(dmCalls.createdAt));
  return rows as DmCallRow[];
}

export async function listConversationCalls(conversationId: string, limit: number): Promise<DmCallRow[]> {
  const rows = await db.select().from(dmCalls)
    .where(eq(dmCalls.conversationId, conversationId))
    .orderBy(desc(dmCalls.createdAt))
    .limit(limit);
  return rows as DmCallRow[];
}

export async function insertCall(values: {
  id: string;
  conversationId: string;
  callerId: string;
  calleeId: string;
  mode: DmCallMode;
  channelName: string;
}): Promise<DmCallRow> {
  const [row] = await db.insert(dmCalls).values({ ...values, status: "ringing" }).returning();
  return row as DmCallRow;
}

/**
 * Move a call from `from` to `next` only if it is still in `from`.
 * Returns the updated row, or undefined when another request got there first.
 */
export async function transitionCall(
  callId: string,
  from: DmCallStatus,
  next: DmCallStatus,
  actorId: string | null,
  endReason?: string,
): Promise<DmCallRow | undefined> {
  const patch = transitionPatch(next, actorId);
  if (endReason && next !== "accepted") patch.endReason = endReason;
  const [row] = await db.update(dmCalls)
    .set(patch)
    .where(and(eq(dmCalls.id, callId), eq(dmCalls.status, from)))
    .returning();
  return row as DmCallRow | undefined;
}

/** Store one side's call-quality rating (overwrites any earlier answer). */
export async function setCallQualityRating(
  callId: string,
  role: DmCallRole,
  rating: "good" | "not_good",
): Promise<void> {
  await db.update(dmCalls)
    .set(role === "caller" ? { qualityRatingCaller: rating } : { qualityRatingCallee: rating })
    .where(eq(dmCalls.id, callId));
}
