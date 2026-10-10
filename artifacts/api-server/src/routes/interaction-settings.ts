/**
 * Account interaction settings (lib/interactionSettings.ts).
 *
 * GET   /api/interaction-settings                       — my settings + hidden-story count
 * PATCH /api/interaction-settings                       — { commentAudience?, allowReposts?, allowDownloads?,
 *                                                          manualTagApproval?, remixAudience?, snoozeSuggested? }
 * GET   /api/interaction-settings/pending-tags          — { items } tags waiting for my approval
 * POST  /api/interaction-settings/pending-tags/:kind/:id/approve — show it on my Tagged tab
 * DELETE /api/interaction-settings/tags/:kind/:id       — remove me from that post/story tag
 * GET   /api/interaction-settings/story-hidden          — { userIds } I hide my stories from
 * PUT   /api/interaction-settings/story-hidden          — replace that list
 * GET   /api/interaction-settings/posts/:postId/download — may the viewer save this post's media?
 *                                                          (signed-out allowed)
 */
import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db, posts } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { validateRequest } from "../middlewares/validateRequest";
import { publicPostCondition } from "../lib/postVisibility";
import { isBlockedEitherWay, optionalViewerId } from "../lib/safety";
import {
  interactionSettingsPatchSchema,
  loadInteractionSettings,
  replaceStoryHiddenUserIds,
  saveInteractionSettings,
  storyHiddenBodySchema,
  storyHiddenUserIds,
} from "../lib/interactionSettings";
import { approvePendingTag, isTagKind, listPendingTags, pendingTagCount, removeTag } from "../lib/tagApproval";

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get("/posts/:postId/download", async (req, res) => {
  const postId = String(req.params.postId);
  if (!UUID_RE.test(postId)) return res.status(404).json({ error: "Post not found" });
  const viewerId = optionalViewerId(req);
  try {
    const [post] = await db.select({ ownerId: posts.userId }).from(posts)
      .where(and(eq(posts.id, postId), publicPostCondition()))
      .limit(1);
    if (!post) return res.status(404).json({ error: "Post not found" });
    if (viewerId && post.ownerId === viewerId) return res.json({ allowed: true });
    if (viewerId && post.ownerId && await isBlockedEitherWay(viewerId, post.ownerId)) {
      return res.status(404).json({ error: "Post not found" });
    }
    const { allowDownloads } = post.ownerId
      ? await loadInteractionSettings(post.ownerId)
      : { allowDownloads: true };
    return res.json({ allowed: allowDownloads });
  } catch (err) {
    req.log?.error({ err, postId }, "Failed to check download permission");
    return res.status(500).json({ error: "Could not check this post. Try again." });
  }
});

router.use(requireAuth);

router.get("/", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const [settings, hidden, pendingTags] = await Promise.all([
    loadInteractionSettings(userId),
    storyHiddenUserIds(userId),
    pendingTagCount(userId),
  ]);
  res.json({ settings, storyHiddenCount: hidden.length, pendingTagCount: pendingTags });
});

router.patch("/", validateRequest({ body: interactionSettingsPatchSchema }), async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const settings = await saveInteractionSettings(userId, req.body ?? {});
  res.json({ settings });
});

router.get("/story-hidden", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  res.json({ userIds: await storyHiddenUserIds(userId) });
});

router.put("/story-hidden", validateRequest({ body: storyHiddenBodySchema }), async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { userIds } = req.body as { userIds: string[] };
  res.json({ userIds: await replaceStoryHiddenUserIds(userId, userIds) });
});

router.get("/pending-tags", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  res.json({ items: await listPendingTags(userId) });
});

function tagTarget(req: { params: Record<string, unknown> }): { kind: "post" | "story"; id: string } | null {
  const kind = req.params.kind;
  const id = String(req.params.id ?? "");
  return isTagKind(kind) && UUID_RE.test(id) ? { kind, id } : null;
}

router.post("/pending-tags/:kind/:id/approve", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const target = tagTarget(req);
  if (!target || !(await approvePendingTag(userId, target.kind, target.id))) {
    return res.status(404).json({ error: "Tag not found", code: "TAG_NOT_FOUND" });
  }
  return res.json({ ok: true, pendingTagCount: await pendingTagCount(userId) });
});

router.delete("/tags/:kind/:id", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const target = tagTarget(req);
  if (!target || !(await removeTag(userId, target.kind, target.id))) {
    return res.status(404).json({ error: "Tag not found", code: "TAG_NOT_FOUND" });
  }
  return res.json({ ok: true, pendingTagCount: await pendingTagCount(userId) });
});

export default router;
