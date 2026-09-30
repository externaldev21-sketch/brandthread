/**
 * Video captions (subtitles).
 *   GET    /api/posts/:id/captions              tracks for a visible post
 *   GET    /api/posts/:id/captions/:language    one track (JSON) or, with a `.vtt` suffix, WebVTT
 *   POST   /api/posts/:id/captions/generate     owner: start (or re-run with {force:true}) generation
 *   PATCH  /api/posts/:id/captions/:language    owner: edit segment text
 *   DELETE /api/posts/:id/captions/:language    owner: remove a track
 * Every endpoint answers 503 CAPTIONS_UNAVAILABLE while the `autoCaptions` flag
 * is off or the OpenAI integration keys are missing.
 */
import { Router, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, posts, postCaptions, type CaptionSegment } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { rateLimit } from "../middlewares/rateLimit";
import { publicPostCondition } from "../lib/postVisibility";
import { isBlockedEitherWay, optionalViewerId } from "../lib/safety";
import {
  captionsAvailable, cleanCaptionText, generateCaptionsForPost, segmentsToVtt,
  MAX_SEGMENTS, MAX_SEGMENT_TEXT,
} from "../lib/captions";
import { evaluateContent } from "../lib/contentModerator";

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LANG_RE = /^[a-z]{2,3}$/;

function unavailable(res: Response) {
  return res.status(503).json({
    error: "Captions are not available right now.",
    code: "CAPTIONS_UNAVAILABLE",
  });
}

function trackJson(row: typeof postCaptions.$inferSelect, postId: string) {
  return {
    language: row.language,
    status: row.status,
    source: row.source,
    vttUrl: row.status === "ready" ? `/api/posts/${postId}/captions/${row.language}.vtt` : null,
    segments: row.status === "ready" ? row.segments : [],
    updatedAt: row.updatedAt,
  };
}

function param(value: unknown): string {
  return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
}

/** Owner check: 404 for unknown posts, 403 for someone else's. */
async function ownedVideo(req: Request, res: Response) {
  const id = param(req.params.id);
  if (!UUID_RE.test(id)) { res.status(404).json({ error: "Post not found" }); return null; }
  const [post] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
  if (!post || post.postStatus === "deleted") { res.status(404).json({ error: "Post not found" }); return null; }
  if (post.userId !== (req as any).clerkUserId) {
    res.status(403).json({ error: "Only the author can manage captions.", code: "NOT_POST_OWNER" });
    return null;
  }
  return post;
}

// Registered before the generic `/:language` routes so "generate" is not read as a language.
router.post("/:id/captions/generate", requireAuth, rateLimit("expensive"), async (req, res) => {
  if (!(await captionsAvailable())) return unavailable(res);
  const post = await ownedVideo(req, res);
  if (!post) return;
  if (post.mediaType !== "video") {
    return res.status(400).json({ error: "Captions are only available for video posts.", code: "NOT_A_VIDEO" });
  }
  const force = (req.body as { force?: unknown } | undefined)?.force === true;
  const existing = await db.select().from(postCaptions).where(eq(postCaptions.postId, post.id));
  const ready = existing.find((row) => row.status === "ready");
  const pending = existing.find((row) => row.status === "pending" && Date.now() - row.updatedAt.getTime() < 10 * 60_000);
  if (!force && (ready || pending)) {
    return res.status(200).json({ status: ready ? "ready" : "pending", tracks: existing.map((r) => trackJson(r, post.id)) });
  }
  void generateCaptionsForPost(post.id, { force });
  return res.status(202).json({ status: "pending" });
});

router.get("/:id/captions", async (req, res) => {
  if (!(await captionsAvailable())) return unavailable(res);
  const id = param(req.params.id);
  if (!UUID_RE.test(id)) return res.status(404).json({ error: "Post not found" });
  const viewerId = optionalViewerId(req);
  const [post] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
  if (!post || post.postStatus === "deleted") return res.status(404).json({ error: "Post not found" });
  const isOwner = viewerId === post.userId;
  if (!isOwner) {
    const [visible] = await db.select({ id: posts.id }).from(posts)
      .where(and(eq(posts.id, id), publicPostCondition())).limit(1);
    if (!visible) return res.status(404).json({ error: "Post not found" });
    if (viewerId && await isBlockedEitherWay(viewerId, post.userId)) return res.status(404).json({ error: "Post not found" });
  }
  const rows = await db.select().from(postCaptions).where(eq(postCaptions.postId, id));
  const tracks = rows.filter((row) => isOwner || row.status === "ready").map((row) => trackJson(row, id));
  res.setHeader("Cache-Control", "private, max-age=30");
  return res.json({ postId: id, tracks });
});

router.get("/:id/captions/:language", async (req, res) => {
  if (!(await captionsAvailable())) return unavailable(res);
  const id = param(req.params.id);
  const raw = param(req.params.language);
  const wantsVtt = raw.endsWith(".vtt");
  const language = wantsVtt ? raw.slice(0, -4) : raw;
  if (!UUID_RE.test(id) || !LANG_RE.test(language)) return res.status(404).json({ error: "Caption track not found" });
  const viewerId = optionalViewerId(req);
  const [post] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
  if (!post || post.postStatus === "deleted") return res.status(404).json({ error: "Caption track not found" });
  const isOwner = viewerId === post.userId;
  if (!isOwner) {
    const [visible] = await db.select({ id: posts.id }).from(posts)
      .where(and(eq(posts.id, id), publicPostCondition())).limit(1);
    if (!visible) return res.status(404).json({ error: "Caption track not found" });
    if (viewerId && await isBlockedEitherWay(viewerId, post.userId)) return res.status(404).json({ error: "Caption track not found" });
  }
  const [row] = await db.select().from(postCaptions)
    .where(and(eq(postCaptions.postId, id), eq(postCaptions.language, language))).limit(1);
  if (!row || (row.status !== "ready" && !isOwner)) return res.status(404).json({ error: "Caption track not found" });
  if (wantsVtt) {
    if (row.status !== "ready") return res.status(404).json({ error: "Caption track not found" });
    res.setHeader("Content-Type", "text/vtt; charset=utf-8");
    res.setHeader("Cache-Control", isOwner ? "private, max-age=60" : "public, max-age=300");
    return res.send(row.vtt);
  }
  return res.json(trackJson(row, id));
});

router.patch("/:id/captions/:language", requireAuth, async (req, res) => {
  if (!(await captionsAvailable())) return unavailable(res);
  const post = await ownedVideo(req, res);
  if (!post) return;
  const language = param(req.params.language);
  if (!LANG_RE.test(language)) return res.status(404).json({ error: "Caption track not found" });
  const [row] = await db.select().from(postCaptions)
    .where(and(eq(postCaptions.postId, post.id), eq(postCaptions.language, language))).limit(1);
  if (!row || row.status !== "ready") return res.status(404).json({ error: "Caption track not found" });

  const incoming = (req.body as { segments?: unknown })?.segments;
  if (!Array.isArray(incoming) || incoming.length !== row.segments.length || incoming.length > MAX_SEGMENTS) {
    return res.status(400).json({
      error: "segments must list every caption segment, in order.",
      code: "VALIDATION_ERROR",
    });
  }
  // Only the text is editable; timing always comes from the stored track.
  const next: CaptionSegment[] = [];
  for (let i = 0; i < incoming.length; i++) {
    const text = (incoming[i] as { text?: unknown })?.text;
    if (typeof text !== "string" || text.length > MAX_SEGMENT_TEXT * 2) {
      return res.status(400).json({ error: `segments[${i}].text must be a string`, code: "VALIDATION_ERROR" });
    }
    const cleaned = cleanCaptionText(text);
    const decision = evaluateContent(cleaned, "public");
    if (decision.action !== "allow") {
      return res.status(422).json({
        error: `${decision.reason ?? "This text is not allowed."} Edit segment ${i + 1} and try again.`,
        code: "CONTENT_REJECTED",
      });
    }
    next.push({ start: row.segments[i].start, end: row.segments[i].end, text: cleaned });
  }
  const kept = next.filter((segment) => segment.text.length > 0);
  if (kept.length === 0) return res.status(400).json({ error: "At least one caption is required.", code: "VALIDATION_ERROR" });
  const [updated] = await db.update(postCaptions)
    .set({ segments: kept, vtt: segmentsToVtt(kept), source: "manual", error: null, updatedAt: new Date() })
    .where(and(eq(postCaptions.postId, post.id), eq(postCaptions.language, language)))
    .returning();
  return res.json(trackJson(updated, post.id));
});

router.delete("/:id/captions/:language", requireAuth, async (req, res) => {
  if (!(await captionsAvailable())) return unavailable(res);
  const post = await ownedVideo(req, res);
  if (!post) return;
  const language = param(req.params.language);
  if (!LANG_RE.test(language)) return res.status(404).json({ error: "Caption track not found" });
  const removed = await db.delete(postCaptions)
    .where(and(eq(postCaptions.postId, post.id), eq(postCaptions.language, language)))
    .returning({ language: postCaptions.language });
  if (removed.length === 0) return res.status(404).json({ error: "Caption track not found" });
  return res.json({ deleted: true, language });
});

export default router;
