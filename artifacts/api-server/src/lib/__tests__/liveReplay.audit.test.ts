/**
 * finalizeReplay is reached both from POST /live/:id/end (Agora's stop
 * response names the file) and from the poll job (a /query while that stop
 * is still running). Racing calls must create exactly one replay post.
 */
import crypto from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db, liveStreams, posts } from "@workspace/db";
import { finalizeReplay, type LiveStreamRecordingRow } from "../liveReplay";
import type { RecordingEnv } from "../agoraCloudRecording";

const sfx = crypto.randomBytes(4).toString("hex");
const sellerId = `replay-audit-${sfx}`;
const env = { bucket: "bucket", region: "us-east-1", publicUrlBase: "https://cdn.example.test" } as unknown as RecordingEnv;
const streamIds: string[] = [];

async function stoppingStream(): Promise<LiveStreamRecordingRow> {
  const [row] = await db.insert(liveStreams).values({
    sellerId,
    channelName: `replay-audit-${sfx}-${streamIds.length}`,
    title: "Fall drop",
    productTags: [{ productId: "not-a-uuid" }],
    status: "ended",
    recordingStatus: "stopping",
    recordingResourceId: "res",
    recordingSid: "sid",
    recordingUid: 1,
  }).returning();
  streamIds.push(row.id);
  return {
    id: row.id, seller_id: sellerId, channel_name: row.channelName, title: row.title, description: null,
    product_tags: row.productTags, recording_status: "stopping", recording_resource_id: "res",
    recording_sid: "sid", recording_uid: 1,
  };
}

afterAll(async () => {
  if (streamIds.length) await db.delete(liveStreams).where(inArray(liveStreams.id, streamIds));
  await db.delete(posts).where(eq(posts.userId, sellerId));
});

describe("finalizeReplay", () => {
  it("creates one replay post when the end request and the poll job finalize at once", async () => {
    const stream = await stoppingStream();
    const file = { fileName: `live-replays/${sfx}.mp4` } as any;
    const [a, b] = await Promise.all([finalizeReplay(stream, env, file), finalizeReplay(stream, env, file)]);
    expect(a).toBe(b);
    const replayPosts = await db.select({ id: posts.id }).from(posts).where(eq(posts.userId, sellerId));
    expect(replayPosts).toHaveLength(1);
    const [row] = await db.select().from(liveStreams).where(eq(liveStreams.id, stream.id));
    expect(row.replayPostId).toBe(a);
    expect(row.recordingStatus).toBe("uploaded");
    expect(row.replayUrl).toBe(`https://cdn.example.test/live-replays/${sfx}.mp4`);
  });

  it("a later call reuses the existing replay instead of posting again", async () => {
    const stream = await stoppingStream();
    const file = { fileName: `live-replays/${sfx}-2.mp4` } as any;
    const first = await finalizeReplay(stream, env, file);
    const again = await finalizeReplay(stream, env, file);
    expect(again).toBe(first);
  });
});
