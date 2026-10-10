/**
 * POST /api/webhooks/mux — Mux asset status for HLS streaming copies of
 * video posts (lib/muxVideo.ts). Signed over the raw body (app.ts mounts
 * express.raw for this path). Answers 404 when the integration is off.
 */
import { Router } from "express";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db, posts } from "@workspace/db";
import { muxConfig, parseMuxAssetEvent, scheduleMuxAssetRemoval, verifyMuxSignature } from "../lib/muxVideo";

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.post("/", async (req, res) => {
  const config = muxConfig();
  if (!config) return res.status(404).json({ error: "Not found" });
  const raw = Buffer.isBuffer(req.body) ? req.body : null;
  if (!raw || !verifyMuxSignature(raw, req.get("mux-signature"), config.webhookSecret)) {
    return res.status(400).json({ error: "Invalid signature" });
  }
  let event: unknown;
  try {
    event = JSON.parse(raw.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Invalid payload" });
  }
  const parsed = parseMuxAssetEvent(event);
  if (!parsed) return res.json({ ok: true, ignored: true });

  // Match the post by Mux asset id, or by passthrough post id when the
  // webhook beat the asset-id write in scheduleHlsTranscode.
  const byAsset = eq(posts.videoMuxAssetId, parsed.assetId);
  const where = parsed.postId && UUID_RE.test(parsed.postId)
    ? or(byAsset, and(eq(posts.id, parsed.postId), isNull(posts.videoMuxAssetId)))
    : byAsset;
  try {
    const updated = await db.update(posts)
      .set(parsed.kind === "ready"
        ? {
          videoMuxAssetId: parsed.assetId, videoHlsUrl: parsed.hlsUrl, videoHlsStatus: "ready",
          // Upload paths always store a poster; this only fills a missing one.
          thumbnailUrl: sql`COALESCE(${posts.thumbnailUrl}, ${parsed.posterUrl})`,
        }
        : { videoMuxAssetId: parsed.assetId, videoHlsUrl: null, videoHlsStatus: "errored" })
      .where(where)
      .returning({ id: posts.id, postStatus: posts.postStatus });
    // A post deleted while Mux was still processing keeps no streaming copy.
    if (parsed.kind === "ready" && (updated.length === 0 || updated.every((p) => p.postStatus === "deleted"))) {
      scheduleMuxAssetRemoval(parsed.assetId);
    }
    return res.json({ ok: true });
  } catch (err) {
    req.log?.error({ err, assetId: parsed.assetId }, "Mux webhook could not be applied");
    return res.status(500).json({ error: "Could not apply event" });
  }
});

export default router;
