/**
 * Photo replies in post comments — the moderated upload step.
 *
 * POST /api/comment-media/upload   { data: base64 | data-URL, mimeType }
 *   → 201 { media: { id, url, width, height } }
 *
 * The photo is re-encoded (proves it is an image, strips EXIF/GPS, caps the
 * long edge), screened with the automatic media screening posts use
 * (lib/mediaModeration.ts — off when the AI integration env is missing), and
 * stored. A hard reject never gets a URL (422, recorded for moderators). A
 * "hold" verdict is remembered on the row, and the comment that uses the
 * photo is held for review when it is posted (same as a held post).
 *
 * The returned id (or url) is then passed as `media` to
 * POST /api/posts/:postId/comments.
 */
import { Router } from "express";
import sharp from "sharp";
import { db, postCommentMedia } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { rateLimit } from "../middlewares/rateLimit";
import { publishingRestriction } from "../lib/safety";
import { MEDIA_REJECTED_MESSAGE, screenImageBuffer } from "../lib/mediaModeration";
import { recordRejectedUpload } from "../lib/mediaModerationStore";
import {
  COMMENT_MEDIA_MAX_EDGE,
  COMMENT_MEDIA_MIME_TYPES,
  CommentMediaStorageNotConfiguredError,
  MAX_COMMENT_MEDIA_BASE64,
  storeCommentMedia,
  toMediaView,
} from "../lib/commentMedia";

const router = Router();
const BASE64_RE = /^[A-Za-z0-9+/]+=*$/;

router.post("/upload", requireAuth, rateLimit("upload"), async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { data, mimeType = "image/jpeg" } = (req.body ?? {}) as { data?: unknown; mimeType?: unknown };
  if (typeof data !== "string" || !data) {
    return res.status(400).json({ error: "data (base64) is required", code: "VALIDATION_ERROR" });
  }
  const mime = typeof mimeType === "string" ? mimeType.toLowerCase() : "";
  if (!COMMENT_MEDIA_MIME_TYPES.has(mime)) {
    return res.status(400).json({ error: "Photos must be JPEG, PNG or WebP.", code: "VALIDATION_ERROR" });
  }
  let b64 = data;
  const dataUrl = /^data:([^;]+);base64,(.+)$/.exec(data);
  if (dataUrl) b64 = dataUrl[2];
  if (b64.length > MAX_COMMENT_MEDIA_BASE64) {
    return res.status(413).json({ error: "That photo is too large.", code: "TOO_LARGE" });
  }
  if (!BASE64_RE.test(b64)) {
    return res.status(400).json({ error: "data must be base64-encoded", code: "VALIDATION_ERROR" });
  }

  try {
    const restriction = await publishingRestriction(userId);
    if (restriction) return res.status(restriction.status).json(restriction.body);
  } catch (err) {
    req.log.error({ err, userId }, "Could not check publishing restriction for comment photo");
    return res.status(500).json({ error: "Upload failed" });
  }

  const original = Buffer.from(b64, "base64");
  let clean: { data: Buffer; info: { width: number; height: number } };
  try {
    clean = await sharp(original)
      .rotate()
      .resize({ width: COMMENT_MEDIA_MAX_EDGE, height: COMMENT_MEDIA_MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 84 })
      .toBuffer({ resolveWithObject: true });
  } catch {
    return res.status(400).json({ error: "That file doesn't look like a photo.", code: "NOT_AN_IMAGE" });
  }

  // Screening sees the original bytes, like DM and post uploads.
  const verdict = await screenImageBuffer(original, mime === "image/jpg" ? "image/jpeg" : mime);
  if (verdict.verdict === "reject") {
    void recordRejectedUpload({ ownerId: userId, surface: "comment", verdict });
    return res.status(422).json({ error: MEDIA_REJECTED_MESSAGE, code: "IMAGE_REJECTED" });
  }

  try {
    const url = await storeCommentMedia({ buffer: clean.data, mimeType: "image/jpeg", userId });
    const [row] = await db.insert(postCommentMedia).values({
      ownerId: userId,
      url,
      width: clean.info.width,
      height: clean.info.height,
      moderationVerdict: verdict.verdict,
      moderationCategories: verdict.categories,
      unverified: !!verdict.unverified,
    }).returning();
    return res.status(201).json({ media: toMediaView(row) });
  } catch (err) {
    if (err instanceof CommentMediaStorageNotConfiguredError) {
      return res.status(503).json({ error: "Photo upload isn't available right now.", code: "STORAGE_UNAVAILABLE" });
    }
    req.log.error({ err, userId }, "Failed to store comment photo");
    return res.status(500).json({ error: "Upload failed" });
  }
});

export default router;
