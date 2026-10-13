/**
 * "Pin to your profile" (Instagram pattern; rules in lib/postPins.ts).
 *
 *   GET    /api/posts/pins/mine      my pinned post ids, newest pin first
 *   POST   /api/posts/:id/pin        owner, published posts only; { replaceOldest?: true } at the 3-pin cap
 *   DELETE /api/posts/:id/pin        owner: unpin
 *
 * Profile grids order pinned posts first and return `pinnedAt`:
 * GET /api/public/users/:userId/videos, GET /api/social/profile/:userId/posts
 * and GET /api/posts/mine. Mounted under /posts ahead of the posts router.
 */
import { Router, type Request, type Response } from "express";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, posts, postPins } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { MAX_PINS, planPin } from "../lib/postPins";

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function param(value: unknown): string {
  return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
}

const notFound = (res: Response) => res.status(404).json({ error: "Post not found", code: "POST_NOT_FOUND" });

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The author's pins whose post is still published (a pin on an archived/draft post is dropped). */
async function livePins(tx: Tx | typeof db, userId: string) {
  return tx.select({ postId: postPins.postId, pinnedAt: postPins.pinnedAt })
    .from(postPins)
    .innerJoin(posts, eq(posts.id, postPins.postId))
    .where(and(eq(postPins.userId, userId), eq(posts.userId, userId), eq(posts.postStatus, "published")))
    .orderBy(desc(postPins.pinnedAt), asc(postPins.postId));
}

async function ownedPost(req: Request, res: Response) {
  const me = (req as any).clerkUserId as string;
  const id = param(req.params.id);
  if (!UUID_RE.test(id)) { notFound(res); return null; }
  const [post] = await db.select({ id: posts.id, userId: posts.userId, postStatus: posts.postStatus })
    .from(posts).where(eq(posts.id, id)).limit(1);
  if (!post || post.postStatus === "deleted") { notFound(res); return null; }
  if (post.userId !== me) {
    res.status(403).json({ error: "You can only pin your own posts.", code: "NOT_POST_OWNER" });
    return null;
  }
  return post;
}

router.get("/pins/mine", requireAuth, async (req: Request, res: Response) => {
  const me = (req as any).clerkUserId as string;
  const pins = await livePins(db, me);
  return res.json({ max: MAX_PINS, pins: pins.map((p) => ({ postId: p.postId, pinnedAt: p.pinnedAt.toISOString() })) });
});

router.post("/:id/pin", requireAuth, async (req: Request, res: Response) => {
  const post = await ownedPost(req, res);
  if (!post) return;
  if (post.postStatus !== "published") {
    return res.status(400).json({ error: "Only published posts can be pinned.", code: "POST_NOT_PUBLISHED" });
  }
  const replaceOldest = (req.body as { replaceOldest?: unknown } | undefined)?.replaceOldest === true;
  const result = await db.transaction(async (tx) => {
    // Serialise pin changes per author so two quick pins can't both pass the cap.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`post_pins:${post.userId}`}))`);
    // Pins left on posts that are no longer published don't count and are cleared.
    await tx.execute(sql`
      DELETE FROM post_pins pp USING posts p
      WHERE pp.post_id = p.id AND pp.user_id = ${post.userId} AND p.post_status <> 'published'`);
    const existing = await livePins(tx, post.userId);
    const plan = planPin(existing, post.id, replaceOldest);
    if (plan.action === "limit") return plan;
    if (plan.action === "replace") await tx.delete(postPins).where(eq(postPins.postId, plan.removePostId));
    if (plan.action !== "already") await tx.insert(postPins).values({ postId: post.id, userId: post.userId });
    return plan;
  });
  if (result.action === "limit") {
    return res.status(409).json({
      error: `You can pin up to ${MAX_PINS} posts. Replace your oldest pinned post?`,
      code: "PIN_LIMIT", max: MAX_PINS, pinned: result.pinned,
    });
  }
  const pins = await livePins(db, post.userId);
  const mine = pins.find((p) => p.postId === post.id);
  return res.status(result.action === "already" ? 200 : 201).json({
    pinned: true,
    pinnedAt: mine?.pinnedAt.toISOString() ?? null,
    replaced: result.action === "replace" ? result.removePostId : null,
    pins: pins.map((p) => p.postId),
  });
});

router.delete("/:id/pin", requireAuth, async (req: Request, res: Response) => {
  const post = await ownedPost(req, res);
  if (!post) return;
  await db.delete(postPins).where(eq(postPins.postId, post.id));
  const pins = await livePins(db, post.userId);
  return res.json({ pinned: false, pins: pins.map((p) => p.postId) });
});

export default router;
