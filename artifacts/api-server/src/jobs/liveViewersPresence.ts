/**
 * Presence-based live viewer counts (migration 105_live_viewers).
 *
 * Replaces the old increment-on-join/decrement-on-leave counter: every
 * connected viewer (WebSocket, or the HTTP heartbeat fallback) refreshes
 * its own `live_viewers` row every ~15s. This job periodically recomputes
 * `viewer_count` for every currently-live stream as
 * `count(*) WHERE last_seen > now() - interval '45 seconds'`, keeps
 * `peak_viewer_count` as a running max, and broadcasts the fresh count to
 * that stream's WebSocket room. A second, much less frequent sweep deletes
 * long-stale rows so the table doesn't grow unbounded.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { broadcastToRoom } from "../ws/liveHub";
import { startLiveStaleStreamsJob } from "./liveStaleStreams";

const RECOMPUTE_INTERVAL_MS = 10_000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Recomputes and persists viewer_count/peak_viewer_count for every live
 * stream, and broadcasts the new count to each stream's room. Returns the
 * number of streams updated (exported for tests).
 */
export async function recomputeLiveViewerCounts(): Promise<number> {
  const rows = await db.execute(sql`
    UPDATE live_streams ls
    SET viewer_count = counts.n,
        peak_viewer_count = GREATEST(ls.peak_viewer_count, counts.n)
    FROM (
      SELECT stream_id, count(*)::int AS n
      FROM live_viewers
      WHERE last_seen > now() - interval '45 seconds'
      GROUP BY stream_id
    ) counts
    WHERE ls.id = counts.stream_id AND ls.status = 'live'
    RETURNING ls.id, ls.viewer_count
  `);

  // Streams with zero fresh viewers never appear in the aggregate above
  // (no rows to group), so their counter would otherwise never drop back
  // down to 0 once every viewer leaves/goes stale.
  const zeroed = await db.execute(sql`
    UPDATE live_streams ls
    SET viewer_count = 0
    WHERE ls.status = 'live'
      AND ls.viewer_count > 0
      AND NOT EXISTS (
        SELECT 1 FROM live_viewers lv
        WHERE lv.stream_id = ls.id AND lv.last_seen > now() - interval '45 seconds'
      )
    RETURNING ls.id, ls.viewer_count
  `);

  for (const row of rows.rows as { id: string; viewer_count: number }[]) {
    broadcastToRoom(row.id, { type: "viewerCount", count: row.viewer_count });
  }
  for (const row of zeroed.rows as { id: string; viewer_count: number }[]) {
    broadcastToRoom(row.id, { type: "viewerCount", count: row.viewer_count });
  }
  return rows.rows.length + zeroed.rows.length;
}

/** Deletes viewer rows nobody has heartbeated in a long time. */
export async function cleanupStaleLiveViewers(): Promise<number> {
  const result = await db.execute(sql`
    DELETE FROM live_viewers WHERE last_seen < now() - interval '1 hour'
  `);
  return result.rowCount ?? 0;
}

export function startLiveViewersPresenceJob(): void {
  setInterval(() => {
    void recomputeLiveViewerCounts().catch((err) =>
      logger.error({ err, job: "liveViewersPresence" }, "Viewer count recompute failed"),
    );
  }, RECOMPUTE_INTERVAL_MS);

  setInterval(() => {
    void cleanupStaleLiveViewers().catch((err) =>
      logger.error({ err, job: "liveViewersPresence" }, "Stale live_viewers cleanup failed"),
    );
  }, CLEANUP_INTERVAL_MS);

  // Host presence: ends lives whose host app is gone (jobs/liveStaleStreams.ts).
  startLiveStaleStreamsJob();
}
