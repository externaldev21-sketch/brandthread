/**
 * Live-stream replay lifecycle: wires Agora Cloud Recording (acquire /
 * start / stop / query, see ./agoraCloudRecording) to `live_streams` rows
 * and to the "replay" post that's created once a recording is confirmed
 * uploaded.
 *
 * Hard rule (never violate this): a replay post, and `live_streams.replay_url`,
 * are only ever written by `finalizeReplay`, and only once Agora's response
 * names a real uploaded file. Every other path here either no-ops (recording
 * not configured) or marks `recording_status = 'failed'` — it never invents
 * a replay_url or creates a post with an empty/placeholder media_url.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";
import {
  acquireRecordingResource,
  startRecording,
  stopRecording,
  queryRecording,
  pickReplayFile,
  buildReplayUrl,
  getRecordingEnv,
  recordingUidForChannel,
  type RecordingEnv,
  type AgoraRecordedFile,
} from "./agoraCloudRecording";

export interface LiveStreamRecordingRow {
  id: string;
  seller_id: string;
  channel_name: string;
  title: string;
  description: string | null;
  product_tags: any[];
  recording_status: string;
  recording_resource_id: string | null;
  recording_sid: string | null;
  recording_uid: number | null;
  recording_stopped_at?: string | Date | null;
}

function errMessage(err: unknown): string {
  return String((err as any)?.message ?? err).slice(0, 1000);
}

/**
 * Called right after a live stream row is inserted (POST /live/start).
 * Never throws — a recording failure must never block the stream itself.
 */
export async function beginCloudRecording(stream: LiveStreamRecordingRow): Promise<void> {
  const env = getRecordingEnv();
  if (!env) {
    logger.info({ streamId: stream.id }, "Agora Cloud Recording not configured, skipping");
    return;
  }

  // Atomic idempotency guard: only the request that flips 'none' -> 'acquiring'
  // proceeds, so a retried /start (or any other double-invocation) can't
  // acquire+start two recording sessions for the same stream.
  const claimed = await db.execute(sql`
    UPDATE live_streams SET recording_status = 'acquiring'
    WHERE id = ${stream.id}::uuid AND recording_status = 'none'
    RETURNING id
  `);
  if (!claimed.rows.length) return;

  const uid = recordingUidForChannel(stream.channel_name);
  try {
    const resourceId = await acquireRecordingResource(env, stream.channel_name, uid);
    const sid = await startRecording(env, {
      channelName: stream.channel_name,
      uid,
      resourceId,
      fileNamePrefix: ["live-replays", stream.seller_id, stream.channel_name],
    });
    await db.execute(sql`
      UPDATE live_streams
      SET recording_status = 'started',
          recording_resource_id = ${resourceId},
          recording_sid = ${sid},
          recording_uid = ${uid},
          recording_started_at = now(),
          recording_error = NULL
      WHERE id = ${stream.id}::uuid
    `);
    logger.info({ streamId: stream.id, resourceId, sid }, "Agora Cloud Recording started");
  } catch (err) {
    logger.error({ err, streamId: stream.id }, "Agora Cloud Recording failed to start");
    await db.execute(sql`
      UPDATE live_streams SET recording_status = 'failed', recording_error = ${errMessage(err)}
      WHERE id = ${stream.id}::uuid
    `);
  }
}

/**
 * Called when a seller ends their stream (POST /live/:id/end). Stops the
 * Agora recording session if one is running. If Agora's stop response
 * already names an uploaded mp4 (common — /stop waits for the recording
 * resource to shut down), the replay post is created immediately and its
 * id is returned. Otherwise recording_status is left as 'stopping' and
 * jobs/liveRecordingFinalize.ts polls until the upload is confirmed (or
 * times out and marks the recording failed).
 */
export async function stopCloudRecordingAndMaybeFinalize(
  stream: LiveStreamRecordingRow,
): Promise<{ postId: string | null }> {
  const env = getRecordingEnv();
  if (!env) return { postId: null };
  if (stream.recording_status !== "started") return { postId: null };
  if (!stream.recording_resource_id || !stream.recording_sid || stream.recording_uid == null) {
    return { postId: null };
  }

  // Atomic guard mirrors beginCloudRecording: only one caller (e.g. two
  // racing /end requests) actually calls Agora's stop endpoint.
  const claimed = await db.execute(sql`
    UPDATE live_streams SET recording_status = 'stopping', recording_stopped_at = now()
    WHERE id = ${stream.id}::uuid AND recording_status = 'started'
    RETURNING id
  `);
  if (!claimed.rows.length) return { postId: null };

  try {
    const files = await stopRecording(env, {
      channelName: stream.channel_name,
      uid: stream.recording_uid,
      resourceId: stream.recording_resource_id,
      sid: stream.recording_sid,
    });
    const file = pickReplayFile(files);
    if (file) {
      const postId = await finalizeReplay(stream, env, file);
      return { postId };
    }
    logger.info({ streamId: stream.id }, "Agora Cloud Recording stopped, awaiting upload confirmation");
    return { postId: null };
  } catch (err) {
    logger.error({ err, streamId: stream.id }, "Agora Cloud Recording failed to stop");
    await db.execute(sql`
      UPDATE live_streams SET recording_status = 'failed', recording_error = ${errMessage(err)}
      WHERE id = ${stream.id}::uuid
    `);
    return { postId: null };
  }
}

/** Creates the replay post from a confirmed-uploaded recording file, and
 * marks the stream's recording as done. The only place a replay post, or
 * `replay_url`, is ever written. */
export async function finalizeReplay(
  stream: LiveStreamRecordingRow,
  env: RecordingEnv,
  file: AgoraRecordedFile,
): Promise<string> {
  const replayUrl = buildReplayUrl(env, file.fileName);

  const productTagIds = (stream.product_tags ?? [])
    .map((t: any) => t.productId)
    .filter(Boolean);

  const postResult = await db.execute(sql`
    INSERT INTO posts (user_id, media_url, media_type, caption, style_tags)
    VALUES (
      ${stream.seller_id},
      ${replayUrl},
      'video',
      ${"🔴 Live replay: " + stream.title + (stream.description ? " — " + stream.description : "")},
      '["live","replay"]'::json
    )
    RETURNING id
  `);
  const postId = (postResult.rows[0] as any).id as string;

  for (let i = 0; i < productTagIds.length; i++) {
    try {
      await db.execute(sql`
        INSERT INTO post_tagged_products (post_id, product_id, position)
        VALUES (${postId}::uuid, ${productTagIds[i]}::uuid, ${i})
        ON CONFLICT DO NOTHING
      `);
    } catch {}
  }

  await db.execute(sql`
    UPDATE live_streams
    SET replay_url = ${replayUrl},
        replay_post_id = ${postId}::uuid,
        recording_status = 'uploaded',
        recording_error = NULL
    WHERE id = ${stream.id}::uuid
  `);

  logger.info({ streamId: stream.id, postId }, "Live replay post created from Agora Cloud Recording");
  return postId;
}

/** How long we'll keep polling Agora for an upload before giving up and
 * marking the recording failed (seller-only "Replay unavailable"). */
const UPLOAD_POLL_TIMEOUT_MS = 30 * 60 * 1000;

/** Polls every stream stuck in 'stopping' for upload completion. Run on an
 * interval by jobs/liveRecordingFinalize.ts. */
export async function pollStoppingRecordings(now: Date = new Date()): Promise<void> {
  const env = getRecordingEnv();
  if (!env) return;

  const rows = await db.execute(sql`
    SELECT * FROM live_streams
    WHERE recording_status = 'stopping'
    ORDER BY recording_stopped_at ASC NULLS FIRST
    LIMIT 20
  `);

  for (const row of rows.rows as any[]) {
    if (!row.recording_resource_id || !row.recording_sid) continue;
    try {
      const { files } = await queryRecording(env, {
        resourceId: row.recording_resource_id,
        sid: row.recording_sid,
      });
      const file = pickReplayFile(files);
      if (file) {
        await finalizeReplay(row as LiveStreamRecordingRow, env, file);
        continue;
      }
    } catch (err) {
      logger.warn({ err, streamId: row.id }, "Agora Cloud Recording query failed, will retry");
    }

    const stoppedAt = row.recording_stopped_at ? new Date(row.recording_stopped_at).getTime() : now.getTime();
    if (now.getTime() - stoppedAt > UPLOAD_POLL_TIMEOUT_MS) {
      logger.error({ streamId: row.id }, "Agora Cloud Recording upload timed out, giving up");
      await db.execute(sql`
        UPDATE live_streams SET recording_status = 'failed', recording_error = 'Upload confirmation timed out'
        WHERE id = ${row.id}::uuid
      `);
    }
  }
}
