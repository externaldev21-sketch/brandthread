/**
 * Account interaction settings (lib/interactionSettings.ts).
 *
 * GET   /api/interaction-settings                       — my settings + hidden-story count
 * PATCH /api/interaction-settings                       — { commentAudience?, allowReposts?, allowDownloads? }
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
  const [settings, hidden] = await Promise.all([
    loadInteractionSettings(userId),
    storyHiddenUserIds(userId),
  ]);
  res.json({ settings, storyHiddenCount: hidden.length });
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

export default router;
