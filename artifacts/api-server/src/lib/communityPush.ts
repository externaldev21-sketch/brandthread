/**
 * Throttled push for community chats.
 *
 * A busy group can produce hundreds of messages a minute, so pushes are
 * batched PER COMMUNITY, not per message or per member-message:
 *
 *   - every message bumps `communities.push_pending_count` (one row update);
 *   - if the chat hasn't pushed within the window (default 3 min) the batch
 *     goes out immediately: a single message reads "Sender: text", several
 *     read "12 new messages in Graphic Design Community";
 *   - otherwise the periodic job flushes it when the window closes.
 *
 * Recipients = members who are NOT muted, still have unread (their read
 * cursor is behind), and don't have the chat open live. Muted members are
 * never selected, so muting really does stop notifications.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";
import { sendPushToUser } from "./push";
import { connectedUserIds } from "../ws/communityHub";
import { scheduleJob } from "../jobs/runner";

export const COMMUNITY_PUSH_WINDOW_MS = Number(process.env.COMMUNITY_PUSH_WINDOW_MS) || 3 * 60_000;
const PAGE = 500;
const CONCURRENCY = 20;

export function communityPushBody(input: { name: string; count: number; sender: string | null; preview: string | null }): string {
  if (input.count <= 1) {
    const text = (input.preview ?? "Sent a message").slice(0, 120);
    return input.sender ? `${input.sender}: ${text}` : text;
  }
  return `${input.count} new messages in ${input.name}`;
}

/** Records a message for the next push batch and flushes it if the window is open. */
export async function noteCommunityMessage(input: {
  communityId: string; senderName: string; preview: string;
}): Promise<void> {
  await db.execute(sql`
    UPDATE communities
    SET push_pending_count = push_pending_count + 1,
        push_pending_sender = ${input.senderName},
        push_pending_preview = ${input.preview}
    WHERE id = ${input.communityId}::uuid
  `);
  await flushCommunityPush(input.communityId);
}

/**
 * Sends the pending batch when the throttle window allows. Returns the number
 * of recipients pushed (0 when throttled / nothing pending / everyone muted).
 */
export async function flushCommunityPush(communityId: string, windowMs = COMMUNITY_PUSH_WINDOW_MS): Promise<number> {
  const windowSeconds = windowMs / 1000;
  // Atomic claim: only one caller wins the batch, and it resets the counter.
  const claim = await db.execute(sql`
    WITH old AS (
      SELECT id, push_pending_count AS c, push_pending_sender AS s, push_pending_preview AS p
      FROM communities
      WHERE id = ${communityId}::uuid AND deleted_at IS NULL
        AND push_pending_count > 0
        AND (last_push_at IS NULL OR last_push_at <= now() - make_interval(secs => ${windowSeconds}))
      FOR UPDATE
    )
    UPDATE communities x
    SET push_pending_count = 0, last_push_at = now()
    FROM old
    WHERE x.id = old.id
    RETURNING x.id, x.name, x.last_seq, old.c AS count, old.s AS sender, old.p AS preview
  `);
  const row = (claim as any).rows?.[0] as
    | { id: string; name: string; last_seq: string | number; count: number; sender: string | null; preview: string | null }
    | undefined;
  if (!row) return 0;

  const lastSeq = Number(row.last_seq);
  const live = connectedUserIds(communityId);
  const body = communityPushBody({ name: row.name, count: row.count, sender: row.sender, preview: row.preview });
  let pushed = 0;
  let cursor = "";
  for (;;) {
    const page = await db.execute(sql`
      SELECT user_id FROM community_members
      WHERE community_id = ${communityId}::uuid
        AND muted = false
        AND last_read_seq < ${lastSeq}
        AND user_id > ${cursor}
      ORDER BY user_id
      LIMIT ${PAGE}
    `);
    const ids = ((page as any).rows as { user_id: string }[]).map((r) => r.user_id);
    if (ids.length === 0) break;
    cursor = ids[ids.length - 1];
    const targets = ids.filter((id) => !live.has(id));
    for (let i = 0; i < targets.length; i += CONCURRENCY) {
      await Promise.all(targets.slice(i, i + CONCURRENCY).map((userId) =>
        sendPushToUser(
          userId,
          {
            title: row.name,
            body,
            data: { type: "community_message", targetType: "community", targetId: communityId, communityId },
          },
          "message",
        ).catch((err) => logger.warn({ err, communityId }, "Community push failed for a member")),
      ));
    }
    pushed += targets.length;
    if (ids.length < PAGE) break;
  }
  return pushed;
}

/** Flushes every community whose batch window has closed with messages still pending. */
export async function flushDueCommunityPushes(windowMs = COMMUNITY_PUSH_WINDOW_MS): Promise<number> {
  const windowSeconds = windowMs / 1000;
  const due = await db.execute(sql`
    SELECT id FROM communities
    WHERE push_pending_count > 0 AND deleted_at IS NULL
      AND (last_push_at IS NULL OR last_push_at <= now() - make_interval(secs => ${windowSeconds}))
    LIMIT 200
  `);
  let total = 0;
  for (const r of (due as any).rows as { id: string }[]) total += await flushCommunityPush(r.id, windowMs);
  return total;
}

export function startCommunityPushJob(): void {
  scheduleJob("communityPush", () => flushDueCommunityPushes(), { intervalMs: 30_000 });
}
