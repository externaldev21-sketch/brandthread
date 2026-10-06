/**
 * Ends lives whose host is gone, so a crashed or killed host app never
 * leaves a "LIVE" card in buyers' feeds forever.
 *
 * The host's socket heartbeats every ~15s (ws/liveHub.ts → host_last_seen_at;
 * the HTTP /heartbeat fallback does the same). A stream is ended when:
 *   - its host has been silent for HOST_SILENT_MINUTES, or
 *   - it never reported host presence and started more than
 *     HOST_SILENT_MINUTES ago (an older app version, or the host never got
 *     past the go-live screen), or
 *   - it is older than MAX_LIVE_HOURS (the host's media token lifetime).
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { endLiveStream } from "../lib/liveEnd";
import { logger } from "../lib/logger";

export const HOST_SILENT_MINUTES = 5;
export const MAX_LIVE_HOURS = 4;
const INTERVAL_MS = 60_000;

export async function endStaleLiveStreams(): Promise<number> {
  const rows = await db.execute(sql`
    SELECT id,
           (started_at < now() - make_interval(hours => ${MAX_LIVE_HOURS})) AS expired
    FROM live_streams
    WHERE status = 'live'
      AND (
        COALESCE(host_last_seen_at, started_at) < now() - make_interval(mins => ${HOST_SILENT_MINUTES})
        OR started_at < now() - make_interval(hours => ${MAX_LIVE_HOURS})
      )
    LIMIT 100
  `);
  let ended = 0;
  for (const row of rows.rows as Array<{ id: string; expired: boolean }>) {
    const result = await endLiveStream(row.id, row.expired ? "expired" : "host_silent");
    if (result.ended) ended += 1;
  }
  return ended;
}

export function startLiveStaleStreamsJob(): void {
  setInterval(() => {
    void endStaleLiveStreams().catch((err) =>
      logger.error({ err, job: "liveStaleStreams" }, "Stale live sweep failed"),
    );
  }, INTERVAL_MS).unref();
}
