/**
 * The one way a live stream ends — by its host (POST /api/live/:id/end), by
 * the host starting a new live while an old one is still marked live (a
 * crashed app), or by jobs/liveStaleStreams.ts when the host went silent.
 *
 * Flips status to 'ended' exactly once (a conditional UPDATE, so concurrent
 * callers can't double-finalize), tells everyone in the room right away
 * (`{ type: "ended" }` — viewers no longer have to infer it from Agora's
 * onUserOffline, which also fires on a host network blip), clears presence
 * rows, and stops the cloud recording / creates the replay when it's ready.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { broadcastToRoom } from "../ws/liveHub";
import { stopCloudRecordingAndMaybeFinalize } from "./liveReplay";
import { logger } from "./logger";

export type LiveEndReason = "host" | "restarted" | "host_silent" | "expired";
export type LiveEndResult = {
  ended: boolean;
  replayPostId: string | null;
  replayStatus: "ready" | "pending" | "unavailable";
};

export async function endLiveStream(streamId: string, reason: LiveEndReason): Promise<LiveEndResult> {
  const updated = await db.execute(sql`
    UPDATE live_streams SET status = 'ended', ended_at = now()
    WHERE id = ${streamId}::uuid AND status = 'live'
    RETURNING *
  `);
  const stream = updated.rows[0] as any;
  if (!stream) return { ended: false, replayPostId: null, replayStatus: "unavailable" };

  let replayPostId: string | null = null;
  let replayStatus: LiveEndResult["replayStatus"] = "unavailable";
  try {
    const { postId } = await stopCloudRecordingAndMaybeFinalize(stream);
    if (postId) {
      replayPostId = postId;
      replayStatus = "ready";
    } else if (stream.recording_status === "started") {
      replayStatus = "pending";
    }
  } catch (err) {
    logger.error({ err, streamId }, "stopCloudRecordingAndMaybeFinalize threw unexpectedly");
  }

  broadcastToRoom(streamId, { type: "ended", reason, replayStatus, replayPostId });
  await db.execute(sql`DELETE FROM live_viewers WHERE stream_id = ${streamId}::uuid`).catch((err) =>
    logger.warn({ err, streamId }, "Clearing live_viewers on end failed"),
  );
  return { ended: true, replayPostId, replayStatus };
}
