/**
 * Polls on Threads (X/Twitter poll pattern; rules in lib/postPolls.ts).
 *
 *   GET  /api/posts/polls?ids=a,b,c      batched summaries for the feed (visible posts only; max 50 ids)
 *   GET  /api/posts/:postId/poll         one summary
 *   PUT  /api/posts/:postId/poll         author: attach/replace { options, durationMinutes } — only on a
 *                                        Thread and only while nobody has voted (X: polls can't be edited)
 *   POST /api/posts/:postId/poll/vote    { optionIndex } — one vote, no changing it, not the author,
 *                                        not after the poll ends, not across a block
 *
 * Mounted under /posts ahead of the posts router so `/polls` is not read as a post id.
 */
import { Router, type Request, type Response } from "express";
import { and, count, eq, inArray } from "drizzle-orm";
import { db, posts, postPolls, postPollVotes } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { rateLimit } from "../middlewares/rateLimit";
import { publicPostCondition } from "../lib/postVisibility";
import { blockedUserIds, isBlockedEitherWay, optionalViewerId } from "../lib/safety";
import { evaluateContent } from "../lib/contentModerator";
import { pollStartsAt, summarizePoll, validatePollInput, type PollSummary } from "../lib/postPolls";

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BATCH = 50;

type PostRow = typeof posts.$inferSelect;
type PollRow = typeof postPolls.$inferSelect;

function param(value: unknown): string {
  return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
}

const notFound = (res: Response) => res.status(404).json({ error: "Post not found", code: "POST_NOT_FOUND" });
const noPoll = (res: Response) => res.status(404).json({ error: "This post has no poll", code: "POLL_NOT_FOUND" });

/** Posts (from `ids`) this viewer may see: their own, or publicly visible and not blocked either way. */
async function visiblePosts(ids: string[], viewerId: string | null): Promise<PostRow[]> {
  if (ids.length === 0) return [];
  const rows = await db.select().from(posts).where(inArray(posts.id, ids));
  const visibleIds = new Set(
    (await db.select({ id: posts.id }).from(posts)
      .where(and(inArray(posts.id, ids), publicPostCondition(new Date(), viewerId)))).map((r) => r.id),
  );
  const blocked = viewerId ? await blockedUserIds(viewerId) : new Set<string>();
  return rows.filter((p) => p.postStatus !== "deleted" && (
    (viewerId !== null && p.userId === viewerId) || (visibleIds.has(p.id) && !blocked.has(p.userId))
  ));
}

async function summaries(rows: Array<{ post: PostRow; poll: PollRow }>, viewerId: string | null): Promise<PollSummary[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.post.id);
  const tallies = await db.select({ postId: postPollVotes.postId, optionIndex: postPollVotes.optionIndex, n: count() })
    .from(postPollVotes).where(inArray(postPollVotes.postId, ids))
    .groupBy(postPollVotes.postId, postPollVotes.optionIndex);
  const mine = viewerId
    ? await db.select({ postId: postPollVotes.postId, optionIndex: postPollVotes.optionIndex }).from(postPollVotes)
        .where(and(inArray(postPollVotes.postId, ids), eq(postPollVotes.userId, viewerId)))
    : [];
  const myVotes = new Map(mine.map((m) => [m.postId, m.optionIndex]));
  return rows.map(({ post, poll }) => {
    const counts = poll.options.map(() => 0);
    for (const t of tallies) if (t.postId === post.id && t.optionIndex < counts.length) counts[t.optionIndex] = Number(t.n);
    return summarizePoll({
      postId: post.id,
      options: poll.options,
      durationMinutes: poll.durationMinutes,
      startsAt: pollStartsAt(post),
      counts,
      myVote: myVotes.get(post.id) ?? null,
      isAuthor: viewerId !== null && viewerId === post.userId,
    });
  });
}

async function summaryFor(postId: string, viewerId: string | null): Promise<PollSummary | null> {
  const [post] = await visiblePosts([postId], viewerId);
  if (!post) return null;
  const [poll] = await db.select().from(postPolls).where(eq(postPolls.postId, postId)).limit(1);
  if (!poll) return null;
  const [summary] = await summaries([{ post, poll }], viewerId);
  return summary;
}

// Registered before `/:postId/...` so "polls" is never read as a post id.
router.get("/polls", async (req: Request, res: Response) => {
  const ids = [...new Set(param(req.query.ids).split(",").map((s) => s.trim()).filter((s) => UUID_RE.test(s)))];
  if (ids.length > MAX_BATCH) {
    return res.status(400).json({ error: `Up to ${MAX_BATCH} ids per request`, code: "VALIDATION_ERROR" });
  }
  const viewerId = optionalViewerId(req);
  const visible = await visiblePosts(ids, viewerId);
  const polls = visible.length
    ? await db.select().from(postPolls).where(inArray(postPolls.postId, visible.map((p) => p.id)))
    : [];
  const byId = new Map(polls.map((p) => [p.postId, p]));
  const rows = visible.filter((p) => byId.has(p.id)).map((post) => ({ post, poll: byId.get(post.id)! }));
  const list = await summaries(rows, viewerId);
  res.setHeader("Cache-Control", "private, no-store");
  return res.json({ polls: Object.fromEntries(list.map((s) => [s.postId, s])) });
});

router.get("/:postId/poll", async (req: Request, res: Response) => {
  const postId = param(req.params.postId);
  if (!UUID_RE.test(postId)) return notFound(res);
  const summary = await summaryFor(postId, optionalViewerId(req));
  if (!summary) return noPoll(res);
  res.setHeader("Cache-Control", "private, no-store");
  return res.json({ poll: summary });
});

router.put("/:postId/poll", requireAuth, async (req: Request, res: Response) => {
  const me = (req as any).clerkUserId as string;
  const postId = param(req.params.postId);
  if (!UUID_RE.test(postId)) return notFound(res);
  const [post] = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
  if (!post || post.postStatus === "deleted") return notFound(res);
  if (post.userId !== me) {
    return res.status(403).json({ error: "Only the author can add a poll.", code: "NOT_POST_OWNER" });
  }
  if (post.surface !== "thread") {
    return res.status(400).json({ error: "Polls can only be added to Threads.", code: "POLL_THREADS_ONLY" });
  }
  const input = validatePollInput(req.body);
  if (!input.ok) return res.status(400).json({ error: input.error, code: input.code });
  const decision = evaluateContent(input.options.join("\n"), "public");
  if (decision.action === "reject") {
    return res.status(422).json({ error: decision.reason, category: decision.category, code: "CONTENT_REJECTED" });
  }
  const [{ n }] = await db.select({ n: count() }).from(postPollVotes).where(eq(postPollVotes.postId, postId));
  if (Number(n) > 0) {
    return res.status(409).json({ error: "Polls can't be edited after people vote.", code: "POLL_LOCKED" });
  }
  const now = new Date();
  await db.insert(postPolls)
    .values({ postId, options: input.options, durationMinutes: input.durationMinutes, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: postPolls.postId,
      set: { options: input.options, durationMinutes: input.durationMinutes, updatedAt: now },
    });
  const summary = await summaryFor(postId, me);
  return res.status(200).json({ poll: summary });
});

router.post("/:postId/poll/vote", requireAuth, rateLimit("post-interact"), async (req: Request, res: Response) => {
  const me = (req as any).clerkUserId as string;
  const postId = param(req.params.postId);
  if (!UUID_RE.test(postId)) return notFound(res);
  const [post] = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
  if (!post || post.postStatus === "deleted") return notFound(res);
  if (post.userId === me) {
    return res.status(403).json({ error: "You can't vote in your own poll.", code: "AUTHOR_CANNOT_VOTE" });
  }
  if (await isBlockedEitherWay(me, post.userId)) return notFound(res);
  const summary = await summaryFor(postId, me);
  if (!summary) {
    const [visible] = await visiblePosts([postId], me);
    return visible ? noPoll(res) : notFound(res);
  }
  if (summary.isEnded) return res.status(409).json({ error: "This poll has ended.", code: "POLL_ENDED", poll: summary });
  if (summary.myVote !== null) return res.status(409).json({ error: "You already voted.", code: "ALREADY_VOTED", poll: summary });
  const optionIndex = (req.body as { optionIndex?: unknown } | undefined)?.optionIndex;
  if (typeof optionIndex !== "number" || !Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= summary.options.length) {
    return res.status(400).json({ error: "Invalid choice", code: "VALIDATION_ERROR" });
  }
  const inserted = await db.insert(postPollVotes)
    .values({ postId, userId: me, optionIndex })
    .onConflictDoNothing()
    .returning({ postId: postPollVotes.postId });
  const after = await summaryFor(postId, me);
  if (inserted.length === 0) return res.status(409).json({ error: "You already voted.", code: "ALREADY_VOTED", poll: after });
  return res.status(201).json({ poll: after });
});

export default router;
